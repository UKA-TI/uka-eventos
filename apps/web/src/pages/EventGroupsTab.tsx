import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventGroupsResponseSchema,
  orderDelegateSchema,
  type EventDetail,
  type EventGroup,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice } from '../components/ui.js';
import { ReconciledOrderForm } from './ReconciledOrderForm.js';
import { issuesToErrors } from './text.js';

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('es-MX', { dateStyle: 'medium' });

function DelegateForm({
  event,
  group,
  onCancel,
  onDone,
}: {
  event: EventDetail;
  group: EventGroup;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const { csrfToken } = usePermissions();
  const [form, setForm] = useState({
    delegateName: group.delegateName ?? '',
    delegateEmail: group.delegateEmail ?? '',
    folioPrefix: group.folioPrefix ?? '',
    registrationDeadline: group.registrationDeadline?.slice(0, 10) ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        `/api/events/${event.id}/orders/${group.id}/delegate`,
        jsonRequest('PUT', input, csrfToken),
      ),
    onSuccess: () => onDone(),
    onError: (failure) =>
      setError(errorText(failure, 'No se pudo guardar el contacto.')),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setError('');
    const parsed = orderDelegateSchema.safeParse({
      delegateName: form.delegateName.trim() || null,
      delegateEmail: form.delegateEmail.trim() || null,
      folioPrefix: form.folioPrefix.trim() || null,
      registrationDeadline: form.registrationDeadline
        ? new Date(`${form.registrationDeadline}T12:00:00`).toISOString()
        : null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <form className="inner-form" onSubmit={submit} noValidate>
      <Notice>{error}</Notice>
      <div className="form-grid">
        <Field label="Asistente o contacto" error={errors.delegateName}>
          <input
            value={form.delegateName}
            onChange={(e) => setForm({ ...form, delegateName: e.target.value })}
          />
        </Field>
        <Field
          label="Correo del contacto"
          error={errors.delegateEmail}
          hint="Si cambia, le enviamos la liga para registrar invitados."
        >
          <input
            type="email"
            value={form.delegateEmail}
            onChange={(e) =>
              setForm({ ...form, delegateEmail: e.target.value })
            }
          />
        </Field>
        <Field
          label="Prefijo de folio"
          error={errors.folioPrefix}
          hint="Los nuevos invitados tendrán folios como SORIANA-01."
        >
          <input
            value={form.folioPrefix}
            onChange={(e) => setForm({ ...form, folioPrefix: e.target.value })}
          />
        </Field>
        <Field label="Fecha límite" error={errors.registrationDeadline}>
          <input
            type="date"
            value={form.registrationDeadline}
            onChange={(e) =>
              setForm({ ...form, registrationDeadline: e.target.value })
            }
          />
        </Field>
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function EventGroupsTab({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const key = ['event-groups', event.id];

  const groups = useQuery({
    queryKey: key,
    queryFn: async () =>
      eventGroupsResponseSchema.parse(
        await apiRequest(`/api/events/${event.id}/groups`),
      ),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({
      queryKey: ['event-dashboard', event.id],
    });
    await onChanged();
  };

  const remind = useMutation({
    mutationFn: async (group: EventGroup) =>
      apiRequest(
        `/api/events/${event.id}/orders/${group.id}/resend-link`,
        jsonRequest('POST', undefined, csrfToken),
      ),
    onSuccess: (_result, group) =>
      setNotice({
        kind: 'ok',
        text: `Recordatorio en la cola para ${group.delegateName ?? group.buyerName}.`,
      }),
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo enviar el recordatorio.'),
      }),
  });

  if (groups.isPending) {
    return <Loading />;
  }
  if (groups.isError) {
    return <Notice>{groups.error.message}</Notice>;
  }

  const list = groups.data;
  const canEdit = can('registrations.manage', 'payments.manage');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {can('payments.manage') && event.status === 'active' && !creating && (
        <div className="section-actions">
          <button
            className="button primary"
            type="button"
            onClick={() => {
              setNotice(undefined);
              setCreating(true);
            }}
          >
            Registrar compra de mesa
          </button>
        </div>
      )}
      {creating && (
        <ReconciledOrderForm
          event={event}
          onCancel={() => setCreating(false)}
          onDone={async (reference) => {
            await refresh();
            setCreating(false);
            setNotice({
              kind: 'ok',
              text: `Compra ${reference} registrada. La liga para registrar invitados ya está en la cola de correo.`,
            });
          }}
        />
      )}

      <div className="panel table-panel">
        {list.length === 0 ? (
          <p className="muted">
            Aún no hay mesas. Una compra de varios lugares aparece aquí cuando
            su pago está confirmado.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Contacto</th>
                  <th>Avance</th>
                  <th>Fecha límite</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              {list.map((group) => {
                const late =
                  group.registrationDeadline &&
                  group.registrationDeadline.slice(0, 10) < today &&
                  group.registered < group.seats;
                return (
                  <tbody key={group.id}>
                    <tr>
                      <td>
                        <strong>{group.company}</strong>
                        <small className="cell-note">
                          {group.reference}
                          {group.folioPrefix ? ` · ${group.folioPrefix}` : ''}
                        </small>
                      </td>
                      <td>
                        {group.delegateName ?? group.buyerName}
                        <small className="cell-note">
                          {group.delegateEmail ?? group.buyerEmail}
                        </small>
                      </td>
                      <td>
                        <div className="progress small-progress">
                          <i
                            style={{
                              width: `${(group.registered / group.seats) * 100}%`,
                            }}
                          />
                        </div>
                        <small className="cell-note">
                          {group.registered} de {group.seats} registrados ·{' '}
                          {group.activated} activados
                        </small>
                      </td>
                      <td>
                        {group.registrationDeadline
                          ? shortDate(group.registrationDeadline)
                          : '—'}
                        {late && (
                          <small className="cell-note">
                            <span className="badge warn">Vencida</span>
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {canEdit && group.registered < group.seats && (
                            <button
                              className="link-button"
                              type="button"
                              disabled={remind.isPending}
                              onClick={() => {
                                setNotice(undefined);
                                remind.mutate(group);
                              }}
                            >
                              Recordar
                            </button>
                          )}
                          {group.groupUrl && (
                            <a
                              className="link-button"
                              href={group.groupUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir liga
                            </a>
                          )}
                          {canEdit && (
                            <button
                              className="link-button"
                              type="button"
                              onClick={() =>
                                setEditingId(
                                  editingId === group.id ? null : group.id,
                                )
                              }
                            >
                              Contacto
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {editingId === group.id && (
                      <tr className="detail-row">
                        <td colSpan={5}>
                          <div className="order-detail">
                            <DelegateForm
                              event={event}
                              group={group}
                              onCancel={() => setEditingId(null)}
                              onDone={async () => {
                                await refresh();
                                setEditingId(null);
                                setNotice({
                                  kind: 'ok',
                                  text: 'Contacto de la mesa actualizado.',
                                });
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </div>
    </>
  );
}
