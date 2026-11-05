import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  agingBuckets,
  cancellationPolicyInputSchema,
  cancellationPolicyListSchema,
  financialStatusLabels,
  invoiceQueueSchema,
  orderInvoiceSchema,
  receivablesSchema,
  type CancellationTier,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice, PageHeading } from '../components/ui.js';
import { DueDateForm } from './OrderFinanceForms.js';
import { formatAmount, issuesToErrors } from './text.js';

type View = 'receivables' | 'invoices' | 'policies';
type NoticeState = { kind: 'ok' | 'error'; text: string };

const bucketLabel = Object.fromEntries(
  agingBuckets.map(({ key, label }) => [key, label]),
);

function ReceivablesView() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const canCollect = can('payments.manage', 'finance.manage');
  const [eventId, setEventId] = useState('');
  const [bucket, setBucket] = useState('');
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>();

  const params = new URLSearchParams();
  if (eventId) params.set('eventId', eventId);
  if (bucket) params.set('bucket', bucket);
  if (q.trim()) params.set('q', q.trim());

  const list = useQuery({
    queryKey: ['receivables', params.toString()],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      receivablesSchema.parse(
        await apiRequest(`/api/finance/receivables?${params.toString()}`),
      ),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['receivables'] });

  const remind = useMutation({
    mutationFn: async (row: { eventId: string; orderId: string }) =>
      apiRequest(
        `/api/events/${row.eventId}/orders/${row.orderId}/remind`,
        jsonRequest('POST', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await refresh();
      setNotice({
        kind: 'ok',
        text: 'El recordatorio está en la cola de correo.',
      });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo enviar el recordatorio.'),
      }),
  });

  if (list.isPending) {
    return <Loading />;
  }
  if (list.isError) {
    return <Notice>{list.error.message}</Notice>;
  }

  const { buckets, rows, total, events } = list.data;
  const currency = rows[0]?.currency ?? 'MXN';

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <div className="stats aging-stats">
        <article className="stat">
          <span>Total por cobrar</span>
          <strong>{formatAmount(total, currency)}</strong>
        </article>
        {buckets
          .filter((row) => row.count > 0 || row.key !== 'no_date')
          .map((row) => (
            <button
              key={row.key}
              type="button"
              className={
                bucket === row.key
                  ? 'stat stat-button active'
                  : 'stat stat-button'
              }
              aria-pressed={bucket === row.key}
              onClick={() => setBucket(bucket === row.key ? '' : row.key)}
            >
              <span>{bucketLabel[row.key]}</span>
              <strong>{formatAmount(row.amount, currency)}</strong>
              <small>
                {row.count} {row.count === 1 ? 'compra' : 'compras'}
              </small>
            </button>
          ))}
      </div>
      <div className="filters">
        <input
          type="search"
          aria-label="Buscar comprador"
          placeholder="Comprador, empresa, correo o referencia"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Evento"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">Todos los eventos</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
        {can('reports.export') && rows.length > 0 && (
          <a
            className="button secondary"
            href={`/api/finance/receivables.csv?${params.toString()}`}
          >
            Descargar
          </a>
        )}
      </div>
      {rows
        .filter((row) => row.orderId === editingId)
        .map((row) => (
          <DueDateForm
            key={row.orderId}
            orderId={row.orderId}
            eventId={row.eventId}
            timeZone={row.timeZone}
            dueAt={row.dueAt}
            onCancel={() => setEditingId(null)}
            onDone={async (text) => {
              await refresh();
              setEditingId(null);
              setNotice({ kind: 'ok', text });
            }}
          />
        ))}
      <div className="panel table-panel">
        {rows.length === 0 ? (
          <p className="muted">No hay saldos pendientes con estos filtros.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Comprador</th>
                  <th>Evento</th>
                  <th className="numeric">Saldo</th>
                  <th>Vence</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.orderId}>
                    <td>
                      <strong>{row.buyerName}</strong>
                      <small className="cell-note">
                        {row.organization ?? row.buyerEmail ?? 'Sin correo'}
                      </small>
                    </td>
                    <td>
                      {row.eventName}
                      <small className="cell-note">
                        {row.reference} · {row.ticketName}
                      </small>
                    </td>
                    <td className="numeric">
                      <strong>{formatAmount(row.balance, row.currency)}</strong>
                      <small className="cell-note">
                        {row.amountPaid > 0
                          ? `Pagado ${formatAmount(row.amountPaid, row.currency)}`
                          : `De ${formatAmount(row.amountDue, row.currency)}`}
                      </small>
                    </td>
                    <td>
                      {row.dueAt ? (
                        <>
                          {new Date(row.dueAt).toLocaleDateString('es-MX', {
                            timeZone: row.timeZone,
                            dateStyle: 'medium',
                          })}
                          {row.daysOverdue ? (
                            <span className="badge bad overdue-badge">
                              {row.daysOverdue}{' '}
                              {row.daysOverdue === 1 ? 'día' : 'días'} vencido
                            </span>
                          ) : null}
                        </>
                      ) : (
                        'Sin fecha'
                      )}
                      <small className="cell-note">
                        {row.lastReminderAt
                          ? `Recordado el ${new Date(row.lastReminderAt).toLocaleDateString('es-MX', { timeZone: row.timeZone, dateStyle: 'medium' })}`
                          : 'Sin recordatorios'}
                        {row.remindersOn ? '' : ' · Automáticos apagados'}
                      </small>
                    </td>

                    <td className="row-actions">
                      {canCollect && row.buyerEmail && (
                        <button
                          className="link-button"
                          type="button"
                          disabled={remind.isPending}
                          onClick={() => {
                            setNotice(undefined);
                            remind.mutate(row);
                          }}
                        >
                          Recordar
                        </button>
                      )}
                      {canCollect && (
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => setEditingId(row.orderId)}
                        >
                          Cambiar fecha
                        </button>
                      )}
                      <Link
                        to={`/eventos/${row.eventId}?tab=registros&q=${encodeURIComponent(row.reference)}`}
                      >
                        Ver compra
                      </Link>
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

function InvoicesView() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folio, setFolio] = useState('');
  const [notice, setNotice] = useState<NoticeState>();

  const list = useQuery({
    queryKey: ['invoices'],
    queryFn: async () =>
      invoiceQueueSchema.parse(await apiRequest('/api/finance/invoices')),
  });
  const save = useMutation({
    mutationFn: async (row: { eventId: string; orderId: string }) => {
      const parsed = orderInvoiceSchema.parse({ invoiceFolio: folio });
      await apiRequest(
        `/api/events/${row.eventId}/orders/${row.orderId}/invoice`,
        jsonRequest('POST', parsed, csrfToken),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setEditingId(null);
      setFolio('');
      setNotice({ kind: 'ok', text: 'Factura registrada.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'Escribe el folio de la factura.'),
      }),
  });

  if (list.isPending) {
    return <Loading />;
  }
  if (list.isError) {
    return <Notice>{list.error.message}</Notice>;
  }
  const pending = list.data.filter((row) => row.invoiceStatus === 'requested');

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <p className="muted">
        El CRM guarda los datos y lleva el control; la factura se emite en tu
        sistema de facturación. {pending.length}{' '}
        {pending.length === 1 ? 'factura pendiente' : 'facturas pendientes'}.
      </p>
      <div className="panel table-panel">
        {list.data.length === 0 ? (
          <p className="muted">
            Aún no hay facturas solicitadas en compras con pagos.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Datos fiscales</th>
                  <th className="numeric">Cobrado</th>
                  <th>Factura</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((row) => {
                  const [label] = financialStatusLabels[
                    row.financialStatus
                  ] ?? [row.financialStatus];
                  return (
                    <tr key={row.orderId}>
                      <td>
                        <strong>{row.buyerName}</strong>
                        <small className="cell-note">
                          {row.eventName} · {row.reference} · {label}
                        </small>
                      </td>
                      <td>
                        <strong>{row.fiscal.rfc}</strong>
                        <small className="cell-note">
                          {row.fiscal.legalName}
                        </small>
                        <small className="cell-note">
                          Régimen {row.fiscal.regime} · CP{' '}
                          {row.fiscal.postalCode} · {row.fiscal.cfdiUse} ·{' '}
                          {row.fiscal.email}
                        </small>
                      </td>
                      <td className="numeric">
                        {formatAmount(row.amountPaid)}
                        {row.amountRefunded > 0 && (
                          <small className="cell-note">
                            Devuelto {formatAmount(row.amountRefunded)}
                          </small>
                        )}
                      </td>
                      <td>
                        {row.invoiceStatus === 'issued' ? (
                          <>
                            <span className="badge ok">{row.invoiceFolio}</span>
                            {row.amountRefunded > 0 && (
                              <small className="cell-note">
                                Revisa la nota de crédito
                              </small>
                            )}
                          </>
                        ) : editingId === row.orderId ? (
                          <span className="inline-form">
                            <input
                              aria-label="Folio de la factura"
                              placeholder="Folio"
                              value={folio}
                              onChange={(e) => setFolio(e.target.value)}
                            />
                            <button
                              className="button primary small"
                              type="button"
                              disabled={save.isPending}
                              onClick={() => {
                                setNotice(undefined);
                                save.mutate(row);
                              }}
                            >
                              Guardar
                            </button>
                          </span>
                        ) : can('finance.manage') ? (
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => {
                              setFolio('');
                              setEditingId(row.orderId);
                            }}
                          >
                            Registrar folio
                          </button>
                        ) : (
                          <span className="badge warn">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const emptyPolicy = {
  eventType: '',
  text: '',
  tiers: [
    { daysBefore: 30, percent: 100 },
    { daysBefore: 15, percent: 50 },
  ] as CancellationTier[],
};

function PoliciesView() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const canManage = can('finance.manage');
  const [form, setForm] = useState<typeof emptyPolicy | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>();

  const list = useQuery({
    queryKey: ['policies'],
    queryFn: async () =>
      cancellationPolicyListSchema.parse(
        await apiRequest('/api/finance/policies'),
      ),
  });
  const save = useMutation({
    mutationFn: async (action: {
      path: string;
      method: 'PUT' | 'DELETE';
      body?: unknown;
      success: string;
    }) => {
      await apiRequest(
        action.path,
        jsonRequest(action.method, action.body, csrfToken),
      );
      return action.success;
    },
    onSuccess: async (success) => {
      await queryClient.invalidateQueries({ queryKey: ['policies'] });
      setForm(null);
      setNotice({ kind: 'ok', text: success });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar.'),
      }),
  });

  if (list.isPending) {
    return <Loading />;
  }
  if (list.isError) {
    return <Notice>{list.error.message}</Notice>;
  }
  const { policies, eventTypes } = list.data;
  const uncovered = eventTypes.filter(
    (type) => !policies.some((policy) => policy.eventType === type),
  );

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!form) {
      return;
    }
    const parsed = cancellationPolicyInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setNotice(undefined);
    save.mutate({
      path: '/api/finance/policies',
      method: 'PUT',
      body: parsed.data,
      success: 'Política guardada.',
    });
  };

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <p className="muted">
        Quien compra la ve antes de pagar. Al cancelar, el sistema sugiere el
        reembolso según estos plazos; la decisión final y su motivo quedan en la
        bitácora.
      </p>
      {uncovered.length > 0 && (
        <p className="notice warn" role="status">
          Sin política: {uncovered.join(', ')}.
        </p>
      )}
      {canManage && !form && (
        <div className="section-actions">
          <button
            className="button primary"
            type="button"
            onClick={() => {
              setNotice(undefined);
              setForm({ ...emptyPolicy, eventType: uncovered[0] ?? '' });
            }}
          >
            Nueva política
          </button>
        </div>
      )}
      {form && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="form-grid">
            <Field label="Tipo de evento" error={errors.eventType}>
              <input
                list="event-types"
                value={form.eventType}
                onChange={(e) =>
                  setForm({ ...form, eventType: e.target.value })
                }
              />
              <datalist id="event-types">
                {eventTypes.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Texto que verá quien compra" error={errors.text}>
            <textarea
              rows={4}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
            />
          </Field>
          <h3>Plazos de reembolso</h3>
          <p className="muted form-note">
            Después del último plazo, la sugerencia es 0%.
          </p>
          {errors.tiers && <Notice>{errors.tiers}</Notice>}
          {form.tiers.map((tier, index) => (
            <div className="tier-row" key={index}>
              <label>
                Hasta
                <input
                  type="number"
                  min="0"
                  aria-label={`Días antes, plazo ${index + 1}`}
                  value={tier.daysBefore}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tiers: form.tiers.map((item, i) =>
                        i === index
                          ? { ...item, daysBefore: Number(e.target.value) }
                          : item,
                      ),
                    })
                  }
                />
                días antes:
              </label>
              <label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  aria-label={`Porcentaje, plazo ${index + 1}`}
                  value={tier.percent}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tiers: form.tiers.map((item, i) =>
                        i === index
                          ? { ...item, percent: Number(e.target.value) }
                          : item,
                      ),
                    })
                  }
                />
                %
              </label>
              <button
                className="link-button danger"
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    tiers: form.tiers.filter((_, i) => i !== index),
                  })
                }
              >
                Quitar
              </button>
            </div>
          ))}
          {form.tiers.length < 6 && (
            <button
              className="link-button"
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  tiers: [...form.tiers, { daysBefore: 0, percent: 0 }],
                })
              }
            >
              Agregar plazo
            </button>
          )}
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={save.isPending}
            >
              Guardar política
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setForm(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="panel table-panel">
        {policies.length === 0 ? (
          <p className="muted">Aún no hay políticas.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tipo de evento</th>
                  <th>Política</th>
                  <th>Plazos</th>
                  {canManage && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.eventType}>
                    <td>
                      <strong className="capitalize">{policy.eventType}</strong>
                    </td>
                    <td className="cell-wrap">{policy.text}</td>
                    <td>
                      {policy.tiers.length === 0
                        ? 'Sin reembolso'
                        : [...policy.tiers]
                            .sort((a, b) => b.daysBefore - a.daysBefore)
                            .map(
                              (tier) =>
                                `${tier.daysBefore} días: ${tier.percent}%`,
                            )
                            .join(' · ')}
                    </td>
                    {canManage && (
                      <td className="row-actions">
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => {
                            setNotice(undefined);
                            setForm({
                              eventType: policy.eventType,
                              text: policy.text,
                              tiers: policy.tiers,
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button
                          className="link-button danger"
                          type="button"
                          disabled={save.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Eliminar la política de ${policy.eventType}?`,
                              )
                            ) {
                              setNotice(undefined);
                              save.mutate({
                                path: `/api/finance/policies/${encodeURIComponent(policy.eventType)}`,
                                method: 'DELETE',
                                success: 'Política eliminada.',
                              });
                            }
                          }}
                        >
                          Eliminar
                        </button>
                      </td>
                    )}
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

export function CollectionsPage() {
  const [view, setView] = useState<View>('receivables');
  return (
    <section>
      <PageHeading
        title="Cobranza"
        description="Lo que falta cobrar, las facturas por emitir y las políticas de cancelación."
      />
      <div className="tabs" role="tablist">
        {(
          [
            ['receivables', 'Cuentas por cobrar'],
            ['invoices', 'Facturas'],
            ['policies', 'Políticas de cancelación'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className={view === value ? 'tab active' : 'tab'}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'receivables' && <ReceivablesView />}
      {view === 'invoices' && <InvoicesView />}
      {view === 'policies' && <PoliciesView />}
    </section>
  );
}
