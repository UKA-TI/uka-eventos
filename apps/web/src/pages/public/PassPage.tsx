import { useQuery } from '@tanstack/react-query';
import { publicPassResponseSchema } from '@uka/shared';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../api.js';
import { Loading } from '../../components/ui.js';
import { formatEventDate } from '../text.js';
import { PublicLayout } from './PublicLayout.js';

export function PassPage() {
  const { token = '' } = useParams();
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
  return (
    <PublicLayout privacyUrl={data.privacyUrl}>
      <div className="pass">
        <p className="pass-event">{data.eventName}</p>
        <h1>{data.guestName}</h1>
        {data.qrDataUrl ? (
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
