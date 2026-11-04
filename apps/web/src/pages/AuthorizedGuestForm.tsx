import { useMutation } from '@tanstack/react-query';
import { authorizedGuestSchema, type EventDetail } from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Notice } from '../components/ui.js';
import { issuesToErrors } from './text.js';

/** Para quien llega sin registro y alguien con autoridad decide que puede entrar. */
export function AuthorizedGuestForm({
  event,
  accessPoints,
  onCancel,
  onDone,
}: {
  event: EventDetail;
  accessPoints: { id: string; name: string }[];
  onCancel: () => void;
  onDone: (folio: string, admitted: boolean) => Promise<void>;
}) {
  const { csrfToken } = usePermissions();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    organization: '',
    ticketTypeId:
      event.ticketTypes.length === 1 ? event.ticketTypes[0]!.id : '',
    reason: '',
    accessPointId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        `/api/events/${event.id}/checkin/authorized`,
        jsonRequest('POST', input, csrfToken),
      ) as Promise<{ folio: string; admitted: boolean }>,
    onSuccess: (result) => onDone(result.folio, result.admitted),
    onError: (failure) =>
      setError(errorText(failure, 'No se pudo registrar el alta.')),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setError('');
    const parsed = authorizedGuestSchema.safeParse({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email.trim() || null,
      phone: null,
      organization: form.organization.trim() || null,
      ticketTypeId: form.ticketTypeId,
      reason: form.reason,
      accessPointId: form.accessPointId || null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const change = (key: keyof typeof form, value: string) => {
    setForm({ ...form, [key]: value });
    setErrors(({ [key]: _fixed, ...rest }) => rest);
  };

  const text = (key: keyof typeof form, type = 'text') => (
    <input
      type={type}
      value={form[key]}
      onChange={(e) => change(key, e.target.value)}
    />
  );

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="panel-heading">
        <div>
          <h2>Alta autorizada</h2>
          <small className="cell-note">
            Para quien llega sin registro. Se crea sin cobro y su pase es válido
            de inmediato; el motivo queda en la bitácora.
          </small>
        </div>
      </div>
      <Notice>{error}</Notice>
      <div className="form-grid">
        <Field label="Nombre" error={errors.firstName}>
          {text('firstName')}
        </Field>
        <Field label="Apellidos" error={errors.lastName}>
          {text('lastName')}
        </Field>
        <Field
          label="Correo (opcional)"
          error={errors.email}
          hint="Si lo escribes, le enviamos su pase."
        >
          {text('email', 'email')}
        </Field>
        <Field label="Organización (opcional)" error={errors.organization}>
          {text('organization')}
        </Field>
        <Field label="Boleto" error={errors.ticketTypeId}>
          <select
            value={form.ticketTypeId}
            onChange={(e) => change('ticketTypeId', e.target.value)}
          >
            <option value="">Selecciona un boleto</option>
            {event.ticketTypes.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Dar ingreso ahora por"
          error={errors.accessPointId}
          hint="Déjalo vacío si llegará después."
        >
          <select
            value={form.accessPointId}
            onChange={(e) => change('accessPointId', e.target.value)}
          >
            <option value="">Aún no ingresa</option>
            {accessPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="span-all">
          <Field
            label="Motivo y quién lo autoriza"
            error={errors.reason}
            hint="Por ejemplo: invitado de Dirección, autoriza Ana Torres."
          >
            {text('reason')}
          </Field>
        </div>
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? 'Guardando…' : 'Registrar alta'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
