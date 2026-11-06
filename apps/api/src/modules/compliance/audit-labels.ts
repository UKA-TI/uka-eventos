/** Cómo se lee cada acción en la bitácora. Una prueba exige que ninguna quede sin texto. */
export const auditActionLabels: Record<string, string> = {
  'auth.login': 'Inició sesión',
  'user.invite': 'Invitó a un usuario',
  'user.update': 'Cambió a un usuario',
  'role.create': 'Creó un perfil',
  'role.update': 'Cambió un perfil',
  'role.delete': 'Eliminó un perfil',
  'event.create': 'Creó un evento',
  'event.update': 'Editó un evento',
  'event.modules': 'Cambió los módulos de un evento',
  'event.status': 'Cambió el estado de un evento',
  'event.duplicate': 'Duplicó un evento',
  'event.delete': 'Eliminó un borrador',
  'series.create': 'Creó una serie',
  'series.update': 'Editó una serie',
  'series.delete': 'Eliminó una serie',
  'ticket.create': 'Creó un boleto',
  'ticket.update': 'Editó un boleto',
  'ticket.delete': 'Eliminó un boleto',
  'field.create': 'Agregó una pregunta al formulario',
  'field.update': 'Editó una pregunta del formulario',
  'field.delete': 'Eliminó una pregunta del formulario',
  'order.create': 'Creó una compra',
  'order.cancel': 'Canceló una compra',
  'order.authorized': 'Dio un alta autorizada',
  'order.reconcile': 'Concilió un pago externo',
  'order.delegate': 'Asignó a quien registra una mesa',
  'order.resend_link': 'Reenvió una liga privada',
  'order.due_date': 'Cambió el vencimiento de una compra',
  'order.remind': 'Envió un recordatorio de pago',
  'order.fiscal': 'Cambió los datos fiscales de una compra',
  'order.invoice': 'Registró la factura de una compra',
  'refund.record': 'Registró un reembolso',
  'refund.void': 'Anuló un reembolso',
  'registration.correct': 'Corrigió el nombre de un invitado',
  'registration.transfer': 'Cedió un pase a otra persona',
  'budget.create': 'Agregó un concepto al presupuesto',
  'budget.update': 'Cambió un concepto del presupuesto',
  'budget.delete': 'Eliminó un concepto del presupuesto',
  'finance.settings': 'Cambió la meta o las condiciones de cobro',
  'policy.save': 'Guardó una política de cancelación',
  'policy.delete': 'Eliminó una política de cancelación',
  'payment.record': 'Registró un pago',
  'payment.void': 'Anuló un pago',
  'pass.resend': 'Reenvió un pase',
  'checkin.manual': 'Dio un ingreso manual',
  'checkin.sync': 'Envió lecturas hechas sin conexión',
  'incident.duplicate': 'Se leyó un pase repetido',
  'incident.revoked': 'Se intentó usar un pase revocado',
  'incident.unknown': 'Se leyó un código desconocido',
  'incident.manual': 'Reportó una incidencia',
  'incident.resolve': 'Resolvió una incidencia',
  'access_point.create': 'Agregó un punto de acceso',
  'seating.auto': 'Generó un acomodo automático',
  'seating.plan': 'Cambió el plano del evento',
  'seating.publish': 'Publicó las mesas',
  'contact.create': 'Creó un contacto',
  'contact.update': 'Editó un contacto',
  'contact.delete': 'Eliminó un contacto',
  'contact.opt_in': 'Registró una autorización de comunicaciones',
  'contact.opt_out': 'Registró una baja de comunicaciones',
  'company.create': 'Creó una empresa',
  'company.update': 'Editó una empresa',
  'company.delete': 'Eliminó una empresa',
  'segment.create': 'Creó un segmento',
  'segment.delete': 'Eliminó un segmento',
  'template.create': 'Creó una plantilla de correo',
  'campaign.create': 'Creó una campaña',
  'campaign.delete': 'Eliminó una campaña',
  'campaign.send': 'Envió una campaña',
  'campaign.cancel': 'Canceló una campaña',
  'donation.create': 'Registró un donativo',
  'donation.void': 'Anuló un donativo',
  'email.retry': 'Reintentó un correo',
  'report.export_contacts': 'Descargó el archivo de contactos',
  'report.export_donations': 'Descargó el archivo de donativos',
  'report.export_receivables': 'Descargó las cuentas por cobrar',
  'report.export_events': 'Descargó el comparativo de eventos',
  'report.export_registrations': 'Descargó el archivo de registros',
};

const statusLabels: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activo',
  closed: 'Cerrado',
  invited: 'Invitado',
  inactive: 'Desactivado',
};

const statusText = (value: unknown) =>
  typeof value === 'string' ? (statusLabels[value] ?? value) : '';

const change = (previous: string, next: string) =>
  previous && previous !== next ? `${previous} → ${next}` : next;

const counted = (value: unknown, one: string, many: string) =>
  typeof value === 'number'
    ? `${value.toLocaleString('es-MX')} ${value === 1 ? one : many}`
    : null;

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

/**
 * Convierte los datos guardados con cada acción en una línea legible. Lo que no se
 * reconoce no se muestra: una lista de permisos o un identificador no aclaran nada.
 */
export function auditDetailText(details: unknown): string {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return '';
  }
  const data = details as Record<string, unknown>;
  const folio = text(data.folio);
  const reference = text(data.reference);
  const reason = text(data.reason);
  const role = text(data.role);
  const amount = typeof data.amount === 'number' ? data.amount : null;
  return [
    text(data.name) ?? text(data.label),
    text(data.email),
    folio && `Folio ${folio}`,
    reference && `Referencia ${reference}`,
    amount !== null &&
      `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
    role && `Perfil: ${change(text(data.previousRole) ?? '', role)}`,
    typeof data.status === 'string' &&
      `Estado: ${change(statusText(data.previous ?? data.previousStatus), statusText(data.status))}`,
    counted(data.recipients, 'destinatario', 'destinatarios'),
    counted(data.rows, 'fila', 'filas'),
    counted(data.items, 'lectura', 'lecturas'),
    reason && `Motivo: ${reason}`,
    text(data.description),
    data.offline === true && 'Sin conexión',
  ]
    .filter(Boolean)
    .join(' · ');
}
