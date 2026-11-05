import { useMutation } from '@tanstack/react-query';
import {
  paymentMethods,
  reconciledOrderSchema,
  type EventDetail,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Notice } from '../components/ui.js';
import { formatMoney, issuesToErrors } from './text.js';

const todayInput = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};

/** Compra hecha por otro medio: el pago ya se revisó y la persona se registra después. */
export function ReconciledOrderForm({
  event,
  onDone,
  onCancel,
}: {
  event: EventDetail;
  onDone: (reference: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { csrfToken } = usePermissions();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    organization: '',
    ticketTypeId:
      event.ticketTypes.length === 1 ? event.ticketTypes[0]!.id : '',
    quantity: '1',
    amount: '',
    method: 'transfer',
    reference: '',
    notes: '',
    paidAt: todayInput(),
    delegateName: '',
    delegateEmail: '',
    registrationDeadline: '',
  });
  const [amountEdited, setAmountEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const ticket = event.ticketTypes.find(
    (item) => item.id === form.ticketTypeId,
  );
  const quantity = Number(form.quantity) || 0;
  const expected = ticket ? ticket.price * quantity : 0;
  const seats = ticket ? ticket.seatsIncluded * quantity : 0;
  const amount = amountEdited ? form.amount : String(expected);

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        `/api/events/${event.id}/orders/reconciled`,
        jsonRequest('POST', input, csrfToken),
      ) as Promise<{ reference: string }>,
    onSuccess: (result) => onDone(result.reference),
    onError: (failure) =>
      setError(errorText(failure, 'No se pudo conciliar la compra.')),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setError('');
    const parsed = reconciledOrderSchema.safeParse({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone.trim() || null,
      organization: form.organization.trim() || null,
      ticketTypeId: form.ticketTypeId,
      quantity,
      amount: amount === '' ? undefined : Number(amount),
      method: form.method,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      // Mediodía local: la fecha elegida no cambia al convertirla a UTC.
      paidAt: new Date(`${form.paidAt}T12:00:00`).toISOString(),
      delegateName: form.delegateName.trim() || null,
      delegateEmail: form.delegateEmail.trim() || null,
      registrationDeadline: form.registrationDeadline
        ? new Date(`${form.registrationDeadline}T12:00:00`).toISOString()
        : null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (parsed.data.amount > 0 && !parsed.data.reference) {
      setErrors({ reference: 'Escribe la referencia del pago.' });
      return;
    }
    save.mutate(parsed.data);
  };

  const text = (key: keyof typeof form, type = 'text') => (
    <input
      type={type}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  );

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="panel-heading">
        <div>
          <h2>Compra ya pagada</h2>
          <small className="cell-note">
            Para quien ya pagó por otro medio. Al guardar le enviamos una
            invitación privada para registrarse; su pase con QR sale cuando se
            registre.
          </small>
        </div>
      </div>
      <Notice>{error}</Notice>
      <h3 className="form-section">Quién compró</h3>
      <div className="form-grid">
        <Field label="Nombre" error={errors.firstName}>
          {text('firstName')}
        </Field>
        <Field label="Apellidos" error={errors.lastName}>
          {text('lastName')}
        </Field>
        <Field
          label="Correo"
          error={errors.email}
          hint="Aquí llegará la invitación para registrarse."
        >
          {text('email', 'email')}
        </Field>
        <Field label="Teléfono" error={errors.phone}>
          {text('phone', 'tel')}
        </Field>
        <Field label="Empresa" error={errors.organization}>
          {text('organization')}
        </Field>
      </div>
      <h3 className="form-section">Qué compró y cómo pagó</h3>
      <div className="form-grid">
        <Field label="Boleto" error={errors.ticketTypeId}>
          <select
            value={form.ticketTypeId}
            onChange={(e) => setForm({ ...form, ticketTypeId: e.target.value })}
          >
            <option value="">Selecciona un boleto</option>
            {event.ticketTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {formatMoney(item.price, event.currency)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Cantidad"
          error={errors.quantity}
          hint={seats > 0 ? `${seats} lugares por registrar.` : undefined}
        >
          {text('quantity', 'number')}
        </Field>
        <Field
          label={`Monto recibido (${event.currency})`}
          error={errors.amount}
          hint={
            amountEdited && Number(amount) !== expected
              ? `Precio de lista: ${formatMoney(expected, event.currency)}.`
              : 'Cambia el monto si hubo descuento. Usa 0 para una cortesía.'
          }
        >
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmountEdited(true);
              setForm({ ...form, amount: e.target.value });
            }}
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
        <Field
          label="Referencia del pago"
          error={errors.reference}
          hint="Evita conciliar dos veces el mismo pago."
        >
          {text('reference')}
        </Field>
        <Field label="Fecha del pago" error={errors.paidAt}>
          {text('paidAt', 'date')}
        </Field>
        <div className="span-all">
          <Field label="Notas" error={errors.notes}>
            {text('notes')}
          </Field>
        </div>
      </div>
      <h3 className="form-section">¿Quién registrará a los invitados?</h3>
      <p className="form-note">
        Si lo hará su asistente, escribe sus datos: a ese correo le llegará la
        liga privada en lugar de al comprador. Déjalo vacío si se registra el
        comprador.
      </p>
      <div className="form-grid">
        <Field label="Asistente o contacto" error={errors.delegateName}>
          {text('delegateName')}
        </Field>
        <Field label="Correo del contacto" error={errors.delegateEmail}>
          {text('delegateEmail', 'email')}
        </Field>
        <Field
          label="Fecha límite (opcional)"
          error={errors.registrationDeadline}
        >
          {text('registrationDeadline', 'date')}
        </Field>
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? 'Guardando…' : 'Conciliar y enviar invitación'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
