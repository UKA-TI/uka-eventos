import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';
import { passToken } from './tokens.js';

const LOGO_FILE = new URL('../../../../../img/logo_uka.png', import.meta.url);
const INK = rgb(0.08, 0.13, 0.18);
const MUTED = rgb(0.37, 0.42, 0.47);
const BLUE = rgb(0, 0.467, 0.788);
const YELLOW = rgb(0.996, 0.808, 0);

/** Las fuentes estándar de PDF solo cubren Latin-1; otro carácter haría fallar el pase. */
const printable = (text: string) => text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

export async function passPdf(pass: {
  id: string;
  guestName: string;
  folio: string;
  ticketName: string;
  eventName: string;
  when: string;
  program: string | null;
  venue: string | null;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(printable(`Pase ${pass.folio} - ${pass.eventName}`));
  pdf.setAuthor('Un Kilo de Ayuda');
  const page = pdf.addPage([360, 620]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 28;
  const width = page.getWidth() - margin * 2;

  page.drawRectangle({
    x: 0,
    y: page.getHeight() - 8,
    width: page.getWidth() / 2,
    height: 8,
    color: YELLOW,
  });
  page.drawRectangle({
    x: page.getWidth() / 2,
    y: page.getHeight() - 8,
    width: page.getWidth() / 2,
    height: 8,
    color: BLUE,
  });

  let y = page.getHeight() - 24;
  try {
    const logo = await pdf.embedPng(await readFile(LOGO_FILE));
    const size = 84;
    y -= size;
    page.drawImage(logo, {
      x: (page.getWidth() - size) / 2,
      y,
      width: size,
      height: size,
    });
  } catch {
    // Sin el archivo del logo, el pase sigue siendo válido.
    y -= 12;
    page.drawText('Un Kilo de Ayuda', {
      x: margin,
      y,
      size: 12,
      font: bold,
      color: BLUE,
    });
  }

  const centered = (text: string, size: number, font: PDFFont) => {
    for (const line of wrap(printable(text), font, size, width)) {
      y -= size + 4;
      page.drawText(line, {
        x: (page.getWidth() - font.widthOfTextAtSize(line, size)) / 2,
        y,
        size,
        font,
        color: INK,
      });
    }
  };
  centered(pass.eventName, 15, bold);
  y -= 2;
  centered(pass.guestName, 12, regular);

  const png = await QRCode.toBuffer(passToken(pass.id), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
  });
  const qr = await pdf.embedPng(png);
  const qrSize = 200;
  y -= qrSize + 10;
  page.drawImage(qr, {
    x: (page.getWidth() - qrSize) / 2,
    y,
    width: qrSize,
    height: qrSize,
  });
  y -= 2;
  centered(pass.folio, 14, bold);
  y -= 8;

  const rows: [string, string][] = [
    ['Boleto', pass.ticketName],
    ['Fecha', pass.when],
    ...(pass.program
      ? ([['Programa', pass.program]] as [string, string][])
      : []),
    ['Sede', pass.venue ?? 'Por confirmar'],
  ];
  for (const [label, value] of rows) {
    y -= 14;
    page.drawText(label, {
      x: margin,
      y,
      size: 9,
      font: regular,
      color: MUTED,
    });
    for (const [index, line] of wrap(
      printable(value),
      bold,
      10,
      width - 68,
    ).entries()) {
      if (index > 0) {
        y -= 13;
      }
      page.drawText(line, {
        x: margin + 68,
        y,
        size: 10,
        font: bold,
        color: INK,
      });
    }
  }

  page.drawText(
    'Pase personal. Preséntalo en la entrada, impreso o en tu teléfono.',
    {
      x: margin,
      y: 22,
      size: 8,
      font: regular,
      color: MUTED,
    },
  );
  return pdf.save();
}
