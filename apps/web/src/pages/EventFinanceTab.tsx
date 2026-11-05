import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  budgetCategories,
  budgetItemInputSchema,
  closingCheckSchema,
  eventFinanceSchema,
  eventFinanceSettingsSchema,
  paymentMethods,
  type EventDetail,
  type FinanceTotals,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice } from '../components/ui.js';
import { formatAmount, issuesToErrors } from './text.js';

const categoryLabel = Object.fromEntries(
  budgetCategories.map(({ key, label }) => [key, label]),
);
const methodLabel = Object.fromEntries(
  paymentMethods.map(({ key, label }) => [key, label]),
);

const emptyItem = {
  category: 'venue',
  concept: '',
  budgeted: '',
  actual: '',
  notes: '',
};

/** Avance contra la meta: una sola barra, con su número escrito al lado. */
function GoalMeter({
  totals,
  currency,
}: {
  totals: FinanceTotals;
  currency: string;
}) {
  if (totals.goal === null || totals.goalProgress === null) {
    return (
      <p className="muted form-note">
        Define una meta para medir el avance de este evento.
      </p>
    );
  }
  const percent = Math.round(totals.goalProgress * 100);
  const missing = totals.goal - totals.totalIncome;
  return (
    <div className="goal-meter">
      <div className="goal-meter-label">
        <strong>{percent}% de la meta</strong>
        <span>
          {formatAmount(totals.totalIncome, currency)} de{' '}
          {formatAmount(totals.goal, currency)}
          {missing > 0
            ? ` · faltan ${formatAmount(missing, currency)}`
            : ` · superada por ${formatAmount(-missing, currency)}`}
        </span>
      </div>
      <div
        className="goal-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-label="Avance contra la meta de recaudación"
      >
        <i style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

function ResultTable({
  totals,
  currency,
}: {
  totals: FinanceTotals;
  currency: string;
}) {
  const rows: [string, number, boolean?][] = [
    ['Cobrado de boletos', totals.grossCollected],
    ['Reembolsos', -totals.refunded],
    ['Neto de boletos', totals.netCollected, true],
    ['Donativos', totals.donations],
    ['Ingreso total', totals.totalIncome, true],
    ['Costos reales', -totals.actualCosts],
    ['Resultado a hoy', totals.result, true],
  ];
  return (
    <div className="table-scroll">
      <table>
        <tbody>
          {rows.map(([label, value, strong]) => (
            <tr key={label}>
              <td>{strong ? <strong>{label}</strong> : label}</td>
              <td className="numeric">
                {strong ? (
                  <strong>{formatAmount(value, currency)}</strong>
                ) : (
                  formatAmount(value, currency)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClosingDialog({
  event,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  event: EventDetail;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (note: string | null) => void;
}) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const check = useQuery({
    queryKey: ['closing-check', event.id],
    queryFn: async () =>
      closingCheckSchema.parse(
        await apiRequest(`/api/events/${event.id}/finance/closing-check`),
      ),
  });
  const issues = check.data?.issues ?? [];

  return (
    <div className="panel">
      <div className="panel-heading">
        <h2>Cerrar {event.name}</h2>
      </div>
      {check.isPending && <Loading />}
      {check.isError && <Notice>{check.error.message}</Notice>}
      {error && <Notice>{error}</Notice>}
      {check.isSuccess && issues.length === 0 && (
        <p className="notice ok" role="status">
          Sin pendientes. El evento se puede cerrar.
        </p>
      )}
      {issues.length > 0 && (
        <>
          <p>Antes de cerrar, revisa esto:</p>
          <ul className="compact-list closing-issues">
            {issues.map((issue) => (
              <li key={issue.key}>{issue.text}</li>
            ))}
          </ul>
          <Field label="Motivo para cerrar con pendientes" error={problem}>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </>
      )}
      <p className="muted form-note">
        Al cerrar se guardan los números de hoy y se bloquean pagos, reembolsos,
        cancelaciones y presupuesto. Puedes reabrirlo después.
      </p>
      <div className="form-actions">
        <button
          className="button primary"
          type="button"
          disabled={pending || !check.isSuccess}
          onClick={() => {
            if (issues.length > 0 && !note.trim()) {
              setProblem('Explica por qué se cierra con pendientes.');
              return;
            }
            setProblem('');
            onConfirm(note.trim() || null);
          }}
        >
          {pending ? 'Cerrando…' : 'Cerrar evento'}
        </button>
        <button className="button secondary" type="button" onClick={onClose}>
          Volver
        </button>
      </div>
    </div>
  );
}

export function EventFinanceTab({ event }: { event: EventDetail }) {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const canManage = can('finance.manage') && event.status !== 'closed';
  const base = `/api/events/${event.id}/finance`;
  const [settings, setSettings] = useState<{
    goal: string;
    term: string;
    reminders: boolean;
  } | null>(null);
  const [item, setItem] = useState(emptyItem);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const finance = useQuery({
    queryKey: ['finance', event.id],
    queryFn: async () => eventFinanceSchema.parse(await apiRequest(base)),
  });

  const act = useMutation({
    mutationFn: async (action: {
      path: string;
      method: 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      success: string;
    }) => {
      await apiRequest(
        `${base}${action.path}`,
        jsonRequest(action.method, action.body, csrfToken),
      );
      return action.success;
    },
    onSuccess: async (success) => {
      await queryClient.invalidateQueries({
        queryKey: ['finance', event.id],
      });
      setNotice({ kind: 'ok', text: success });
      setSettings(null);
      setAdding(false);
      setEditingId(null);
      setItem(emptyItem);
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar.'),
      }),
  });

  if (finance.isPending) {
    return <Loading />;
  }
  if (finance.isError) {
    return <Notice>{finance.error.message}</Notice>;
  }

  const { totals, currency, budget, byMethod, closing } = finance.data;
  const money = (value: number) => formatAmount(value, currency);

  const saveSettings = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!settings) {
      return;
    }
    const parsed = eventFinanceSettingsSchema.safeParse({
      fundraisingGoal: settings.goal.trim() ? Number(settings.goal) : null,
      paymentTermDays: Number(settings.term),
      paymentReminders: settings.reminders,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setNotice(undefined);
    act.mutate({
      path: '/settings',
      method: 'PUT',
      body: parsed.data,
      success: 'Meta y condiciones guardadas.',
    });
  };

  const saveItem = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const parsed = budgetItemInputSchema.safeParse({
      category: item.category,
      concept: item.concept,
      budgeted: item.budgeted.trim() === '' ? NaN : Number(item.budgeted),
      actual: item.actual.trim() === '' ? null : Number(item.actual),
      notes: item.notes.trim() || null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setNotice(undefined);
    act.mutate(
      editingId
        ? {
            path: `/budget/${editingId}`,
            method: 'PUT',
            body: parsed.data,
            success: 'Concepto actualizado.',
          }
        : {
            path: '/budget',
            method: 'POST',
            body: parsed.data,
            success: 'Concepto agregado.',
          },
    );
  };

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {closing && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Cierre del evento</h2>
          </div>
          <p className="muted form-note">
            Cerrado el{' '}
            {new Date(closing.closedAt).toLocaleString('es-MX', {
              timeZone: event.timeZone,
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            {closing.closedBy ? ` por ${closing.closedBy}` : ''}. Estos son los
            números de ese momento.
            {closing.note ? ` Motivo: ${closing.note}` : ''}
          </p>
          <ResultTable totals={closing.totals} currency={currency} />
        </div>
      )}

      <div className="stats">
        <article className="stat">
          <span>Ingreso total</span>
          <strong>{money(totals.totalIncome)}</strong>
          <small>Boletos netos y donativos</small>
        </article>
        <article className="stat">
          <span>Por cobrar</span>
          <strong>{money(totals.receivable)}</strong>
          <small>{money(totals.overdue)} vencido</small>
        </article>
        <article className="stat">
          <span>Costos reales</span>
          <strong>{money(totals.actualCosts)}</strong>
          <small>De {money(totals.budgeted)} presupuestado</small>
        </article>
        <article className="stat">
          <span>Resultado a hoy</span>
          <strong>{money(totals.result)}</strong>
          <small>Proyectado: {money(totals.projectedResult)}</small>
        </article>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Meta de recaudación</h2>
          {canManage && !settings && (
            <button
              className="button secondary small"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setSettings({
                  goal: totals.goal === null ? '' : String(totals.goal),
                  term: String(finance.data.paymentTermDays),
                  reminders: finance.data.paymentReminders,
                });
              }}
            >
              Editar meta y condiciones
            </button>
          )}
        </div>
        <GoalMeter totals={totals} currency={currency} />
        {!settings && (
          <p className="muted form-note">
            Plazo de pago: {finance.data.paymentTermDays} días · Recordatorios
            automáticos {finance.data.paymentReminders ? 'activos' : 'apagados'}
          </p>
        )}
        {settings && (
          <form className="inner-form" onSubmit={saveSettings} noValidate>
            <div className="form-grid">
              <Field
                label={`Meta de recaudación (${currency})`}
                error={errors.fundraisingGoal}
                hint="Déjala vacía si este evento no tiene meta."
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settings.goal}
                  onChange={(e) =>
                    setSettings({ ...settings, goal: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Días para pagar"
                error={errors.paymentTermDays}
                hint="Solo aplica a compras nuevas. Nunca pasa de la fecha del evento."
              >
                <input
                  type="number"
                  min="0"
                  value={settings.term}
                  onChange={(e) =>
                    setSettings({ ...settings, term: e.target.value })
                  }
                />
              </Field>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={settings.reminders}
                onChange={(e) =>
                  setSettings({ ...settings, reminders: e.target.checked })
                }
              />
              Enviar recordatorios automáticos: 3 días antes de vencer, el día
              que vence, y 3 y 7 días después
            </label>
            <div className="form-actions">
              <button
                className="button primary"
                type="submit"
                disabled={act.isPending}
              >
                Guardar
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setSettings(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="finance-columns">
        <div className="panel table-panel">
          <div className="panel-heading table-heading">
            <h2>Ingresos y resultado</h2>
          </div>
          <ResultTable totals={totals} currency={currency} />
          {totals.retainedFromCancelled > 0 && (
            <p className="table-note">
              Incluye {money(totals.retainedFromCancelled)} retenidos de compras
              canceladas.
            </p>
          )}
        </div>
        <div className="panel table-panel">
          <div className="panel-heading table-heading">
            <h2>Cobrado por forma de pago</h2>
          </div>
          {byMethod.length === 0 ? (
            <p className="muted">Aún no hay pagos.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <tbody>
                  {byMethod.map((row) => (
                    <tr key={row.method}>
                      <td>{methodLabel[row.method] ?? row.method}</td>
                      <td className="numeric">{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel table-panel">
        <div className="panel-heading table-heading">
          <h2>Presupuesto de costos</h2>
          {canManage && !adding && !editingId && (
            <button
              className="button secondary small"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setItem(emptyItem);
                setAdding(true);
              }}
            >
              Agregar concepto
            </button>
          )}
        </div>
        {(adding || editingId) && (
          <form
            className="inner-form budget-form"
            onSubmit={saveItem}
            noValidate
          >
            <div className="form-grid">
              <Field label="Categoría">
                <select
                  value={item.category}
                  onChange={(e) =>
                    setItem({ ...item, category: e.target.value })
                  }
                >
                  {budgetCategories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Concepto" error={errors.concept}>
                <input
                  value={item.concept}
                  onChange={(e) =>
                    setItem({ ...item, concept: e.target.value })
                  }
                />
              </Field>
              <Field
                label={`Presupuesto (${currency})`}
                error={errors.budgeted}
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.budgeted}
                  onChange={(e) =>
                    setItem({ ...item, budgeted: e.target.value })
                  }
                />
              </Field>
              <Field
                label={`Costo real (${currency})`}
                error={errors.actual}
                hint="Déjalo vacío hasta conocerlo."
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.actual}
                  onChange={(e) => setItem({ ...item, actual: e.target.value })}
                />
              </Field>
            </div>
            <div className="form-actions">
              <button
                className="button primary"
                type="submit"
                disabled={act.isPending}
              >
                Guardar
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setAdding(false);
                  setEditingId(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {budget.length === 0 ? (
          <p className="muted">
            Sin conceptos. Agrega sede, banquete, producción y comisiones.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th className="numeric">Presupuesto</th>
                  <th className="numeric">Costo real</th>
                  <th className="numeric">Diferencia</th>
                  {canManage && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {budget.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.concept}</strong>
                    </td>
                    <td>{categoryLabel[row.category] ?? row.category}</td>
                    <td className="numeric">{money(row.budgeted)}</td>
                    <td className="numeric">
                      {row.actual === null ? '—' : money(row.actual)}
                    </td>
                    <td className="numeric">
                      {row.actual === null
                        ? '—'
                        : money(row.budgeted - row.actual)}
                    </td>
                    {canManage && (
                      <td className="row-actions">
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => {
                            setNotice(undefined);
                            setAdding(false);
                            setEditingId(row.id);
                            setItem({
                              category: row.category,
                              concept: row.concept,
                              budgeted: String(row.budgeted),
                              actual:
                                row.actual === null ? '' : String(row.actual),
                              notes: row.notes ?? '',
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button
                          className="link-button danger"
                          type="button"
                          disabled={act.isPending}
                          onClick={() => {
                            if (window.confirm(`¿Eliminar ${row.concept}?`)) {
                              setNotice(undefined);
                              act.mutate({
                                path: `/budget/${row.id}`,
                                method: 'DELETE',
                                success: 'Concepto eliminado.',
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
                <tr>
                  <td colSpan={2}>
                    <strong>Total</strong>
                  </td>
                  <td className="numeric">
                    <strong>{money(totals.budgeted)}</strong>
                  </td>
                  <td className="numeric">
                    <strong>{money(totals.actualCosts)}</strong>
                  </td>
                  <td />
                  {canManage && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
