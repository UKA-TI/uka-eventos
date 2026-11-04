import type { Response } from 'express';

type Cell = string | number | null | undefined;

/**
 * Excel ejecuta como fórmula el texto que empieza con estos signos, y estos datos los
 * captura cualquier persona en el registro público. Solo se neutraliza texto: los
 * números reales, incluidos los negativos, se quedan como números.
 */
function cellText(value: Cell): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(cellText).join(','));
  // La marca BOM hace que Excel respete los acentos al abrir el archivo.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function sendCsv(response: Response, name: string, csv: string): void {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.send(csv);
}

export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : '';
}
