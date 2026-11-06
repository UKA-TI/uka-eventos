import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  financialStatusLabels,
  orderInputSchema,
  orderListResponseSchema,
  paymentInputSchema,
  paymentMethods,
  type EventDetail,
  type OrderRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice } from '../components/ui.js';
import { dateTimeInZoneToIso, toLocalDateTime } from './dates.js';
import {
  CancelOrderForm,
  DueDateForm,
  FiscalForm,
  RefundForm,
} from './OrderFinanceForms.js';
import { ReconciledOrderForm } from './ReconciledOrderForm.js';
import { formatAmount, formatMoney, issuesToErrors } from './text.js';

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
    quantity: '1',
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
      quantity: Number(form.quantity),
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
        <h2>Nueva compra</h2>
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
        <Field
          label="Cantidad de boletos"
          error={errors.quantity}
          hint="Con más de un lugar, al pagarse se envía una liga para registrar a cada invitado."
        >
          <input
            type="number"
            min="1"
            max="50"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
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
  const canCollect = can('payments.manage', 'finance.manage');
  const canRefund = can('refunds.manage');
  const isClosed = event.status === 'closed';
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [panel, setPanel] = useState<{
    kind: 'refund' | 'cancel' | 'due' | 'fiscal' | 'name';
    orderId: string;
    registrationId?: string;
  } | null>(null);
  const [openIdFromLink] = useState(() => searchParams.get('q'));
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
    <div className="finance-page">
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
          <span>Cobrado por boletos</span>
          <strong>
            {formatAmount(summary.amountCollected, event.currency)}
          </strong>
          {summary.amountRefunded > 0 && (
            <small>
              Ya descuenta{' '}
              {formatAmount(summary.amountRefunded, event.currency)} de
              reembolsos
            </small>
          )}
        </article>
        <article className="stat">
          <span>Por cobrar</span>
          <strong>{formatAmount(summary.amountPending, event.currency)}</strong>
          {summary.amountOverdue > 0 && (
            <small>
              {formatAmount(summary.amountOverdue, event.currency)} vencido
            </small>
          )}
        </article>
      </div>

      {!summary.mailConfigured && (
        <p className="notice warn" role="status">
          El correo todavía no está conectado.{' '}
          {summary.emailsQueued > 0 &&
            `${summary.emailsQueued === 1 ? 'Hay 1 mensaje en cola; se enviará' : `Hay ${summary.emailsQueued} mensajes en cola; se enviarán`} al conectarlo.`}
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
              text: `Compra ${reference} conciliada. La invitación para registrarse ya está en la cola de correo.`,
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
            setNotice({ kind: 'ok', text: `Compra ${reference} creada.` });
          }}
        />
      )}

      <div className="filters">
        <label className="filter-field filter-search">
          <span>Buscar registro</span>
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
        </label>
        <label className="filter-field">
          <span>Estado</span>
          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            <option value="pending_payment">Con saldo</option>
            <option value="partial">Pagada parcial</option>
            <option value="overdue">Vencida</option>
            <option value="confirmed">Confirmada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
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
              Compra ya pagada
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
            Nueva compra
          </button>
        )}
      </div>

      <div className="panel table-panel">
        <div className="panel-heading finance-list-heading">
          <h2>Compras del evento</h2>
          <span className="result-count">
            {total.toLocaleString('es-MX')} {total === 1 ? 'compra' : 'compras'}
          </span>
        </div>
        {orders.data.orders.length === 0 ? (
          <p className="muted">
            {total === 0 && !search && !status
              ? 'Aún no hay registros en este evento.'
              : 'Ningún registro coincide con la búsqueda.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Comprador</th>
                  <th>Boleto</th>
                  <th>Pagado</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              {orders.data.orders.map((order) => {
                const [label, tone] = financialStatusLabels[
                  order.financialStatus
                ] ?? [order.financialStatus, 'neutral'];
                const open =
                  openId === order.id ||
                  (openId === null && openIdFromLink === order.reference);
                const remaining = order.balance;
                const overdue =
                  order.status === 'pending_payment' &&
                  order.dueAt !== null &&
                  new Date(order.dueAt) < new Date();
                const net = order.amountPaid - order.amountRefunded;
                const finishPanel = async (text: string) => {
                  await refresh();
                  setPanel(null);
                  setNotice({ kind: 'ok', text });
                };
                return (
                  <tbody key={order.id}>
                    <tr>
                      <td data-label="Referencia">
                        <div className="finance-cell-content">
                          <strong>{order.reference}</strong>
                        </div>
                      </td>
                      <td data-label="Comprador">
                        <div className="finance-cell-content">
                          {order.buyer.firstName} {order.buyer.lastName}
                          <small className="cell-note">
                            {order.buyer.organization ?? order.buyer.email}
                          </small>
                        </div>
                      </td>
                      <td data-label="Boleto">
                        <div className="finance-cell-content">
                          {order.ticketName}
                          <small className="cell-note">
                            {order.seats}{' '}
                            {order.seats === 1 ? 'lugar' : 'lugares'}
                          </small>
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
                        </div>
                      </td>
                      <td data-label="Pagado">
                        <div className="finance-cell-content">
                          {order.amountDue === 0 ? (
                            'Gratis'
                          ) : (
                            <>
                              {formatAmount(order.amountPaid, event.currency)}
                              <small className="cell-note">
                                De{' '}
                                {formatAmount(order.amountDue, event.currency)}
                              </small>
                            </>
                          )}
                          {order.amountRefunded > 0 && (
                            <small className="cell-note">
                              Devuelto{' '}
                              {formatAmount(
                                order.amountRefunded,
                                event.currency,
                              )}
                            </small>
                          )}
                          {order.dueAt &&
                            order.status === 'pending_payment' && (
                              <small className="cell-note">
                                {overdue ? 'Venció el ' : 'Vence el '}
                                {new Date(order.dueAt).toLocaleDateString(
                                  'es-MX',
                                  {
                                    timeZone: event.timeZone,
                                    dateStyle: 'medium',
                                  },
                                )}
                              </small>
                            )}
                        </div>
                      </td>
                      <td data-label="Estado">
                        <div className="finance-cell-content">
                          <span className={`badge ${tone}`}>{label}</span>
                        </div>
                      </td>
                      <td className="row-actions" data-label="Acciones">
                        <div className="finance-cell-content">
                          {canPay &&
                            !isClosed &&
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
                              setOpenId(open ? '' : order.id);
                              setPayingId(null);
                              setPanel(null);
                            }}
                          >
                            {open ? 'Ocultar' : 'Ver'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <div className="order-detail">
                            <dl className="order-money-summary">
                              <div>
                                <dt>Total de la compra</dt>
                                <dd>
                                  {formatAmount(
                                    order.amountDue,
                                    event.currency,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Pagado</dt>
                                <dd>
                                  {formatAmount(
                                    order.amountPaid,
                                    event.currency,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Saldo pendiente</dt>
                                <dd>
                                  {formatAmount(order.balance, event.currency)}
                                </dd>
                              </div>
                              <div>
                                <dt>Reembolsado</dt>
                                <dd>
                                  {formatAmount(
                                    order.amountRefunded,
                                    event.currency,
                                  )}
                                </dd>
                              </div>
                            </dl>
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
                            {panel?.orderId === order.id &&
                              panel.kind === 'refund' && (
                                <RefundForm
                                  event={event}
                                  order={order}
                                  onCancel={() => setPanel(null)}
                                  onDone={finishPanel}
                                />
                              )}
                            {panel?.orderId === order.id &&
                              panel.kind === 'cancel' && (
                                <CancelOrderForm
                                  event={event}
                                  order={order}
                                  onCancel={() => setPanel(null)}
                                  onDone={finishPanel}
                                />
                              )}
                            {panel?.orderId === order.id &&
                              panel.kind === 'due' && (
                                <DueDateForm
                                  orderId={order.id}
                                  eventId={event.id}
                                  timeZone={event.timeZone}
                                  dueAt={order.dueAt}
                                  onCancel={() => setPanel(null)}
                                  onDone={finishPanel}
                                />
                              )}
                            {panel?.orderId === order.id &&
                              panel.kind === 'fiscal' && (
                                <FiscalForm
                                  event={event}
                                  order={order}
                                  onCancel={() => setPanel(null)}
                                  onDone={finishPanel}
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
                                <h3>Factura</h3>
                                {order.fiscal ? (
                                  <p>
                                    <strong>{order.fiscal.rfc}</strong>
                                    <br />
                                    {order.fiscal.legalName}
                                    <small className="cell-note">
                                      {order.invoiceStatus === 'issued'
                                        ? `Factura ${order.invoiceFolio}`
                                        : 'Factura solicitada'}
                                    </small>
                                  </p>
                                ) : (
                                  <p className="muted">No solicitada.</p>
                                )}
                                {canCollect &&
                                  order.invoiceStatus !== 'issued' && (
                                    <button
                                      className="link-button"
                                      type="button"
                                      onClick={() => {
                                        setNotice(undefined);
                                        setPanel({
                                          kind: 'fiscal',
                                          orderId: order.id,
                                        });
                                      }}
                                    >
                                      {order.fiscal
                                        ? 'Editar datos fiscales'
                                        : 'Agregar datos fiscales'}
                                    </button>
                                  )}
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
                                <h3>Invitados</h3>
                                {order.registrations.length === 0 ? (
                                  <p className="muted">
                                    {order.seats > 1
                                      ? 'Los invitados se registran con la liga privada cuando el pago está confirmado.'
                                      : 'Sin invitado todavía.'}
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
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {order.registrations.length > 0 && (
                                  <p className="inline-actions">
                                    <Link
                                      to={`/eventos/${event.id}?tab=invitados&compra=${order.id}`}
                                    >
                                      Ver pases, reenviar o cambiar nombres
                                    </Link>
                                  </p>
                                )}
                                {order.groupUrl && (
                                  <p className="inline-actions">
                                    <Link to={`/eventos/${event.id}?tab=mesas`}>
                                      Ver el avance en Asistentes › Registro por
                                      grupo
                                    </Link>
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
                                        {canPay &&
                                          !payment.voidedAt &&
                                          !isClosed && (
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
                                {order.refunds.length > 0 && (
                                  <>
                                    <h3>Reembolsos</h3>
                                    <ul className="compact-list">
                                      {order.refunds.map((refund) => (
                                        <li
                                          key={refund.id}
                                          className={
                                            refund.voidedAt
                                              ? 'voided'
                                              : undefined
                                          }
                                        >
                                          <strong>
                                            {formatAmount(
                                              refund.amount,
                                              event.currency,
                                            )}
                                          </strong>{' '}
                                          · {methodLabels[refund.method]}
                                          {refund.voidedAt && ' · Anulado'}
                                          <small className="cell-note">
                                            {new Date(
                                              refund.refundedAt,
                                            ).toLocaleDateString('es-MX', {
                                              timeZone: event.timeZone,
                                              dateStyle: 'medium',
                                            })}{' '}
                                            · {refund.reason}
                                            {refund.recordedBy
                                              ? ` · ${refund.recordedBy}`
                                              : ''}
                                          </small>
                                          {canRefund &&
                                            !refund.voidedAt &&
                                            !isClosed && (
                                              <button
                                                className="link-button danger"
                                                type="button"
                                                disabled={act.isPending}
                                                onClick={() => {
                                                  if (
                                                    window.confirm(
                                                      'Anula un reembolso solo si se capturó por error. ¿Anularlo?',
                                                    )
                                                  ) {
                                                    setNotice(undefined);
                                                    act.mutate({
                                                      path: `${order.id}/refunds/${refund.id}/void`,
                                                      success:
                                                        'Reembolso anulado.',
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
                                  </>
                                )}
                                {order.cancellationReason && (
                                  <p>
                                    <small className="cell-note">
                                      Motivo de cancelación:{' '}
                                      {order.cancellationReason}
                                    </small>
                                  </p>
                                )}
                              </div>
                            </div>
                            {!isClosed && (
                              <div className="form-actions">
                                {canCollect &&
                                  order.status === 'pending_payment' && (
                                    <>
                                      <button
                                        className="button secondary small"
                                        type="button"
                                        disabled={act.isPending}
                                        onClick={() => {
                                          setNotice(undefined);
                                          act.mutate({
                                            path: `${order.id}/remind`,
                                            success:
                                              'El recordatorio está en la cola de correo.',
                                          });
                                        }}
                                      >
                                        Enviar recordatorio
                                      </button>
                                      <button
                                        className="button secondary small"
                                        type="button"
                                        onClick={() => {
                                          setNotice(undefined);
                                          setPanel({
                                            kind: 'due',
                                            orderId: order.id,
                                          });
                                        }}
                                      >
                                        Cambiar vencimiento
                                      </button>
                                    </>
                                  )}
                                {canRefund &&
                                  order.status !== 'pending_payment' &&
                                  net > 0 && (
                                    <button
                                      className="button secondary small"
                                      type="button"
                                      onClick={() => {
                                        setNotice(undefined);
                                        setPanel({
                                          kind: 'refund',
                                          orderId: order.id,
                                        });
                                      }}
                                    >
                                      Registrar reembolso
                                    </button>
                                  )}
                                {(canManage || canRefund) &&
                                  order.status !== 'cancelled' && (
                                    <button
                                      className="button secondary small danger"
                                      type="button"
                                      onClick={() => {
                                        setNotice(undefined);
                                        setPanel({
                                          kind: 'cancel',
                                          orderId: order.id,
                                        });
                                      }}
                                    >
                                      Cancelar compra
                                    </button>
                                  )}
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
    </div>
  );
}
