import type { CheckinEvent, CheckinItem, OfflineList } from '@uka/shared';

// Lo que recepción necesita sin internet vive en este dispositivo: la lista, las
// lecturas por enviar y quién opera. Todo se borra al cerrar sesión.
const PREFIX = 'uka.checkin.';

function read<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export interface CachedOperator {
  displayName: string;
  roleName: string;
}

export const checkinStore = {
  operator: () => read<CachedOperator>('operator'),
  saveOperator: (operator: CachedOperator) => write('operator', operator),
  events: () => read<CheckinEvent[]>('events') ?? [],
  saveEvents: (events: CheckinEvent[]) => write('events', events),
  list: (eventId: string) => read<OfflineList>(`list.${eventId}`),
  saveList: (eventId: string, list: OfflineList) =>
    write(`list.${eventId}`, list),
  queue: (eventId: string) => read<CheckinItem[]>(`queue.${eventId}`) ?? [],
  saveQueue: (eventId: string, queue: CheckinItem[]) =>
    write(`queue.${eventId}`, queue),
  door: (eventId: string) => read<string>(`door.${eventId}`),
  saveDoor: (eventId: string, doorId: string) =>
    write(`door.${eventId}`, doorId),
  pendingCount() {
    let total = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${PREFIX}queue.`)) {
        total += (read<CheckinItem[]>(key.slice(PREFIX.length)) ?? []).length;
      }
    }
    return total;
  },
  clear() {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  },
};

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** El servidor respondió, aunque sea con un error; lo demás es falta de conexión. */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}
