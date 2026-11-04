import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SegmentRecord } from '@uka/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Loading, Notice, PageHeading } from '../../components/ui.js';
import { filtersToParams, useSegments } from './crm.js';

export function SegmentsPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const segments = useSegments();
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const remove = useMutation({
    mutationFn: async (segment: SegmentRecord) =>
      apiRequest(
        `/api/segments/${segment.id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['segments'] });
      setNotice({ kind: 'ok', text: 'Segmento borrado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo borrar el segmento.'),
      }),
  });

  if (segments.isPending) {
    return <Loading />;
  }

  return (
    <section>
      <PageHeading
        title="Segmentos"
        description="Un segmento guarda filtros de contactos y se actualiza solo: siempre incluye a quien los cumpla hoy."
        action={
          can('contacts.view', 'contacts.manage') && (
            <Link className="button primary link-as-button" to="/contactos">
              Crear desde contactos
            </Link>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {segments.isError && <Notice>{segments.error.message}</Notice>}
      <div className="panel table-panel">
        {segments.data?.length === 0 ? (
          <p className="muted">
            Aún no hay segmentos. Filtra la lista de contactos y elige «Guardar
            como segmento».
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Segmento</th>
                  <th>Contactos</th>
                  <th>Con correo y sin baja</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {segments.data?.map((segment) => (
                  <tr key={segment.id}>
                    <td>
                      {can('contacts.view', 'contacts.manage') ? (
                        <Link
                          to={`/contactos?${filtersToParams(segment.filters)}`}
                        >
                          <strong>{segment.name}</strong>
                        </Link>
                      ) : (
                        <strong>{segment.name}</strong>
                      )}
                    </td>
                    <td>{segment.contacts.toLocaleString('es-MX')}</td>
                    <td>{segment.reachable.toLocaleString('es-MX')}</td>
                    <td>
                      {can('contacts.manage') && (
                        <div className="row-actions">
                          <button
                            className="link-button danger"
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Borrar el segmento "${segment.name}"?`,
                                )
                              ) {
                                setNotice(undefined);
                                remove.mutate(segment);
                              }
                            }}
                          >
                            Borrar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
