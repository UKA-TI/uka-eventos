/** Convierte un instante UTC a la hora local del evento (para inputs datetime-local). */
export function toLocalDateTime(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(
    parts.map(({ type, value: part }) => [type, part]),
  );
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

/** Interpreta una hora capturada en la zona del evento y la devuelve en UTC. */
export function dateTimeInZoneToIso(value: string, timeZone: string) {
  const wallTime = new Date(`${value}:00Z`).getTime();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  let timestamp = wallTime;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const zone = formatter
      .formatToParts(new Date(timestamp))
      .find(({ type }) => type === 'timeZoneName')?.value;
    const offset = zone?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!offset) {
      if (zone === 'GMT') {
        timestamp = wallTime;
        continue;
      }
      throw new Error(`No se pudo interpretar la zona horaria ${timeZone}.`);
    }
    const minutes = Number(offset[2]) * 60 + Number(offset[3]);
    timestamp = wallTime - (offset[1] === '+' ? minutes : -minutes) * 60_000;
  }
  return new Date(timestamp).toISOString();
}
