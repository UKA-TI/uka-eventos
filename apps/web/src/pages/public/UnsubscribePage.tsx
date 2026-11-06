import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unsubscribeResponseSchema } from '@uka/shared';
import { useParams } from 'react-router-dom';
import { apiRequest, errorText } from '../../api.js';
import { Loading, Notice } from '../../components/ui.js';
import { PublicLayout } from './PublicLayout.js';

export function UnsubscribePage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const path = `/api/public/unsubscribe/${encodeURIComponent(token)}`;
  const state = useQuery({
    queryKey: ['unsubscribe', token],
    queryFn: async () =>
      unsubscribeResponseSchema.parse(await apiRequest(path)),
  });
  const confirm = useMutation({
    mutationFn: async () =>
      unsubscribeResponseSchema.parse(
        await apiRequest(path, { method: 'POST' }),
      ),
    onSuccess: (data) => queryClient.setQueryData(['unsubscribe', token], data),
  });

  if (state.isPending) {
    return <Loading />;
  }
  if (state.isError) {
    return (
      <PublicLayout>
        <h1>Esta liga no es válida</h1>
        <p className="muted">
          Revísala en tu correo o escríbenos a privacidad@unkilodeayuda.org.mx.
        </p>
      </PublicLayout>
    );
  }

  const { email, optedOut, privacyUrl } = state.data;
  return (
    <PublicLayout privacyUrl={privacyUrl}>
      {optedOut ? (
        <>
          <h1>Listo, te diste de baja</h1>
          <p>
            Ya no enviaremos invitaciones ni comunicaciones a{' '}
            <strong>{email}</strong>. Si tienes un registro en un evento, sí
            recibirás tu pase y los avisos de ese registro.
          </p>
        </>
      ) : (
        <>
          <h1>¿Ya no quieres recibir comunicaciones?</h1>
          <p>
            Dejaremos de enviar invitaciones y comunicaciones a{' '}
            <strong>{email}</strong>.
          </p>
          {confirm.isError && (
            <Notice>{errorText(confirm.error, 'No se pudo completar.')}</Notice>
          )}
          <button
            className="button primary wide"
            type="button"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? 'Procesando…' : 'Darme de baja'}
          </button>
        </>
      )}
    </PublicLayout>
  );
}
