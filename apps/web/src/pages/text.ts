export function slugify(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function formatMoney(amount: number, currency = 'MXN') {
  return amount === 0
    ? 'Gratis'
    : amount.toLocaleString('es-MX', { style: 'currency', currency });
}

/** Para totales e importes: cero es $0.00, no "Gratis". */
export function formatAmount(amount: number, currency = 'MXN') {
  return amount.toLocaleString('es-MX', { style: 'currency', currency });
}

export function formatEventDate(
  value: string | Date | null,
  timeZone: string,
  withTime = false,
) {
  if (!value) {
    return 'Sin fecha';
  }
  return new Date(value).toLocaleString('es-MX', {
    timeZone,
    dateStyle: withTime ? 'long' : 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
  });
}

export function issuesToErrors(
  issues: { path: PropertyKey[]; message: string }[],
) {
  return Object.fromEntries(
    issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}
