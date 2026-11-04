import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  groupGuestInputSchema,
  publicGroupResponseSchema,
  type PublicGroup,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest, errorText } from '../../api.js';
import { Field, Loading, Notice } from '../../components/ui.js';
import { formatEventDate, issuesToErrors } from '../text.js';
import { PublicLayout } from './PublicLayout.js';

const EMPTY_SHOWN = 10;

const seatLabel = (seat: number) => `Lugar ${String(seat).padStart(2, '0')}`;

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  organization: '',
};

/** Un formulario por lugar: se llenan poco a poco, y cada uno guarda por su cuenta. */
function SeatForm({
  seat,
  group,
  prefill,
  token,
  onSaved,
}: {
  seat: number;
  group: PublicGroup;
  prefill: boolean;
  token: string;
  onSaved: (data: PublicGroup, text: string) => void;
}) {
  const { buyer } = group;
  const [form, setForm] = useState(
    prefill
      ? {
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          email: buyer.email ?? '',
          phone: buyer.phone ?? '',
          organization: buyer.organization ?? '',
        }
      : emptyForm,
  );
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  // Solo acepta aquí quien compró y se registra a sí mismo. Nadie acepta por otro.
  const isSelf =
    !group.delegateName &&
    Boolean(buyer.email) &&
    form.email.trim().toLowerCase() === buyer.email?.toLowerCase();

  const save = useMutation({
    mutationFn: async (body: unknown) =>
      publicGroupResponseSchema.parse(
        await apiRequest(`/api/public/groups/${token}/guests`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: (data) =>
      onSaved(
        data,
        isSelf
          ? 'Registro guardado. Tu pase llegará por correo.'
          : `${seatLabel(seat)} registrado. Le enviamos un correo para activar su pase.`,
      ),
    onError: (failure) =>
      setError(errorText(failure, 'No se pudo registrar este lugar.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const parsed = groupGuestInputSchema.safeParse({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone.trim() || null,
      organization: form.organization.trim() || null,
      seatNumber: seat,
      authorized: accepted,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    if (isSelf && !accepted) {
      setErrors({
        authorized: 'Acepta el aviso de privacidad para continuar.',
      });
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <article className="seat">
      <div className="seat-number">
        {seatLabel(seat)}
        {group.folioPrefix && (
          <small>
            {group.folioPrefix}-{String(seat).padStart(2, '0')}
          </small>
        )}
      </div>
      <form className="seat-body" onSubmit={submit} noValidate>
        <Notice>{error}</Notice>
        <div className="seat-fields">
          <Field label="Nombre(s)" error={errors.firstName}>
            <input
              autoComplete="off"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </Field>
          <Field label="Apellidos" error={errors.lastName}>
            <input
              autoComplete="off"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </Field>
          <Field label="Correo electrónico" error={errors.email}>
            <input
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
        </div>
        {isSelf && (
          <>
            <label className="check-field privacy-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                Acepto el{' '}
                <a href={group.privacyUrl} target="_blank" rel="noreferrer">
                  aviso de privacidad
                </a>
                .
              </span>
            </label>
            {errors.authorized && (
              <small className="field-error">{errors.authorized}</small>
            )}
          </>
        )}
        <div className="form-actions">
          <button
            className="button primary small"
            type="submit"
            disabled={save.isPending}
          >
            {save.isPending
              ? 'Guardando…'
              : isSelf
                ? 'Registrarme'
                : 'Registrar y enviar activación'}
          </button>
        </div>
      </form>
    </article>
  );
}

export function GroupPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const key = ['public-group', token];

  const group = useQuery({
    queryKey: key,
    queryFn: async () =>
      publicGroupResponseSchema.parse(
        await apiRequest(`/api/public/groups/${token}`),
      ),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      publicGroupResponseSchema.parse(
        await apiRequest(`/api/public/groups/${token}/guests/${id}`, {
          method: 'DELETE',
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setNotice({
        kind: 'ok',
        text: 'Se anuló su pase y el lugar quedó libre.',
      });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo cambiar al invitado.'),
      }),
  });

  const resend = useMutation({
    mutationFn: async (id: string) =>
      apiRequest(`/api/public/groups/${token}/guests/${id}/resend`, {
        method: 'POST',
      }),
    onSuccess: () =>
      setNotice({ kind: 'ok', text: 'El correo ya está en la cola de envío.' }),
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo reenviar el correo.'),
      }),
  });

  if (group.isPending) {
    return <Loading />;
  }
  if (group.isError) {
    return (
      <PublicLayout>
        <h1>Liga no válida</h1>
        <p className="muted">
          Revisa la liga que recibiste o escríbenos a
          eventos@unkilodeayuda.org.mx.
        </p>
      </PublicLayout>
    );
  }

  const data = group.data;
  const single = data.seats === 1;
  const seats = Array.from({ length: data.seats }, (_, index) => index + 1);
  const bySeat = new Map(data.guests.map((guest) => [guest.seatNumber, guest]));
  const empties = seats.filter((seat) => !bySeat.has(seat));
  const visibleEmpty = new Set(
    showAll ? empties : empties.slice(0, EMPTY_SHOWN),
  );
  const company = data.buyer.organization ?? data.contactName;
  const greeting = data.delegateName ?? data.buyer.firstName;

  return (
    <PublicLayout privacyUrl={data.privacyUrl} wide={!single}>
      <div className="group-head">
        <div>
          <h1>
            {single
              ? 'Completa tu registro'
              : `${company} · ${data.seats} lugares`}
          </h1>
          <p className="muted">
            {data.eventName} ·{' '}
            {formatEventDate(data.startsAt, data.timeZone, true)}
            {data.venue ? ` · ${data.venue}` : ''}
          </p>
        </div>
        <span className="badge neutral">
          {data.guests.length} de {data.seats} registrados
        </span>
      </div>
      <p>
        Hola, {greeting}.{' '}
        {single
          ? 'Tu pago está confirmado. Al registrarte recibirás tu pase con código QR.'
          : 'Completa los datos de cada invitado cuando te sea conveniente; puedes volver a esta liga las veces que necesites.'}
        {data.registrationDeadline &&
          ` Fecha límite: ${new Date(data.registrationDeadline).toLocaleDateString('es-MX', { dateStyle: 'long' })}.`}
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={data.seats}
        aria-valuenow={data.guests.length}
      >
        <i style={{ width: `${(data.guests.length / data.seats) * 100}%` }} />
      </div>
      {!single && (
        <p className="progress-label">
          Cada invitado recibe un correo para aceptar el aviso de privacidad y
          activar su pase. El QR solo contiene un código aleatorio.
        </p>
      )}

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <div className="seats">
        {seats.map((seat) => {
          const guest = bySeat.get(seat);
          if (guest) {
            return (
              <article className="seat" key={guest.id}>
                <div className="seat-number">{seatLabel(seat)}</div>
                <div className="seat-filled">
                  <div>
                    <strong>{guest.name}</strong>
                    <small>{guest.email}</small>
                    <small className="seat-status">
                      {guest.folio} ·{' '}
                      {guest.checkedIn
                        ? 'Ingresó al evento'
                        : guest.pendingActivation
                          ? 'Activación pendiente'
                          : 'Pase enviado'}
                    </small>
                  </div>
                  {!guest.checkedIn && (
                    <div className="seat-actions">
                      <button
                        className="button secondary small"
                        type="button"
                        disabled={resend.isPending}
                        onClick={() => {
                          setNotice(undefined);
                          resend.mutate(guest.id);
                        }}
                      >
                        Reenviar correo
                      </button>
                      <button
                        className="button secondary small"
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Anular el pase de ${guest.name} y liberar este lugar?`,
                            )
                          ) {
                            setNotice(undefined);
                            remove.mutate(guest.id);
                          }
                        }}
                      >
                        Cambiar invitado
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          }
          if (!visibleEmpty.has(seat)) {
            return null;
          }
          return (
            <SeatForm
              // Cambia de llave al guardar para que un lugar liberado vuelva vacío.
              key={`${seat}-${data.guests.length}`}
              seat={seat}
              group={data}
              prefill={
                data.source === 'reconciled' &&
                !data.delegateName &&
                data.guests.length === 0 &&
                seat === 1
              }
              token={token}
              onSaved={(saved, text) => {
                queryClient.setQueryData(key, saved);
                setNotice({ kind: 'ok', text });
              }}
            />
          );
        })}
      </div>
      {!showAll && empties.length > EMPTY_SHOWN && (
        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => setShowAll(true)}
          >
            Ver los otros {empties.length - EMPTY_SHOWN} lugares
          </button>
        </div>
      )}
      {empties.length === 0 && (
        <Notice kind="ok">
          {single
            ? 'Listo, ya estás registrado. Revisa tu correo para ver tu pase.'
            : 'Ya registraste todos los lugares. ¡Gracias!'}
        </Notice>
      )}
    </PublicLayout>
  );
}
