import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupGuestInputSchema, publicGroupResponseSchema } from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest, errorText } from '../../api.js';
import { Field, Loading, Notice } from '../../components/ui.js';
import { formatEventDate, issuesToErrors } from '../text.js';
import { PublicLayout } from './PublicLayout.js';

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  organization: '',
};

export function GroupPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [authorized, setAuthorized] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  const add = useMutation({
    mutationFn: async (body: unknown) =>
      publicGroupResponseSchema.parse(
        await apiRequest(`/api/public/groups/${token}/guests`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setForm(emptyForm);
      setAuthorized(false);
      setNotice({
        kind: 'ok',
        text: 'Invitado registrado. Recibirá su pase por correo.',
      });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo registrar al invitado.'),
      }),
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
        text: 'Invitado eliminado. Su pase ya no es válido.',
      });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo eliminar al invitado.'),
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
  const left = data.seats - data.guests.length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const parsed = groupGuestInputSchema.safeParse({
      ...form,
      organization: form.organization.trim() || null,
      authorized,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    add.mutate(parsed.data);
  };

  return (
    <PublicLayout privacyUrl={data.privacyUrl}>
      <h1>Registra a tus invitados</h1>
      <p className="muted">
        {data.eventName} · {formatEventDate(data.startsAt, data.timeZone, true)}
        {data.venue ? ` · ${data.venue}` : ''}
      </p>
      <p>
        {data.contactName} · {data.ticketName} · Referencia {data.reference}
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
      <p className="progress-label">
        {data.guests.length} de {data.seats} lugares registrados
      </p>

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {data.guests.length > 0 && (
        <ul className="plain-list guest-list">
          {data.guests.map((guest) => (
            <li key={guest.id}>
              <span>
                <strong>{guest.name}</strong>
                <small>
                  {guest.email} · {guest.folio}
                </small>
              </span>
              {guest.checkedIn ? (
                <span className="badge ok">Ingresó</span>
              ) : (
                <button
                  className="link-button danger"
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`¿Quitar a ${guest.name}?`)) {
                      setNotice(undefined);
                      remove.mutate(guest.id);
                    }
                  }}
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {left > 0 ? (
        <form onSubmit={submit} noValidate>
          <h2 className="form-section">Agregar invitado</h2>
          <div className="form-grid">
            <Field label="Nombre" error={errors.firstName}>
              <input
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
              />
            </Field>
            <Field label="Apellidos" error={errors.lastName}>
              <input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </Field>
            <Field
              label="Correo"
              error={errors.email}
              hint="Aquí recibirá su pase con código QR."
            >
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
          </div>
          <label className="check-field privacy-check">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />
            <span>
              Esta persona me autorizó a compartir sus datos y conoce el{' '}
              <a href={data.privacyUrl} target="_blank" rel="noreferrer">
                aviso de privacidad
              </a>
              .
            </span>
          </label>
          {errors.authorized && (
            <small className="field-error">{errors.authorized}</small>
          )}
          <div className="form-actions">
            <button
              className="button primary"
              type="submit"
              disabled={add.isPending}
            >
              {add.isPending ? 'Guardando…' : 'Agregar invitado'}
            </button>
          </div>
        </form>
      ) : (
        <Notice kind="ok">Ya registraste todos los lugares. ¡Gracias!</Notice>
      )}
    </PublicLayout>
  );
}
