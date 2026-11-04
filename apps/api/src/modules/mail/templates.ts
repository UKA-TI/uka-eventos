import { readFile } from 'node:fs/promises';
import { PRIVACY_NOTICE_URL } from '@uka/shared';
import QRCode from 'qrcode';
import { prisma } from '../../database.js';
import { groupUrl, passToken, passUrl } from '../passes/tokens.js';

export interface InlineImage {
  contentId: string;
  name: string;
  contentBase64: string;
}

export interface OutgoingEmail {
  subject: string;
  html: string;
  inlineImages: InlineImage[];
}

type EmailContent = Omit<OutgoingEmail, 'inlineImages'> & {
  inlineImages?: InlineImage[];
};

const LOGO_FILE = new URL('../../../../../img/logo_uka.png', import.meta.url);
const LOGO_CONTENT_ID = 'uka-logo';
const LOGO_HEADER = `<img src="cid:${LOGO_CONTENT_ID}" width="120" height="120" alt="Un Kilo de Ayuda" style="display:block;margin:0 0 4px">`;
const TEXT_HEADER =
  '<p style="margin:0 0 4px;color:#0077C9;font-size:13px;font-weight:bold">Un Kilo de Ayuda</p>';

/** Se lee en cada envío para que reemplazar el archivo baste para cambiar el logo. */
async function readLogo(): Promise<InlineImage | null> {
  try {
    const file = await readFile(LOGO_FILE);
    return {
      contentId: LOGO_CONTENT_ID,
      name: 'logo_uka.png',
      contentBase64: file.toString('base64'),
    };
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date: Date | null, timeZone: string): string {
  return date
    ? date.toLocaleString('es-MX', {
        timeZone,
        dateStyle: 'long',
        timeStyle: 'short',
      })
    : 'Por confirmar';
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,sans-serif;color:#1c1c1c">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #FECE00;border-radius:8px">
<tr><td style="padding:24px 28px">
${LOGO_HEADER}
<h1 style="margin:0 0 16px;font-size:21px">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0 0;padding-top:14px;border-top:1px solid #e2e4e8;color:#6b6b6b;font-size:12px">
Consulta nuestro <a href="${PRIVACY_NOTICE_URL}" style="color:#0077C9">aviso de privacidad</a>.
</p>
</td></tr></table></body></html>`;
}

function details(rows: [string, string][]): string {
  return `<table role="presentation" style="margin:0 0 16px;font-size:14px">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 14px 3px 0;color:#6b6b6b">${escapeHtml(label)}</td><td style="padding:3px 0;font-weight:bold">${escapeHtml(value)}</td></tr>`,
    )
    .join('')}</table>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:18px 0"><a href="${url}" style="display:inline-block;padding:11px 18px;background:#0077C9;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(label)}</a></p>`;
}

async function renderPass(refId: string): Promise<EmailContent | null> {
  const pass = await prisma.pass.findUnique({
    where: { id: refId },
    include: {
      registration: {
        include: {
          guest: true,
          event: true,
          order: { include: { ticketType: { select: { name: true } } } },
        },
      },
    },
  });
  if (!pass || pass.status !== 'active') {
    return null;
  }
  const { registration } = pass;
  const { event, guest } = registration;
  const png = await QRCode.toBuffer(passToken(pass.id), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
  return {
    subject: `Tu pase para ${event.name} (${registration.folio})`,
    inlineImages: [
      {
        contentId: 'pase-qr',
        name: 'pase-qr.png',
        contentBase64: png.toString('base64'),
      },
    ],
    html: layout(
      'Tu pase está listo',
      `<p style="margin:0 0 14px">Hola, ${escapeHtml(guest.firstName)}. Presenta este código QR en la entrada. Es personal: no lo compartas.</p>
${details([
  ['Evento', event.name],
  ['Fecha', formatDate(event.startsAt, event.timeZone)],
  ['Sede', event.venue ?? 'Por confirmar'],
  ['Boleto', registration.order.ticketType.name],
  ['Folio', registration.folio],
])}
<p style="margin:0;text-align:center"><img src="cid:pase-qr" width="240" height="240" alt="Código QR de tu pase"></p>
${button(passUrl(pass.id), 'Ver mi pase')}`,
    ),
  };
}

async function renderOrderPending(refId: string): Promise<EmailContent | null> {
  const order = await prisma.order.findUnique({
    where: { id: refId },
    include: {
      buyer: true,
      event: true,
      ticketType: { select: { name: true } },
    },
  });
  if (!order || order.status !== 'pending_payment') {
    return null;
  }
  const amount = order.amountDue.toNumber().toLocaleString('es-MX', {
    style: 'currency',
    currency: order.event.currency,
  });
  const instructions = order.event.paymentInstructions
    ? `<p style="margin:0 0 6px;font-weight:bold">Cómo pagar</p>
<p style="margin:0 0 14px;white-space:pre-line">${escapeHtml(order.event.paymentInstructions)}</p>`
    : '';
  return {
    subject: `Registro recibido para ${order.event.name} (${order.reference})`,
    html: layout(
      'Recibimos tu registro',
      `<p style="margin:0 0 14px">Hola, ${escapeHtml(order.buyer.firstName)}. Tu lugar queda apartado. Te enviaremos tu pase con código QR en cuanto registremos tu pago.</p>
${details([
  ['Evento', order.event.name],
  ['Boleto', order.ticketType.name],
  ['Referencia', order.reference],
  ['Total a pagar', amount],
])}
${instructions}`,
    ),
  };
}

async function renderGroupLink(refId: string): Promise<EmailContent | null> {
  const order = await prisma.order.findUnique({
    where: { id: refId },
    include: { buyer: true, event: true },
  });
  if (!order || order.status !== 'confirmed' || !order.groupTokenHash) {
    return null;
  }
  return {
    subject: `Registra a tus invitados para ${order.event.name}`,
    html: layout(
      'Registra a tus invitados',
      `<p style="margin:0 0 14px">Hola, ${escapeHtml(order.buyer.firstName)}. Tu compra de ${order.seats} lugares está confirmada. Captura a cada invitado con esta liga privada, cuando te sea conveniente; cada persona recibirá su propio pase.</p>
${button(groupUrl(order.id), 'Registrar invitados')}
<p style="margin:0;color:#6b6b6b;font-size:13px">No compartas esta liga fuera de tu equipo: permite agregar y quitar invitados.</p>`,
    ),
  };
}

function renderContent(
  kind: string,
  refId: string,
): Promise<EmailContent | null> {
  switch (kind) {
    case 'pass':
      return renderPass(refId);
    case 'order_pending':
      return renderOrderPending(refId);
    case 'group_link':
      return renderGroupLink(refId);
    default:
      return Promise.resolve(null);
  }
}

/** Devuelve null si el mensaje ya no aplica, por ejemplo si se canceló el pedido. */
export async function renderEmail(
  kind: string,
  refId: string,
): Promise<OutgoingEmail | null> {
  const content = await renderContent(kind, refId);
  if (!content) {
    return null;
  }
  const images = content.inlineImages ?? [];
  const logo = await readLogo();
  // Sin el archivo, el correo sale igual: no se detiene un pase por una imagen.
  return logo
    ? { ...content, inlineImages: [logo, ...images] }
    : {
        ...content,
        html: content.html.replace(LOGO_HEADER, TEXT_HEADER),
        inlineImages: images,
      };
}
