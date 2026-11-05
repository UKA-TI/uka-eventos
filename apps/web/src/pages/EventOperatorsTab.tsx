import { useQuery } from '@tanstack/react-query';
import { eventOperatorListSchema, type EventDetail } from '@uka/shared';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Loading, Notice, StatusBadge } from '../components/ui.js';

const REFRESH_MS = 30_000;

export function EventOperatorsTab({ event }: { event: EventDetail }) {
  const { can } = usePermissions();
  const operators = useQuery({
    queryKey: ['operators', event.id],
    refetchInterval: REFRESH_MS,
    queryFn: async () =>
      eventOperatorListSchema.parse(
        await apiRequest(`/api/events/${event.id}/checkin/operators`),
      ),
  });

  if (operators.isPending) {
    return <Loading />;
  }
  if (operators.isError) {
    return <Notice>{operators.error.message}</Notice>;
  }

  const time = (value: string | null) =>
    value
      ? new Date(value).toLocaleTimeString('es-MX', {
          timeZone: event.timeZone,
          timeStyle: 'short',
        })
      : '—';
  const notReady = operators.data.filter(
    (operator) => operator.canOperate && !operator.lastLoginAt,
  ).length;

  return (
    <>
      {notReady > 0 && (
        <p className="notice warn" role="status">
          {notReady === 1
            ? 'Una persona aún no entra por primera vez.'
            : `${notReady} personas aún no entran por primera vez.`}{' '}
          Pídeles que lo hagan antes del evento para confirmar que su cuenta de
          Microsoft funciona.
        </p>
      )}
      <div className="panel table-panel">
        <div className="panel-heading table-heading">
          <h2>Operadores de recepción</h2>
          {can('users.manage') && (
            <Link className="button secondary small" to="/usuarios">
              Administrar usuarios
            </Link>
          )}
        </div>
        {operators.data.length === 0 ? (
          <p className="muted">
            Nadie tiene permiso de operar el check-in. Asígnalo en Perfiles y
            permisos.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Cuenta</th>
                  <th className="numeric">Ingresos</th>
                  <th className="numeric">Manuales</th>
                  <th className="numeric">Incidencias</th>
                  <th>Accesos y horario</th>
                </tr>
              </thead>
              <tbody>
                {operators.data.map((operator) => (
                  <tr key={operator.id}>
                    <td>
                      <strong>{operator.displayName}</strong>
                      <small className="cell-note">{operator.email}</small>
                      <small className="cell-note">{operator.roleName}</small>
                    </td>
                    <td>
                      <StatusBadge status={operator.status} />
                      {!operator.canOperate && (
                        <small className="cell-note">Ya sin permiso</small>
                      )}
                    </td>
                    <td className="numeric">
                      {operator.checkins.toLocaleString('es-MX')}
                    </td>
                    <td className="numeric">
                      {operator.manual.toLocaleString('es-MX')}
                    </td>
                    <td className="numeric">
                      {operator.incidents.toLocaleString('es-MX')}
                    </td>
                    <td>
                      {operator.doors.length > 0
                        ? operator.doors
                            .map(
                              (door) =>
                                `${door.name}: ${door.checkins.toLocaleString('es-MX')}`,
                            )
                            .join(' · ')
                        : '—'}
                      {operator.firstAt && (
                        <small className="cell-note">
                          {time(operator.firstAt)} – {time(operator.lastAt)}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
