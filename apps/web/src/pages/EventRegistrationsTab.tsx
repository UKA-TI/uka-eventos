import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  orderInputSchema,
  orderListResponseSchema,
  paymentInputSchema,
  paymentMethods,
  type EventDetail,
  type OrderRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice } from '../components/ui.js';
import { dateTimeInZoneToIso, toLocalDateTime } from './dates.js';
import { ReconciledOrderForm } from './ReconciledOrderForm.js';
import { formatMoney, issuesToErrors } from './text.js';

const orderStatus: Record<string, [string, string]> = {
  pending_payment: ['Pendiente de pago', 'warn'],
  confirmed: ['Confirmado', 'ok'],
  cancelled: ['Cancelado', 'bad'],
};

const emailStatus: Record<string, string> = {
  pending: 'Correo en cola',
  sending: 'Enviando correo',
  sent: 'Correo enviado',
  failed: 'Correo con error',
  skipped: 'Correo omitido',
};

const methodLabels = Object.fromEntries(
  paymentMethods.map((method) => [method.key, method.label]),
);

type NoticeState = { kind: 'ok' | 'error'; text: string };

function PaymentForm({
  event,
  order,
  onDone,
  onCancel,
}: {
  event: EventDetail;
  order: OrderRecord;
  onDone: (completed: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const { csrfToken } = usePermissions();
  const [form, setForm] = useState({
    amount: String(Math.max(order.amountDue - order.amountPaid, 0)),
    method: 'transfer',
    reference: '',
    notes: '',
    paidAt: toLocalDateTime(new Date().toISOString(), event.timeZone),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        `/api/events/${event.id}/orders/${order.id}/payments`,
        jsonRequest('POST', input, csrfToken),
      ) as Promise<{ completed: boolean }>,
    onSuccess: (result) => onDone(result.completed),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const parsed = paymentInputSchema.safeParse({
      amount: Number(form.amount),
      method: form.method,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      paidAt: form.paidAt
        ? dateTimeInZoneToIso(form.paidAt, event.timeZone)
        : '',
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
      <h3>Registrar pago de {order.reference}</h3>
      {save.isError && (
        <Notice>
          {errorText(save.error, 'No se pudo registrar el pago.')}
        </Notice>
      )}
      <div className="form-grid">
        <Field label={`Monto (${event.currency})`} error={errors.amount}>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </Field>
        <Field label="Forma de pago" error={errors.method}>
          <select
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
          >
            {paymentMethods.map((method) => (
              <option key={method.key} value={method.key}>
                {method.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha de pago" error={errors.paidAt}>
          <input
            type="datetime-local"
            value={form.paidAt}
            onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
          />
        </Field>
        <Field label="Referencia bancaria (opcional)" error={errors.reference}>
          <input
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
        </Field>
        <div className="span-all">
          <Field label="Notas (opcional)" error={errors.notes}>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <p className="muted form-note">
        Al completar el total se confirma el pedido y se envían los pases.
      </p>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? 'Guardando…' : 'Registrar pago'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function NewOrderForm({
  event,
  onDone,
  onCancel,
}: {
  event: EventDetail;
  onDone: (reference: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { csrfToken } = usePermissions();
  const tickets = event.ticketTypes.filter((ticket) => ticket.active);
  const fields = event.formFields.filter((field) => field.active);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    organization: '',
    ticketTypeId: tickets.length === 1 ? tickets[0]!.id : '',
  });
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        `/api/events/${event.id}/orders`,
        jsonRequest('POST', input, csrfToken),
      ) as Promise<{ reference: string }>,
    onSuccess: (result) => onDone(result.reference),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const parsed = orderInputSchema.safeParse({
      ...form,
      organization: form.organization.trim() || null,
      answers,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="panel-heading">
        <h2>Nuevo registro</h2>
      </div>
      <p className="muted form-note">
        Para ventas directas. Avísale a la persona que sus datos se tratan
        conforme al aviso de privacidad.
      </p>
      {save.isError && (
        <Notice>
          {errorText(save.error, 'No se pudo crear el registro.')}
        </Notice>
      )}
      <div className="form-grid">
        <Field label="Boleto" error={errors.ticketTypeId}>
          <select
            value={form.ticketTypeId}
            onChange={(e) => setForm({ ...form, ticketTypeId: e.target.value })}
          >
            <option value="">Selecciona un boleto</option>
            {tickets.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.name} · {formatMoney(ticket.price, event.currency)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nombre" error={errors.firstName}>
          <input
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </Field>
        <Field label="Apellidos" error={errors.lastName}>
          <input
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </Field>
        <Field label="Correo" error={errors.email}>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Teléfono" error={errors.phone}>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field label="Empresa u organización (opcional)">
          <input
            value={form.organization}
            onChange={(e) => setForm({ ...form, organization: e.target.value })}
          />
        </Field>
        {fields.map((field) =>
          field.type === 'checkbox' ? (
            <label className="check-field" key={field.id}>
              <input
                type="checkbox"
                checked={answers[field.id] === true}
                onChange={(e) =>
                  setAnswers({ ...answers, [field.id]: e.target.checked })
                }
              />
              {field.label}
            </label>
          ) : (
            <Field
              key={field.id}
              label={field.required ? field.label : `${field.label} (opcional)`}
            >
              {field.type === 'select' ? (
                <select
                  value={String(answers[field.id] ?? '')}
                  onChange={(e) =>
                    setAnswers({ ...answers, [field.id]: e.target.value })
                  }
                >
                  <option value="">Selecciona una opción</option>
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={String(answers[field.id] ?? '')}
                  onChange={(e) =>
                    setAnswers({ ...answers, [field.id]: e.target.value })
                  }
                />
              )}
            </Field>
          ),
        )}
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? 'Guardando…' : 'Crear registro'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function EventRegistrationsTab({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const canManage = can('registrations.manage');
  const canPay = can('payments.manage');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>();

  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set('status', status);
  if (search.trim()) params.set('q', search.trim());

  const orders = useQuery({
    queryKey: ['orders', event.id, params.toString()],
    queryFn: async () =>
      orderListResponseSchema.parse(
        await apiRequest(`/api/events/${event.id}/orders?${params.toString()}`),
      ),
    placeholderData: (previous) => previous,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['orders', event.id] });
    await onChanged();
  };

  const act = useMutation({
    mutationFn: async (action: { path: string; success: string }) => {
      await apiRequest(
        `/api/events/${event.id}/orders/${action.path}`,
        jsonRequest('POST', undefined, csrfToken),
      );
      return action.success;
    },
    onSuccess: async (success) => {
      await refresh();
      setNotice({ kind: 'ok', text: success });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo completar la acción.'),
      }),
  });

  if (orders.isPending) {
    return <Loading />;
  }
  if (orders.isError) {
    return <Notice>{orders.error.message}</Notice>;
  }

  const { summary, total, pageSize } = orders.data;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <>
      <div className="stats">
        <article className="stat">
          <span>Lugares ocupados</span>
          <strong>
            {summary.seatsTaken.toLocaleString('es-MX')}
            {event.capacity ? (
              <small> de {event.capacity.toLocaleString('es-MX')}</small>
            ) : null}
          </strong>
        </article>
        <article className="stat">
          <span>Lugares confirmados</span>
          <strong>{summary.seatsConfirmed.toLocaleString('es-MX')}</strong>
        </article>
        <article className="stat">
          <span>Lugares por registrar</span>
          <strong>{summary.seatsToRegister.toLocaleString('es-MX')}</strong>
        </article>
        <article className="stat">
          <span>Cobrado</span>
          <strong>
            {summary.amountCollected.toLocaleString('es-MX', {
              style: 'currency',
              currency: event.currency,
            })}
          </strong>
        </article>
        <article className="stat">
          <span>Por cobrar</span>
          <strong>
            {summary.amountPending.toLocaleString('es-MX', {
              style: 'currency',
              currency: event.currency,
            })}
          </strong>
        </article>
      </div>

      {!summary.mailConfigured && (
        <p className="notice warn" role="status">
          El correo todavía no está conectado. Hay {summary.emailsQueued}{' '}
          {summary.emailsQueued === 1 ? 'mensaje' : 'mensajes'} en cola; se
          enviarán al conectarlo.
        </p>
      )}
      {summary.mailConfigured && summary.mailProblem && (
        <p className="notice warn" role="status">
          El correo no se está enviando, pero los mensajes esperan en la cola:{' '}
          {summary.mailProblem}
        </p>
      )}
      {summary.emailsFailed > 0 && (
        <p className="notice error" role="alert">
          {summary.emailsFailed}{' '}
          {summary.emailsFailed === 1
            ? 'correo no se pudo enviar'
            : 'correos no se pudieron enviar'}
          .{' '}
          {canManage && (
            <button
              className="link-button"
              type="button"
              disabled={act.isPending}
              onClick={() => {
                setNotice(undefined);
                act.mutate({
                  path: 'retry-emails',
                  success: 'Los correos volvieron a la cola.',
                });
              }}
            >
              Reintentar
            </button>
          )}
        </p>
      )}
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {reconciling && (
        <ReconciledOrderForm
          event={event}
          onCancel={() => setReconciling(false)}
          onDone={async (reference) => {
            await refresh();
            setReconciling(false);
            setNotice({
              kind: 'ok',
              text: `Compra ${reference} conciliada. Se envió la invitación para registrarse.`,
            });
          }}
        />
      )}

      {creating && (
        <NewOrderForm
          event={event}
          onCancel={() => setCreating(false)}
          onDone={async (reference) => {
            await refresh();
            setCreating(false);
            setNotice({ kind: 'ok', text: `Registro ${reference} creado.` });
          }}
        />
      )}

      <div className="filters">
        <input
          type="search"
          placeholder="Buscar por nombre, correo, empresa o folio"
          aria-label="Buscar registro"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los estados</option>
          <option value="pending_payment">Pendiente de pago</option>
          <option value="confirmed">Confirmado</option>
          <option value="cancelled">Cancelado</option>
        </select>
        {can('payments.manage') &&
          event.status === 'active' &&
          !reconciling && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setCreating(false);
                setReconciling(true);
              }}
            >
              Conciliar compra
            </button>
          )}
        {canManage && event.status === 'active' && !creating && (
          <button
            className="button primary"
            type="button"
            onClick={() => {
              setNotice(undefined);
              setCreating(true);
            }}
          >
            Nuevo registro
          </button>
        )}
      </div>

      <div className="panel table-panel">
        {orders.data.orders.length === 0 ? (
          <p className="muted">
            {total === 0 && !search && !status
              ? 'Aún no hay registros en este evento.'
              : 'Ningún registro coincide con la búsqueda.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Comprador</th>
                  <th>Boleto</th>
                  <th>Lugares</th>
                  <th>Pagado</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              {orders.data.orders.map((order) => {
                const [label, tone] = orderStatus[order.status]!;
                const open = openId === order.id;
                const remaining = order.amountDue - order.amountPaid;
                return (
                  <tbody key={order.id}>
                    <tr>
                      <td>
                        <strong>{order.reference}</strong>
                      </td>
                      <td>
                        {order.buyer.firstName} {order.buyer.lastName}
                        <small className="cell-note">
                          {order.buyer.organization ?? order.buyer.email}
                        </small>
                      </td>
                      <td>{order.ticketName}</td>
                      <td>
                        {order.seats}
                        {order.status === 'confirmed' &&
                          (order.seats > 1 ||
                            order.source === 'reconciled') && (
                            <small className="cell-note">
                              {
                                order.registrations.filter(
                                  (item) => item.status !== 'cancelled',
                                ).length
                              }{' '}
                              registrados
                            </small>
                          )}
                      </td>
                      <td>
                        {order.amountDue === 0
                          ? 'Gratis'
                          : `${order.amountPaid.toLocaleString('es-MX', { style: 'currency', currency: event.currency })} de ${formatMoney(order.amountDue, event.currency)}`}
                      </td>
                      <td>
                        <span className={`badge ${tone}`}>{label}</span>
                      </td>
                      <td className="row-actions">
                        {canPay &&
                          order.status === 'pending_payment' &&
                          remaining > 0 && (
                            <button
                              className="link-button"
                              type="button"
                              onClick={() => {
                                setNotice(undefined);
                                setOpenId(order.id);
                                setPayingId(order.id);
                              }}
                            >
                              Registrar pago
                            </button>
                          )}
                        <button
                          className="link-button"
                          type="button"
                          aria-expanded={open}
                          onClick={() => {
                            setOpenId(open ? null : order.id);
                            setPayingId(null);
                          }}
                        >
                          {open ? 'Ocultar' : 'Ver'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={7}>
                          <div className="order-detail">
                            {payingId === order.id && (
                              <PaymentForm
                                event={event}
                                order={order}
                                onCancel={() => setPayingId(null)}
                                onDone={async (completed) => {
                                  await refresh();
                                  setPayingId(null);
                                  setNotice({
                                    kind: 'ok',
                                    text: completed
                                      ? `Pago registrado. ${order.reference} quedó confirmado y sus pases están en la cola de correo.`
                                      : 'Pago parcial registrado.',
                                  });
                                }}
                              />
                            )}
                            <div className="detail-columns">
                              <div>
                                <h3>Contacto</h3>
                                <p>
                                  {order.buyer.email ?? 'Sin correo'}
                                  <br />
                                  {order.buyer.phone ?? 'Sin teléfono'}
                                </p>
                                {order.answers.length > 0 && (
                                  <>
                                    <h3>Respuestas</h3>
                                    <ul className="compact-list">
                                      {order.answers.map((answer) => (
                                        <li key={answer.label}>
                                          {answer.label}:{' '}
                                          <strong>{answer.value || '—'}</strong>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                )}
                              </div>
                              <div>
                                <h3>Pases</h3>
                                {order.registrations.length === 0 ? (
                                  <p className="muted">
                                    {order.seats > 1
                                      ? 'Los invitados se capturan con la liga privada una vez confirmado el pago.'
                                      : 'Sin pases todavía.'}
                                  </p>
                                ) : (
                                  <ul className="compact-list">
                                    {order.registrations.map((registration) => (
                                      <li key={registration.id}>
                                        <strong>
                                          {registration.guestName}
                                        </strong>{' '}
                                        ({registration.folio})
                                        {registration.status === 'cancelled' &&
                                          ' · Cancelado'}
                                        {registration.emailStatus && (
                                          <small className="cell-note">
                                            {
                                              emailStatus[
                                                registration.emailStatus
                                              ]
                                            }
                                          </small>
                                        )}
                                        {registration.passUrl && (
                                          <span className="inline-actions">
                                            <a
                                              href={registration.passUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              Ver pase
                                            </a>
                                            {canManage && (
                                              <button
                                                className="link-button"
                                                type="button"
                                                disabled={act.isPending}
                                                onClick={() => {
                                                  setNotice(undefined);
                                                  act.mutate({
                                                    path: `registrations/${registration.id}/resend`,
                                                    success:
                                                      'El pase se agregó a la cola de correo.',
                                                  });
                                                }}
                                              >
                                                Reenviar
                                              </button>
                                            )}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {order.groupUrl && (
                                  <p className="inline-actions">
                                    <a
                                      href={order.groupUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Abrir liga de registro
                                    </a>
                                    <button
                                      className="link-button"
                                      type="button"
                                      disabled={act.isPending}
                                      onClick={() => {
                                        setNotice(undefined);
                                        act.mutate({
                                          path: `${order.id}/resend-link`,
                                          success:
                                            'La liga se agregó a la cola de correo.',
                                        });
                                      }}
                                    >
                                      Reenviar liga
                                    </button>
                                  </p>
                                )}
                              </div>
                              <div>
                                <h3>Pagos</h3>
                                {order.payments.length === 0 ? (
                                  <p className="muted">Sin pagos.</p>
                                ) : (
                                  <ul className="compact-list">
                                    {order.payments.map((payment) => (
                                      <li
                                        key={payment.id}
                                        className={
                                          payment.voidedAt
                                            ? 'voided'
                                            : undefined
                                        }
                                      >
                                        <strong>
                                          {formatMoney(
                                            payment.amount,
                                            event.currency,
                                          )}
                                        </strong>{' '}
                                        · {methodLabels[payment.method]}
                                        {payment.voidedAt && ' · Anulado'}
                                        <small className="cell-note">
                                          {new Date(
                                            payment.paidAt,
                                          ).toLocaleDateString('es-MX', {
                                            timeZone: event.timeZone,
                                            dateStyle: 'medium',
                                          })}
                                          {payment.reference
                                            ? ` · ${payment.reference}`
                                            : ''}
                                          {payment.recordedBy
                                            ? ` · ${payment.recordedBy}`
                                            : ''}
                                        </small>
                                        {canPay && !payment.voidedAt && (
                                          <button
                                            className="link-button danger"
                                            type="button"
                                            disabled={act.isPending}
                                            onClick={() => {
                                              if (
                                                window.confirm(
                                                  'Si este pago deja el pedido incompleto, sus pases dejarán de ser válidos. ¿Anular el pago?',
                                                )
                                              ) {
                                                setNotice(undefined);
                                                act.mutate({
                                                  path: `${order.id}/payments/${payment.id}/void`,
                                                  success: 'Pago anulado.',
                                                });
                                              }
                                            }}
                                          >
                                            Anular
                                          </button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                            {canManage && order.status !== 'cancelled' && (
                              <div className="form-actions">
                                <button
                                  className="button secondary small danger"
                                  type="button"
                                  disabled={act.isPending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `¿Cancelar ${order.reference}? Sus pases dejarán de ser válidos y se liberarán sus lugares.`,
                                      )
                                    ) {
                                      setNotice(undefined);
                                      act.mutate({
                                        path: `${order.id}/cancel`,
                                        success: 'Pedido cancelado.',
                                      });
                                    }
                                  }}
                                >
                                  Cancelar pedido
                                </button>
                              </div>
                            )}
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
      {pages > 1 && (
        <div className="pagination">
          <button
            className="button secondary small"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} de {pages}
          </span>
          <button
            className="button secondary small"
            type="button"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </>
  );
}
