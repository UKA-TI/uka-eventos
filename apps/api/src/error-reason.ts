// Una línea legible con el motivo de un error y de sus causas encadenadas. Sirve para
// hospedajes cuyo visor de registros solo muestra el mensaje, no el objeto del error.
export function errorReason(error: unknown, limit = 400): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const item = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const code = typeof item.code === 'string' ? `[${item.code}] ` : '';
    const message =
      typeof item.message === 'string' ? item.message : String(current);
    const text = `${code}${message}`.replace(/\s+/g, ' ').trim();
    if (text && !parts.includes(text)) parts.push(text);
    current = item.cause;
  }
  const joined = parts.join(' ← ');
  return joined.length > limit ? `${joined.slice(0, limit)}…` : joined;
}
