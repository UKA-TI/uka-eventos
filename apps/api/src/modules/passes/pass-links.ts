import { config } from '../../config.js';
import { passToken } from './tokens.js';

const DEFAULT_DURATION_MS = 4 * 60 * 60 * 1000;

export interface CalendarEvent {
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  venue: string | null;
  mapUrl: string | null;
}

const passBase = (passId: string) =>
  `${config.PUBLIC_BASE_URL}/api/public/passes/${passToken(passId)}`;

export const passPdfUrl = (passId: string) => `${passBase(passId)}/pass.pdf`;
export const passQrUrl = (passId: string) => `${passBase(passId)}/qr.png`;
export const passIcsUrl = (passId: string) => `${passBase(passId)}/event.ics`;

const stamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

function eventEnd(event: CalendarEvent, startsAt: Date): Date {
  return event.endsAt ?? new Date(startsAt.getTime() + DEFAULT_DURATION_MS);
}

function details(event: CalendarEvent, folio: string): string {
  return [
    `Pase ${folio}. Presenta tu código QR en la recepción.`,
    event.mapUrl ? `Cómo llegar: ${event.mapUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Ligas para agregar el evento al calendario. Sin fecha todavía no hay qué agregar. */
export function calendarLinks(
  event: CalendarEvent,
  folio: string,
): { google: string; outlook: string } | null {
  if (!event.startsAt) {
    return null;
  }
  const end = eventEnd(event, event.startsAt);
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.name,
    dates: `${stamp(event.startsAt)}/${stamp(end)}`,
    details: details(event, folio),
    location: event.venue ?? '',
  });
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.name,
    startdt: event.startsAt.toISOString(),
    enddt: end.toISOString(),
    body: details(event, folio),
    location: event.venue ?? '',
  });
  return {
    google: `https://calendar.google.com/calendar/render?${google.toString()}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlook.toString()}`,
  };
}

const icsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** RFC 5545: una línea no debe pasar de 75 bytes; se aproxima con caracteres. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 60) {
    parts.push(rest.slice(0, 60));
    rest = ` ${rest.slice(60)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

/** Archivo .ics para Apple Calendar y cualquier otro, con aviso un día antes. */
export function calendarFile(
  event: CalendarEvent,
  folio: string,
  passId: string,
): string | null {
  if (!event.startsAt) {
    return null;
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Un Kilo de Ayuda//EVENTOS UKA//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${passId}@eventos.unkilodeayuda.org.mx`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(eventEnd(event, event.startsAt))}`,
    `SUMMARY:${icsText(event.name)}`,
    ...(event.venue ? [`LOCATION:${icsText(event.venue)}`] : []),
    `DESCRIPTION:${icsText(details(event, folio))}`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(`Mañana: ${event.name}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
