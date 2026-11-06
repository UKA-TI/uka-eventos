import { useMutation } from '@tanstack/react-query';
import {
  eventDetailResponseSchema,
  eventModuleCatalog,
  type EventDetail,
  type EventModuleKey,
} from '@uka/shared';
import { useState } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Notice } from '../components/ui.js';

export function EventModulesTab({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (saved: EventDetail) => void | Promise<void>;
}) {
  const { can, csrfToken } = usePermissions();
  const canEdit = can('events.edit');
  const [selected, setSelected] = useState<EventModuleKey[]>(event.modules);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const save = useMutation({
    mutationFn: async () =>
      eventDetailResponseSchema.parse(
        await apiRequest(
          `/api/events/${event.id}/modules`,
          jsonRequest('PUT', { modules: selected }, csrfToken),
        ),
      ),
    onSuccess: async (saved) => {
      await onSaved(saved);
      setNotice({ kind: 'ok', text: 'Módulos actualizados.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudieron guardar los módulos.'),
      }),
  });

  const toggle = (key: EventModuleKey) => {
    setNotice(undefined);
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  return (
    <div className="panel event-config-panel">
      <div className="panel-heading">
        <h2>Módulos de este evento</h2>
      </div>
      <p className="muted form-note">
        Activa solo lo que este evento necesita. Las pantallas de cada módulo se
        irán habilitando conforme avance el proyecto.
      </p>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <div className="module-grid">
        {eventModuleCatalog.map((module) => {
          const active = selected.includes(module.key);
          return (
            <label
              key={module.key}
              className={active ? 'module-card active' : 'module-card'}
            >
              <input
                type="checkbox"
                checked={active}
                disabled={!canEdit}
                onChange={() => toggle(module.key)}
              />
              <span>
                <strong>{module.label}</strong>
                <small>{module.description}</small>
              </span>
            </label>
          );
        })}
      </div>
      {canEdit && (
        <div className="form-actions">
          <button
            className="button primary"
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Guardando…' : 'Guardar módulos'}
          </button>
        </div>
      )}
    </div>
  );
}
