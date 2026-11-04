import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passActivationSchema, publicPassResponseSchema } from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest, errorText } from '../../api.js';
import { Field, Loading, Notice } from '../../components/ui.js';
import { formatEventDate, issuesToErrors } from '../text.js';
import { PublicLayout } from './PublicLayout.js';

function ActivationForm({
  token,
  guestName,
  privacyUrl,
  onDone,
}: {
  token: string;
  guestName: string;
  privacyUrl: string;
  onDone: () => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const activate = useMutation({
    mutationFn: async (body: unknown) =>
      apiRequest(`/api/public/passes/${token}/activate`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => onDone(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = passActivationSchema.safeParse({
      privacyAccepted: accepted,
      phone: phone.trim() || null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    activate.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} noValidate>
      <p>
        Hola, <strong>{guestName}</strong>. Tienes un lugar reservado. Revisa el
        aviso y activa tu pase; la persona que registró tu lugar no lo acepta
        por ti.
      </p>
      {activate.isError && (
        <Notice>
          {errorText(activate.error, 'No se pudo activar el pase.')}
        </Notice>
      )}
      <Field
        label="Celular (opcional)"
        error={errors.phone}
        hint="Solo para avisos de este evento."
      >
        <input
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <label className="check-field privacy-check">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          He leído y acepto el{' '}
          <a href={privacyUrl} target="_blank" rel="noreferrer">
            aviso de privacidad
          </a>
          . Se usa para administrar tu registro y acceso al evento.
        </span>
      </label>
      {errors.privacyAccepted && (
        <small className="field-error">{errors.privacyAccepted}</small>
      )}
      <div className="form-actions">
        <button
          className="button primary wide"
          type="submit"
          disabled={activate.isPending}
        >
          {activate.isPending ? 'Activando…' : 'Activar mi pase'}
        </button>
      </div>
    </form>
  );
}

export function PassPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const pass = useQuery({
    queryKey: ['public-pass', token],
    queryFn: async () =>
      publicPassResponseSchema.parse(
        await apiRequest(`/api/public/passes/${token}`),
      ),
  });

  if (pass.isPending) {
    return <Loading />;
  }
  if (pass.isError) {
    return (
      <PublicLayout>
        <h1>Pase no encontrado</h1>
        <p className="muted">Revisa la liga que recibiste por correo.</p>
      </PublicLayout>
    );
  }

  const data = pass.data;
  const pending = data.status === 'pending_activation';
  return (
    <PublicLayout privacyUrl={data.privacyUrl}>
      <div className="pass">
        <p className="pass-event">{data.eventName}</p>
        <h1>{pending ? 'Activa tu pase' : data.guestName}</h1>
        {pending ? (
          <div className="pass-activation">
            <ActivationForm
              token={token}
              guestName={data.guestName}
              privacyUrl={data.privacyUrl}
              onDone={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ['public-pass', token],
                });
              }}
            />
          </div>
        ) : data.qrDataUrl ? (
          <img
            className="pass-qr"
            src={data.qrDataUrl}
            alt={`Código QR del pase ${data.folio}`}
          />
        ) : (
          <p className="notice error" role="alert">
            Este pase ya no es válido. Si crees que es un error, escríbenos a
            eventos@unkilodeayuda.org.mx.
          </p>
        )}
        <dl className="data-list public-data">
          <div>
            <dt>Folio</dt>
            <dd>{data.folio}</dd>
          </div>
          <div>
            <dt>Boleto</dt>
            <dd>{data.ticketName}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{formatEventDate(data.startsAt, data.timeZone, true)}</dd>
          </div>
          <div>
            <dt>Sede</dt>
            <dd>{data.venue ?? 'Por confirmar'}</dd>
          </div>
        </dl>
        {data.qrDataUrl && (
          <p className="muted pass-note">
            Presenta este código en la entrada. Es personal: no lo compartas.
          </p>
        )}
      </div>
    </PublicLayout>
  );
}
