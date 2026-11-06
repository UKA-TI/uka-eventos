import { useMutation } from '@tanstack/react-query';
import {
  ticketTypeInputSchema,
  type EventDetail,
  type TicketTypeRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Notice } from '../components/ui.js';
import { dateTimeInZoneToIso, toLocalDateTime } from './dates.js';
import { formatEventDate, formatMoney, issuesToErrors } from './text.js';

const emptyForm = {
  name: '',
  description: '',
  price: '',
  capacity: '',
  seatsIncluded: '1',
  salesStart: '',
  salesEnd: '',
  active: true,
};

export function EventTicketsTab({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => Promise<void>;
}) {
  const { can, csrfToken } = usePermissions();
  const canEdit = can('events.edit');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const open = (ticket?: TicketTypeRecord) => {
    setEditingId(ticket?.id ?? null);
    setErrors({});
    setNotice(undefined);
    setForm(
      ticket
        ? {
            name: ticket.name,
            description: ticket.description ?? '',
            price: String(ticket.price),
            capacity: ticket.capacity?.toString() ?? '',
            seatsIncluded: String(ticket.seatsIncluded),
            salesStart: ticket.salesStart
              ? toLocalDateTime(ticket.salesStart, event.timeZone)
              : '',
            salesEnd: ticket.salesEnd
              ? toLocalDateTime(ticket.salesEnd, event.timeZone)
              : '',
            active: ticket.active,
          }
        : emptyForm,
    );
    setFormOpen(true);
  };

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        editingId
          ? `/api/events/${event.id}/tickets/${editingId}`
          : `/api/events/${event.id}/tickets`,
        jsonRequest(editingId ? 'PUT' : 'POST', input, csrfToken),
      ),
    onSuccess: async () => {
      await onChanged();
      setFormOpen(false);
      setNotice({ kind: 'ok', text: 'Tipo de boleto guardado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el boleto.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async (ticket: TicketTypeRecord) =>
      apiRequest(
        `/api/events/${event.id}/tickets/${ticket.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await onChanged();
      setNotice({ kind: 'ok', text: 'Tipo de boleto eliminado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar el boleto.'),
      }),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setNotice(undefined);
    const parsed = ticketTypeInputSchema.safeParse({
      name: form.name,
      description: form.description.trim() || null,
      price: form.price === '' ? 0 : Number(form.price),
      capacity: form.capacity === '' ? null : Number(form.capacity),
      seatsIncluded: Number(form.seatsIncluded),
      salesStart: form.salesStart
        ? dateTimeInZoneToIso(form.salesStart, event.timeZone)
        : null,
      salesEnd: form.salesEnd
        ? dateTimeInZoneToIso(form.salesEnd, event.timeZone)
        : null,
      active: form.active,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const planned = event.ticketTypes
    .filter((ticket) => ticket.active && ticket.capacity !== null)
    .reduce(
      (total, ticket) => total + (ticket.capacity ?? 0) * ticket.seatsIncluded,
      0,
    );
  const exceeds = event.capacity !== null && planned > event.capacity;

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {exceeds && (
        <p className="notice warn" role="status">
          Los cupos de los boletos suman {planned.toLocaleString('es-MX')}{' '}
          lugares y el aforo del evento es de{' '}
          {event.capacity?.toLocaleString('es-MX')}.
        </p>
      )}

      {formOpen && (
        <form className="panel event-config-form" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>{editingId ? 'Editar boleto' : 'Nuevo tipo de boleto'}</h2>
          </div>
          <div className="form-grid">
            <Field
              label="Nombre"
              error={errors.name}
              hint="Por ejemplo: Individual, Mesa de 10, Cortesía."
            >
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label={`Precio (${event.currency})`}
              error={errors.price}
              hint="Déjalo vacío o en 0 si es gratuito."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>
            <Field
              label="Lugares que incluye"
              error={errors.seatsIncluded}
              hint="Una mesa de 10 incluye 10 lugares."
            >
              <input
                type="number"
                min="1"
                value={form.seatsIncluded}
                onChange={(e) =>
                  setForm({ ...form, seatsIncluded: e.target.value })
                }
              />
            </Field>
            <Field
              label="Boletos disponibles"
              error={errors.capacity}
              hint="Déjalo vacío para no limitarlo."
            >
              <input
                type="number"
                min="1"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </Field>
            <Field label="Inicio de venta" error={errors.salesStart}>
              <input
                type="datetime-local"
                value={form.salesStart}
                onChange={(e) =>
                  setForm({ ...form, salesStart: e.target.value })
                }
              />
            </Field>
            <Field label="Fin de venta" error={errors.salesEnd}>
              <input
                type="datetime-local"
                value={form.salesEnd}
                onChange={(e) => setForm({ ...form, salesEnd: e.target.value })}
              />
            </Field>
            <div className="span-all">
              <Field label="Descripción" error={errors.description}>
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Disponible para la venta
            </label>
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? 'Guardando…' : 'Guardar boleto'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="panel table-panel event-config-panel">
        <div className="panel-heading table-heading">
          <h2>Tipos de boleto</h2>
          {canEdit && (
            <button
              className="button primary small"
              type="button"
              onClick={() => open()}
            >
              Agregar boleto
            </button>
          )}
        </div>
        {event.ticketTypes.length === 0 ? (
          <p className="muted">
            Agrega al menos un boleto, aunque el evento sea gratuito.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Boleto</th>
                  <th>Precio</th>
                  <th>Lugares</th>
                  <th>Disponibles</th>
                  <th>Venta</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {event.ticketTypes.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <strong>{ticket.name}</strong>
                      {ticket.description && (
                        <small className="cell-note">
                          {ticket.description}
                        </small>
                      )}
                    </td>
                    <td>{formatMoney(ticket.price, event.currency)}</td>
                    <td>{ticket.seatsIncluded}</td>
                    <td>
                      {ticket.capacity?.toLocaleString('es-MX') ?? 'Sin límite'}
                    </td>
                    <td>
                      {ticket.salesStart || ticket.salesEnd
                        ? `${
                            ticket.salesStart
                              ? formatEventDate(
                                  ticket.salesStart,
                                  event.timeZone,
                                )
                              : 'Ya'
                          } – ${
                            ticket.salesEnd
                              ? formatEventDate(ticket.salesEnd, event.timeZone)
                              : 'sin fin'
                          }`
                        : 'Siempre'}
                    </td>
                    <td>
                      <span
                        className={ticket.active ? 'badge ok' : 'badge neutral'}
                      >
                        {ticket.active ? 'A la venta' : 'Pausado'}
                      </span>
                    </td>
                    <td className="row-actions">
                      {canEdit && (
                        <>
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => open(ticket)}
                          >
                            Editar
                          </button>
                          <button
                            className="link-button danger"
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Borrar el boleto "${ticket.name}"?`,
                                )
                              ) {
                                setNotice(undefined);
                                remove.mutate(ticket);
                              }
                            }}
                          >
                            Borrar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
