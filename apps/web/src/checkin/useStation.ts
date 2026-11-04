import {
  checkinResultSchema,
  checkinSyncResponseSchema,
  offlineListSchema,
  type CheckinItem,
  type CheckinResult,
  type OfflineList,
} from '@uka/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, jsonRequest } from '../api.js';
import { checkinStore, isConnectionError } from './store.js';

const REQUEST_TIMEOUT_MS = 5000;
const SYNC_EVERY_MS = 15_000;
const REFRESH_EVERY_MS = 60_000;
const BATCH_SIZE = 100;

export interface StationOutcome {
  result: CheckinResult;
  offline: boolean;
}

type Entry = OfflineList['entries'][number];

export function useStation(params: {
  eventId: string;
  accessPointId: string;
  csrfToken: string;
  refreshSession: () => Promise<void>;
}) {
  const { eventId, accessPointId, csrfToken, refreshSession } = params;
  const [list, setList] = useState<OfflineList | null>(() =>
    checkinStore.list(eventId),
  );
  const [queueSize, setQueueSize] = useState(
    () => checkinStore.queue(eventId).length,
  );
  const [online, setOnline] = useState(() => navigator.onLine);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [conflicts, setConflicts] = useState(0);
  const syncing = useRef(false);

  const markEntered = useCallback(
    (tokenHash: string, checkedInAt: string) => {
      setList((current) => {
        if (!current) {
          return current;
        }
        const next = {
          ...current,
          entries: current.entries.map((entry) =>
            entry.tokenHash === tokenHash && !entry.checkedInAt
              ? { ...entry, checkedInAt }
              : entry,
          ),
        };
        checkinStore.saveList(eventId, next);
        return next;
      });
    },
    [eventId],
  );

  const refreshList = useCallback(async () => {
    try {
      const fresh = offlineListSchema.parse(
        await apiRequest(`/api/events/${eventId}/checkin/offline-list`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4),
        }),
      );
      // Lo leído aquí sin internet aún no está en el servidor: no se debe perder.
      const local = new Map(
        (checkinStore.list(eventId)?.entries ?? []).map((entry) => [
          entry.tokenHash,
          entry,
        ]),
      );
      const pending = new Set(
        checkinStore.queue(eventId).map((item) => item.tokenHash),
      );
      const merged: OfflineList = {
        ...fresh,
        entries: fresh.entries.map((entry) =>
          !entry.checkedInAt && pending.has(entry.tokenHash)
            ? {
                ...entry,
                checkedInAt:
                  local.get(entry.tokenHash)?.checkedInAt ??
                  new Date().toISOString(),
              }
            : entry,
        ),
      };
      checkinStore.saveList(eventId, merged);
      setList(merged);
      setOnline(true);
      setNeedsLogin(false);
    } catch (error) {
      if (isConnectionError(error)) {
        setOnline(false);
      } else if (String(error).includes('sesión')) {
        setNeedsLogin(true);
      }
    }
  }, [eventId]);

  const sync = useCallback(async () => {
    if (syncing.current || checkinStore.queue(eventId).length === 0) {
      return;
    }
    if (!csrfToken) {
      await refreshSession();
      return;
    }
    syncing.current = true;
    try {
      const batch = checkinStore.queue(eventId).slice(0, BATCH_SIZE);
      const { results } = checkinSyncResponseSchema.parse(
        await apiRequest(`/api/events/${eventId}/checkin/sync`, {
          ...jsonRequest('POST', { items: batch }, csrfToken),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 6),
        }),
      );
      const done = new Set(results.map((entry) => entry.clientId));
      const rest = checkinStore
        .queue(eventId)
        .filter((item) => !done.has(item.clientId));
      checkinStore.saveQueue(eventId, rest);
      setQueueSize(rest.length);
      setConflicts(
        (current) =>
          current +
          results.filter(
            (entry) =>
              entry.result.status === 'duplicate' ||
              entry.result.status === 'revoked',
          ).length,
      );
      setOnline(true);
      setNeedsLogin(false);
    } catch (error) {
      if (isConnectionError(error)) {
        setOnline(false);
      } else if (String(error).includes('sesión')) {
        setNeedsLogin(true);
      }
    } finally {
      syncing.current = false;
    }
  }, [csrfToken, eventId, refreshSession]);

  const enqueue = useCallback(
    (item: CheckinItem) => {
      const queue = [...checkinStore.queue(eventId), item];
      checkinStore.saveQueue(eventId, queue);
      setQueueSize(queue.length);
    },
    [eventId],
  );

  /** Con conexión pregunta al servidor; sin ella decide con la lista descargada. */
  const admit = useCallback(
    async (
      tokenHash: string,
      manualReason: string | null,
    ): Promise<StationOutcome> => {
      const item: CheckinItem = {
        clientId: crypto.randomUUID(),
        tokenHash,
        accessPointId,
        scannedAt: new Date().toISOString(),
        manualReason,
      };

      if (csrfToken && navigator.onLine) {
        try {
          const result = checkinResultSchema.parse(
            await apiRequest(`/api/events/${eventId}/checkin/scan`, {
              ...jsonRequest('POST', item, csrfToken),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            }),
          );
          if (result.status === 'ok' || result.status === 'duplicate') {
            markEntered(tokenHash, result.checkedInAt);
          }
          setOnline(true);
          return { result, offline: false };
        } catch (error) {
          if (!isConnectionError(error)) {
            throw error;
          }
          setOnline(false);
        }
      }

      enqueue(item);
      const entry: Entry | undefined = checkinStore
        .list(eventId)
        ?.entries.find((candidate) => candidate.tokenHash === tokenHash);
      if (!entry) {
        return { result: { status: 'unknown' }, offline: true };
      }
      const guest = {
        guestName: entry.guestName,
        folio: entry.folio,
        ticketName: entry.ticketName,
      };
      if (entry.checkedInAt) {
        return {
          offline: true,
          result: {
            status: 'duplicate',
            ...guest,
            checkedInAt: entry.checkedInAt,
            accessPointName: 'Lista de este dispositivo',
            operatorName: null,
          },
        };
      }
      markEntered(tokenHash, item.scannedAt);
      return {
        offline: true,
        result: {
          status: 'ok',
          ...guest,
          checkedInAt: item.scannedAt,
          raffleFolio: null,
        },
      };
    },
    [accessPointId, csrfToken, enqueue, eventId, markEntered],
  );

  useEffect(() => {
    const firstLoad = setTimeout(() => void refreshList(), 0);
    const goOnline = () => {
      setOnline(true);
      void refreshSession().then(() => {
        void sync();
        void refreshList();
      });
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const syncTimer = setInterval(() => void sync(), SYNC_EVERY_MS);
    const refreshTimer = setInterval(() => {
      void sync().then(refreshList);
    }, REFRESH_EVERY_MS);
    return () => {
      clearTimeout(firstLoad);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(syncTimer);
      clearInterval(refreshTimer);
    };
  }, [refreshList, refreshSession, sync]);

  useEffect(() => {
    if (!csrfToken) {
      return undefined;
    }
    const timer = setTimeout(() => void sync(), 0);
    return () => clearTimeout(timer);
  }, [csrfToken, sync]);

  return {
    entries: list?.entries ?? [],
    listGeneratedAt: list?.generatedAt ?? null,
    queueSize,
    online,
    needsLogin,
    conflicts,
    admit,
    sync,
    refreshList,
  };
}
