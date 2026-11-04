import { eventModuleCatalog, type EventDetail } from '@uka/shared';
import { formatEventDate } from './text.js';

export function EventSummaryTab({
  event,
  onEdit,
}: {
  event: EventDetail;
  onEdit?: () => void;
}) {
  const modules = eventModuleCatalog.filter((module) =>
    event.modules.includes(module.key),
  );
  const rows: [string, string][] = [
    ['Inicio', formatEventDate(event.startsAt, event.timeZone, true)],
    [
      'Fin',
      event.endsAt
        ? formatEventDate(event.endsAt, event.timeZone, true)
        : 'Sin definir',
    ],
    ['Sede', event.venue ?? 'Sin definir'],
    ['Aforo', event.capacity?.toLocaleString('es-MX') ?? 'Sin definir'],
    ['Prefijo de folio', event.folioPrefix ?? 'Sin definir'],
    ['Dirección pública', event.slug],
    ['Registros', event.registrationCount.toLocaleString('es-MX')],
  ];
  if (event.modules.includes('companions')) {
    rows.push(['Acompañantes por persona', String(event.companionLimit)]);
  }

  const publicUrl = `${window.location.origin}/r/${event.slug}`;
  const isOpen =
    event.status === 'active' && event.modules.includes('publicRegistration');

  return (
    <div className="panel">
      <div className="panel-heading">
        <h2>Datos del evento</h2>
        {onEdit && (
          <button
            className="button secondary small"
            type="button"
            onClick={onEdit}
          >
            Editar
          </button>
        )}
      </div>
      {isOpen && (
        <p className="public-link">
          Liga de registro:{' '}
          <a href={publicUrl} target="_blank" rel="noreferrer">
            {publicUrl}
          </a>
        </p>
      )}
      <dl className="data-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div>
          <dt>Módulos activos</dt>
          <dd>
            {modules.length > 0
              ? modules.map((module) => module.label).join(', ')
              : 'Ninguno'}
          </dd>
        </div>
      </dl>
      {event.paymentInstructions && (
        <p className="event-description">
          <strong>Instrucciones de pago</strong>
          <br />
          {event.paymentInstructions}
        </p>
      )}
      {event.description && (
        <p className="event-description">{event.description}</p>
      )}
    </div>
  );
}
