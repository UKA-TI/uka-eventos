import { useMutation, useQuery } from '@tanstack/react-query';
import {
  cfdiUses,
  fiscalDataSchema,
  fiscalRegimes,
  nameCorrectionSchema,
  orderPolicySchema,
  passTransferSchema,
  paymentMethods,
  refundInputSchema,
  type EventDetail,
  type FiscalData,
  type OrderRecord,
} from '@uka/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Notice } from '../components/ui.js';
import { dateTimeInZoneToIso, toLocalDateTime } from './dates.js';
import { emptyFiscal, type FiscalDraft } from './fiscal-draft.js';
import { formatAmount, issuesToErrors } from './text.js';

export function FiscalFields({
  value,
  errors,
  onChange,
}: {
  value: FiscalDraft;
  errors: Record<string, string>;
  onChange: (next: FiscalDraft) => void;
}) {
  const set = (key: keyof FiscalData, next: string) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="form-grid">
      <Field label="RFC" error={errors.rfc}>
        <input
          autoCapitalize="characters"
          value={value.rfc}
          onChange={(e) => set('rfc', e.target.value)}
        />
      </Field>
      <Field label="Razón social" error={errors.legalName}>
        <input
          value={value.legalName}
          onChange={(e) => set('legalName', e.target.value)}
        />
      </Field>
      <Field label="Régimen fiscal" error={errors.regime}>
        <select
          value={value.regime}
          onChange={(e) => set('regime', e.target.value)}
        >
          <option value="">Selecciona</option>
          {fiscalRegimes.map((regime) => (
            <option key={regime.key} value={regime.key}>
              {regime.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Código postal fiscal" error={errors.postalCode}>
        <input
          inputMode="numeric"
          maxLength={5}
          value={value.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
        />
      </Field>
      <Field label="Uso del CFDI" error={errors.cfdiUse}>
        <select
          value={value.cfdiUse}
          onChange={(e) => set('cfdiUse', e.target.value)}
        >
          <option value="">Selecciona</option>
          {cfdiUses.map((use) => (
            <option key={use.key} value={use.key}>
              {use.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Correo para la factura" error={errors.email}>
        <input
          type="email"
          value={value.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </Field>
    </div>
  );
}

function FormShell({
  title,
  error,
  submitLabel,
  pending,
  danger = false,
  onSubmit,
  onCancel,
  children,
}: {
  title: string;
  error: string;
  submitLabel: string;
  pending: boolean;
  danger?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="inner-form"
      noValidate
      onSubmit={(submitEvent: FormEvent) => {
        submitEvent.preventDefault();
        onSubmit();
      }}
    >
      <h3>{title}</h3>
      {error && <Notice>{error}</Notice>}
      {children}
      <div className="form-actions">
        <button
          className={danger ? 'button primary danger' : 'button primary'}
          type="submit"
          disabled={pending}
        >
          {pending ? 'Guardando…' : submitLabel}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Volver
        </button>
      </div>
    </form>
  );
}

function usePost(path: string, method: 'POST' | 'PUT' = 'POST') {
  const { csrfToken } = usePermissions();
  return useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(path, jsonRequest(method, input, csrfToken)),
  });
}

interface OrderFormProps {
  event: EventDetail;
  order: OrderRecord;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}

const netPaid = (order: OrderRecord) =>
  Math.round((order.amountPaid - order.amountRefunded) * 100) / 100;

function RefundFields({
  event,
  form,
  errors,
  update,
}: {
  event: EventDetail;
  form: {
    amount: string;
    method: string;
    reference: string;
    refundedAt: string;
  };
  errors: Record<string, string>;
  update: (
    key: 'amount' | 'method' | 'reference' | 'refundedAt',
    value: string,
  ) => void;
}) {
  return (
    <div className="form-grid">
      <Field
        label={`Monto a devolver (${event.currency})`}
        error={errors.amount}
      >
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.amount}
          onChange={(e) => update('amount', e.target.value)}
        />
      </Field>
      <Field label="Forma de devolución" error={errors.method}>
        <select
          value={form.method}
          onChange={(e) => update('method', e.target.value)}
        >
          {paymentMethods.map((method) => (
            <option key={method.key} value={method.key}>
              {method.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Fecha de devolución" error={errors.refundedAt}>
        <input
          type="datetime-local"
          value={form.refundedAt}
          onChange={(e) => update('refundedAt', e.target.value)}
        />
      </Field>
      <Field label="Referencia bancaria (opcional)" error={errors.reference}>
        <input
          value={form.reference}
          onChange={(e) => update('reference', e.target.value)}
        />
      </Field>
    </div>
  );
}

export function RefundForm({ event, order, onDone, onCancel }: OrderFormProps) {
  const net = netPaid(order);
  const [form, setForm] = useState({
    amount: String(net),
    method: 'transfer',
    reference: '',
    refundedAt: toLocalDateTime(new Date().toISOString(), event.timeZone),
  });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = usePost(`/api/events/${event.id}/orders/${order.id}/refunds`);

  return (
    <FormShell
      title={`Registrar reembolso de ${order.reference}`}
      error={save.isError ? errorText(save.error, 'No se pudo registrar.') : ''}
      submitLabel="Registrar reembolso"
      pending={save.isPending}
      onCancel={onCancel}
      onSubmit={() => {
        const parsed = refundInputSchema.safeParse({
          amount: Number(form.amount),
          method: form.method,
          reference: form.reference.trim() || null,
          reason,
          refundedAt: form.refundedAt
            ? dateTimeInZoneToIso(form.refundedAt, event.timeZone)
            : '',
        });
        if (!parsed.success) {
          setErrors(issuesToErrors(parsed.error.issues));
          return;
        }
        setErrors({});
        save.mutate(parsed.data, {
          onSuccess: () => void onDone('Reembolso registrado.'),
        });
      }}
    >
      <p className="muted form-note">
        Registra aquí el dinero que ya devolviste. Cobrado:{' '}
        {formatAmount(net, event.currency)}.
        {order.status === 'confirmed' &&
          ' Los pases siguen vigentes; para retirar los lugares, cancela la compra.'}
        {order.invoiceStatus === 'issued' &&
          ` Esta compra tiene la factura ${order.invoiceFolio ?? ''}: emite la nota de crédito en tu sistema de facturación.`}
      </p>
      <RefundFields
        event={event}
        form={form}
        errors={errors}
        update={(key, value) => setForm({ ...form, [key]: value })}
      />
      <Field label="Motivo" error={errors.reason}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function CancelOrderForm({
  event,
  order,
  onDone,
  onCancel,
}: OrderFormProps) {
  const { can } = usePermissions();
  const net = netPaid(order);
  const hasMoney = net > 0;
  const policy = useQuery({
    queryKey: ['order-policy', event.id],
    enabled: hasMoney,
    queryFn: async () =>
      orderPolicySchema
        .nullable()
        .parse(await apiRequest(`/api/events/${event.id}/orders/policy`)),
  });
  const suggested =
    policy.data?.suggestedPercent === null ||
    policy.data?.suggestedPercent === undefined
      ? null
      : Math.round(net * policy.data.suggestedPercent) / 100;
  const [choice, setChoice] = useState<'refund' | 'retain'>('refund');
  const [edited, setEdited] = useState<string | null>(null);
  const [form, setForm] = useState({
    method: 'transfer',
    reference: '',
    refundedAt: toLocalDateTime(new Date().toISOString(), event.timeZone),
  });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = usePost(`/api/events/${event.id}/orders/${order.id}/cancel`);
  const amount = edited ?? String(suggested ?? net);

  if (hasMoney && !can('refunds.manage')) {
    return (
      <div className="inner-form">
        <h3>Cancelar {order.reference}</h3>
        <p className="notice warn" role="status">
          Esta compra ya tiene pagos por {formatAmount(net, event.currency)}.
          Cancelarla le corresponde a quien administra los reembolsos.
        </p>
        <div className="form-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <FormShell
      title={`Cancelar ${order.reference}`}
      error={save.isError ? errorText(save.error, 'No se pudo cancelar.') : ''}
      submitLabel="Cancelar compra"
      danger
      pending={save.isPending}
      onCancel={onCancel}
      onSubmit={() => {
        const problems: Record<string, string> = {};
        if (hasMoney && reason.trim().length < 3) {
          problems.reason = 'Escribe el motivo.';
        }
        const refunding = hasMoney && choice === 'refund';
        const value = Number(amount);
        if (refunding && !(value > 0)) {
          problems.amount = 'Debe ser mayor a cero.';
        }
        if (refunding && !form.refundedAt) {
          problems.refundedAt = 'Indica la fecha.';
        }
        setErrors(problems);
        if (Object.keys(problems).length > 0) {
          return;
        }
        save.mutate(
          {
            reason: reason.trim() || null,
            refund: refunding
              ? {
                  amount: value,
                  method: form.method,
                  reference: form.reference.trim() || null,
                  refundedAt: dateTimeInZoneToIso(
                    form.refundedAt,
                    event.timeZone,
                  ),
                }
              : null,
          },
          {
            onSuccess: () =>
              void onDone(
                refunding
                  ? 'Compra cancelada y reembolso registrado.'
                  : hasMoney
                    ? 'Compra cancelada. El importe queda retenido como ingreso.'
                    : 'Compra cancelada.',
              ),
          },
        );
      }}
    >
      <p className="muted form-note">
        Sus pases dejarán de valer y se liberarán sus lugares.
      </p>
      {hasMoney && (
        <>
          <p className="form-note">
            Cobrado: <strong>{formatAmount(net, event.currency)}</strong>
            {policy.data?.suggestedPercent !== null &&
              policy.data?.suggestedPercent !== undefined && (
                <>
                  {' '}
                  · Faltan {policy.data.daysLeft} días: la política marca{' '}
                  <strong>{policy.data.suggestedPercent}%</strong> de reembolso.
                </>
              )}
          </p>
          {policy.isSuccess && !policy.data && (
            <p className="notice warn" role="status">
              Este tipo de evento no tiene política de cancelación. Defínela en
              Cobranza para orientar estas decisiones.
            </p>
          )}
          <fieldset className="admit-reasons">
            <legend>¿Qué pasa con el dinero?</legend>
            <label>
              <input
                type="radio"
                name="cancel-money"
                checked={choice === 'refund'}
                onChange={() => setChoice('refund')}
              />
              Se devuelve
            </label>
            <label>
              <input
                type="radio"
                name="cancel-money"
                checked={choice === 'retain'}
                onChange={() => setChoice('retain')}
              />
              Se retiene como ingreso
            </label>
          </fieldset>
          {choice === 'refund' && (
            <RefundFields
              event={event}
              form={{ ...form, amount }}
              errors={errors}
              update={(key, value) =>
                key === 'amount'
                  ? setEdited(value)
                  : setForm({ ...form, [key]: value })
              }
            />
          )}
        </>
      )}
      <Field
        label={hasMoney ? 'Motivo' : 'Motivo (opcional)'}
        error={errors.reason}
      >
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function DueDateForm({
  orderId,
  eventId,
  timeZone,
  dueAt,
  onDone,
  onCancel,
}: {
  orderId: string;
  eventId: string;
  timeZone: string;
  dueAt: string | null;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(
    dueAt ? toLocalDateTime(dueAt, timeZone).slice(0, 10) : '',
  );
  const [problem, setProblem] = useState('');
  const save = usePost(
    `/api/events/${eventId}/orders/${orderId}/due-date`,
    'PUT',
  );
  return (
    <FormShell
      title="Fecha de vencimiento"
      error={save.isError ? errorText(save.error, 'No se pudo guardar.') : ''}
      submitLabel="Guardar fecha"
      pending={save.isPending}
      onCancel={onCancel}
      onSubmit={() => {
        if (!value) {
          setProblem('Elige la fecha.');
          return;
        }
        setProblem('');
        save.mutate(
          { dueAt: dateTimeInZoneToIso(`${value}T23:59`, timeZone) },
          {
            onSuccess: () =>
              void onDone(
                'Vencimiento actualizado. Los recordatorios siguen la fecha nueva.',
              ),
          },
        );
      }}
    >
      <p className="muted form-note">
        Vencer no cancela la compra ni libera lugares: solo activa los
        recordatorios y el reporte de cobranza.
      </p>
      <Field label="Vence el" error={problem}>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </FormShell>
  );
}

export function FiscalForm({ event, order, onDone, onCancel }: OrderFormProps) {
  const [value, setValue] = useState<FiscalDraft>(order.fiscal ?? emptyFiscal);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = usePost(
    `/api/events/${event.id}/orders/${order.id}/fiscal`,
    'PUT',
  );
  return (
    <FormShell
      title={`Datos fiscales de ${order.reference}`}
      error={save.isError ? errorText(save.error, 'No se pudo guardar.') : ''}
      submitLabel="Guardar datos"
      pending={save.isPending}
      onCancel={onCancel}
      onSubmit={() => {
        const parsed = fiscalDataSchema.safeParse(value);
        if (!parsed.success) {
          setErrors(issuesToErrors(parsed.error.issues));
          return;
        }
        setErrors({});
        save.mutate(
          { fiscal: parsed.data },
          { onSuccess: () => void onDone('Datos fiscales guardados.') },
        );
      }}
    >
      <FiscalFields value={value} errors={errors} onChange={setValue} />
    </FormShell>
  );
}

export function NameChangeForm({
  event,
  registration,
  onDone,
  onCancel,
}: {
  event: EventDetail;
  registration: { id: string; guestName: string };
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'correct' | 'transfer'>('correct');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const base = `/api/events/${event.id}/orders/registrations/${registration.id}`;
  const correct = usePost(`${base}/correct-name`);
  const transfer = usePost(`${base}/transfer`);
  const active = mode === 'correct' ? correct : transfer;
  const update = (key: keyof typeof form, value: string) =>
    setForm({ ...form, [key]: value });

  return (
    <FormShell
      title={`Cambiar el nombre de ${registration.guestName}`}
      error={
        active.isError ? errorText(active.error, 'No se pudo guardar.') : ''
      }
      submitLabel={mode === 'correct' ? 'Corregir nombre' : 'Ceder pase'}
      pending={active.isPending}
      onCancel={onCancel}
      onSubmit={() => {
        const parsed =
          mode === 'correct'
            ? nameCorrectionSchema.safeParse(form)
            : passTransferSchema.safeParse(form);
        if (!parsed.success) {
          setErrors(issuesToErrors(parsed.error.issues));
          return;
        }
        setErrors({});
        active.mutate(parsed.data, {
          onSuccess: () =>
            void onDone(
              mode === 'correct'
                ? 'Nombre corregido. El pase sigue siendo el mismo.'
                : 'Pase cedido. El QR anterior ya no vale y la invitación para activar el nuevo está en la cola.',
            ),
        });
      }}
    >
      <fieldset className="admit-reasons">
        <legend>¿Qué necesitas?</legend>
        <label>
          <input
            type="radio"
            name="name-mode"
            checked={mode === 'correct'}
            onChange={() => setMode('correct')}
          />
          Corregir el nombre: es la misma persona
        </label>
        <label>
          <input
            type="radio"
            name="name-mode"
            checked={mode === 'transfer'}
            onChange={() => setMode('transfer')}
          />
          Ceder el pase: va otra persona
        </label>
      </fieldset>
      {mode === 'transfer' && (
        <p className="muted form-note">
          Conserva el folio y la mesa. El QR actual deja de valer, y la nueva
          persona acepta el aviso de privacidad antes de recibir el suyo.
        </p>
      )}
      <div className="form-grid">
        <Field label="Nombre" error={errors.firstName}>
          <input
            value={form.firstName}
            onChange={(e) => update('firstName', e.target.value)}
          />
        </Field>
        <Field label="Apellidos" error={errors.lastName}>
          <input
            value={form.lastName}
            onChange={(e) => update('lastName', e.target.value)}
          />
        </Field>
        {mode === 'transfer' && (
          <Field label="Correo" error={errors.email}>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </Field>
        )}
        <Field label="Motivo" error={errors.reason}>
          <input
            value={form.reason}
            onChange={(e) => update('reason', e.target.value)}
          />
        </Field>
      </div>
    </FormShell>
  );
}
