import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SegmentRecord } from '@uka/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Icon } from '../../components/icons.js';
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
    <section className="crm-page segments-page">
      <PageHeading
        title="Segmentos"
        description="Un segmento guarda filtros de contactos y se actualiza solo: siempre incluye a quien los cumpla hoy."
        action={
          can('contacts.view', 'contacts.manage') && (
            <Link className="button primary" to="/contactos">
              Crear desde contactos
            </Link>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {segments.isError && <Notice>{segments.error.message}</Notice>}
      <div className="segment-guide">
        <Icon name="filter" />
        <div>
          <strong>De filtros a una lista siempre actualizada</strong>
          <p>
            Define los criterios en Contactos y elige «Guardar como segmento».
            Abre un segmento para consultar las personas que los cumplen.
          </p>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="panel-heading">
          <h2>Segmentos guardados</h2>
          {segments.data && (
            <span className="result-count">
              {segments.data.length}{' '}
              {segments.data.length === 1 ? 'segmento' : 'segmentos'}
            </span>
          )}
        </div>
        {segments.data?.length === 0 ? (
          <p className="muted">
            Aún no hay segmentos. Filtra la lista de contactos y elige «Guardar
            como segmento».
          </p>
        ) : (
          <div className="table-scroll">
            <table className="crm-table segments-table">
              <thead>
                <tr>
                  <th>Segmento</th>
                  <th>Contactos</th>
                  <th>Aceptan comunicaciones</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {segments.data?.map((segment) => (
                  <tr key={segment.id}>
                    <td data-label="Segmento">
                      <div className="crm-cell-content">
                        {can('contacts.view', 'contacts.manage') ? (
                          <Link
                            to={`/contactos?${filtersToParams(segment.filters)}`}
                          >
                            <strong>{segment.name}</strong>
                          </Link>
                        ) : (
                          <strong>{segment.name}</strong>
                        )}
                        {segment.description && (
                          <p className="segment-description">
                            {segment.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td data-label="Contactos">
                      <span className="segment-count">
                        <Icon name="contacts" />
                        {segment.contacts.toLocaleString('es-MX')}
                      </span>
                    </td>
                    <td data-label="Aceptan comunicaciones">
                      <span className="segment-count">
                        <Icon name="mail" />
                        {segment.reachable.toLocaleString('es-MX')}
                      </span>
                    </td>
                    <td data-label="Acciones">
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
