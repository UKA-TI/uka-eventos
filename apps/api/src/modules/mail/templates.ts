import { readFile, stat } from 'node:fs/promises';
import { PRIVACY_NOTICE_URL } from '@uka/shared';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { prisma } from '../../database.js';
import {
  groupUrl,
  passToken,
  passUrl,
  registrationUrl,
  unsubscribeUrl,
} from '../passes/tokens.js';
import {
  calendarLinks,
  passIcsUrl,
  passPdfUrl,
  passQrUrl,
} from '../passes/pass-links.js';

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
const LOGO_HEADER = `<img src="cid:${LOGO_CONTENT_ID}" width="120" height="120" alt="Un Kilo de Ayuda" style="display:block;margin:0 0 4px;border-radius:8px;background:#ffffff">`;
const TEXT_HEADER =
  '<p style="margin:0 0 4px;color:#0077C9;font-size:13px;font-weight:bold">Un Kilo de Ayuda</p>';

const ICON_DIR = new URL('../../../assets/mail/', import.meta.url);

/** Solo adjunta los íconos que el correo usa. Sin el archivo, la liga queda solo con su leyenda. */
async function withIcons(
  html: string,
): Promise<{ html: string; images: InlineImage[] }> {
  const names = [
    ...new Set([...html.matchAll(/cid:icon-(\w+)/g)].map((match) => match[1]!)),
  ];
  const images: InlineImage[] = [];
  let result = html;
  for (const name of names) {
    try {
      const file = await readFile(new URL(`${name}.png`, ICON_DIR));
      images.push({
        contentId: `icon-${name}`,
        name: `${name}.png`,
        contentBase64: file.toString('base64'),
      });
    } catch {
      result = result.replaceAll(
        new RegExp(`<img src="cid:icon-${name}"[^>]*> `, 'g'),
        '',
      );
    }
  }
  return { html: result, images };
}

/**
 * El logo tiene letras negras sobre fondo transparente: en un correo en modo oscuro
 * no se leerían. Se pone sobre blanco al enviar, para seguir usando el mismo archivo.
 */
function onWhite(file: Buffer): Buffer {
  try {
    const image = PNG.sync.read(file);
    const { data } = image;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3]! / 255;
      data[index] = Math.round(data[index]! * alpha + 255 * (1 - alpha));
      data[index + 1] = Math.round(
        data[index + 1]! * alpha + 255 * (1 - alpha),
      );
      data[index + 2] = Math.round(
        data[index + 2]! * alpha + 255 * (1 - alpha),
      );
      data[index + 3] = 255;
    }
    return PNG.sync.write(image);
  } catch {
    return file;
  }
}

let cachedLogo: { mtimeMs: number; contentBase64: string } | null = null;

/** Revisa el archivo en cada envío para que reemplazarlo baste para cambiar el logo. */
async function readLogo(): Promise<InlineImage | null> {
  try {
    // Procesar la imagen es costoso: se guarda hasta que el archivo cambie.
    const { mtimeMs } = await stat(LOGO_FILE);
    if (cachedLogo?.mtimeMs !== mtimeMs) {
      cachedLogo = {
        mtimeMs,
        contentBase64: onWhite(await readFile(LOGO_FILE)).toString('base64'),
      };
    }
    return {
      contentId: LOGO_CONTENT_ID,
      name: 'logo_uka.png',
      contentBase64: cachedLogo.contentBase64,
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

function layout(title: string, body: string, footer = ''): string {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,sans-serif;color:#1c1c1c">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #FECE00;border-radius:8px">
<tr><td style="padding:24px 28px">
${LOGO_HEADER}
<h1 style="margin:0 0 16px;font-size:21px">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0 0;padding-top:14px;border-top:1px solid #e2e4e8;color:#6b6b6b;font-size:12px">
Consulta nuestro <a href="${PRIVACY_NOTICE_URL}" style="color:#0077C9">aviso de privacidad</a>.${footer}
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

/** La acción principal: una celda con fondo, porque Outlook ignora el relleno de un enlace. */
function primaryAction(url: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td align="center" bgcolor="#0077C9" style="border-radius:6px;background:#0077C9"><a href="${escapeHtml(url)}" style="display:block;padding:12px 4px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">${escapeHtml(text)}</a></td></tr></table>`;
}

/** Logotipo y leyenda, sin contorno. Todo el conjunto es la liga, para tocarlo fácil. */
function iconLink(url: string, icon: string, text: string): string {
  return `<td align="center" valign="top" width="33%" style="width:33%"><a href="${escapeHtml(url)}" style="display:block;padding:6px 2px;color:#14212e;font-size:13px;line-height:18px;text-decoration:none"><img src="cid:icon-${icon}" width="36" height="36" alt="" style="border:0;margin-bottom:4px"> <br>${escapeHtml(text)}</a></td>`;
}

/** Siempre tres columnas: los logotipos quedan alineados aunque falte alguna opción. */
function iconRow(cells: string[]): string {
  const blanks = Array.from(
    { length: 3 - cells.length },
    () => '<td width="33%" style="width:33%">&nbsp;</td>',
  );
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin:0 0 10px"><tr>${[...cells, ...blanks].join('')}</tr></table>`;
}

function programRow(event: {
  programStartsAt: Date | null;
  timeZone: string;
}): [string, string][] {
  return event.programStartsAt
    ? [
        [
          'Programa',
          event.programStartsAt.toLocaleTimeString('es-MX', {
            timeZone: event.timeZone,
            timeStyle: 'short',
          }),
        ],
      ]
    : [];
}

/** Las mismas opciones que la página del pase, para quien solo abre el correo. */
function passActions(
  passId: string,
  folio: string,
  event: {
    name: string;
    startsAt: Date | null;
    endsAt: Date | null;
    venue: string | null;
    mapUrl: string | null;
  },
): string {
  const calendar = calendarLinks(event, folio);
  return [
    '<div style="margin:18px 0 0">',
    primaryAction(passUrl(passId), 'Ver mi pase'),
    iconRow([
      iconLink(passPdfUrl(passId), 'pdf', 'Pase en PDF'),
      iconLink(passQrUrl(passId), 'qr', 'Guardar QR'),
      ...(event.mapUrl ? [iconLink(event.mapUrl, 'map', 'Cómo llegar')] : []),
    ]),
    calendar
      ? `<p style="margin:14px 0 4px;color:#5e6b79;font-size:13px;font-weight:bold;text-align:center">Agregar al calendario</p>${iconRow(
          [
            iconLink(calendar.google, 'google', 'Google'),
            iconLink(calendar.outlook, 'outlook', 'Outlook'),
            iconLink(passIcsUrl(passId), 'apple', 'Apple'),
          ],
        )}`
      : '',
    '</div>',
  ].join('');
}

async function renderEventReminder(
  refId: string,
): Promise<EmailContent | null> {
  const pass = await prisma.pass.findUnique({
    where: { id: refId },
    include: {
      checkin: { select: { id: true } },
      registration: {
        include: {
          guest: true,
          event: true,
          publishedTable: { select: { name: true } },
        },
      },
    },
  });
  if (!pass || pass.status !== 'active' || pass.checkin) {
    return null;
  }
  const { registration } = pass;
  const { event, guest } = registration;
  return {
    subject: `Te esperamos: ${event.name}`,
    html: layout(
      'Tu evento está muy cerca',
      `<p style="margin:0 0 14px">Hola, ${escapeHtml(guest.firstName)}. Te recordamos tu asistencia. Ten a la mano tu pase con código QR para entrar más rápido.</p>
${registration.publishedTable ? tableBanner(registration.publishedTable.name) : ''}
${details([
  ['Evento', event.name],
  ['Fecha', formatDate(event.startsAt, event.timeZone)],
  ...programRow(event),
  ['Sede', event.venue ?? 'Por confirmar'],
  ['Folio', registration.folio],
])}
${passActions(pass.id, registration.folio, event)}`,
    ),
  };
}

/** La mesa se ve de lejos: es lo primero que busca quien abre el correo en la entrada. */
function tableBanner(name: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr><td align="center" bgcolor="#e8f3fb" style="padding:14px;border-radius:8px;background:#e8f3fb;color:#06385f"><div style="font-size:13px;font-weight:bold">Tu mesa</div><div style="font-size:30px;font-weight:bold;line-height:1.2">${escapeHtml(name)}</div></td></tr></table>`;
}

async function renderPass(
  refId: string,
  seatNotice = false,
): Promise<EmailContent | null> {
  const pass = await prisma.pass.findUnique({
    where: { id: refId },
    include: {
      registration: {
        include: {
          guest: true,
          event: true,
          publishedTable: { select: { name: true } },
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
  const tableName = registration.publishedTable?.name ?? null;
  const png = await QRCode.toBuffer(passToken(pass.id), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
  return {
    subject:
      seatNotice && tableName
        ? `Tu mesa para ${event.name}: ${tableName}`
        : `Tu pase para ${event.name} (${registration.folio})`,
    inlineImages: [
      {
        contentId: 'pase-qr',
        name: 'pase-qr.png',
        contentBase64: png.toString('base64'),
      },
    ],
    html: layout(
      seatNotice ? 'Tu lugar está listo' : 'Tu pase está listo',
      `<p style="margin:0 0 14px">Hola, ${escapeHtml(guest.firstName)}. ${seatNotice ? 'Ya tenemos tu mesa. Presenta tu código QR en la entrada y te indicaremos dónde sentarte.' : 'Presenta este código QR en la entrada. Es personal: no lo compartas.'}</p>
${tableName ? tableBanner(tableName) : ''}
${details([
  ['Evento', event.name],
  ['Fecha', formatDate(event.startsAt, event.timeZone)],
  ...programRow(event),
  ['Sede', event.venue ?? 'Por confirmar'],
  ['Boleto', registration.order.ticketType.name],
  ['Folio', registration.folio],
])}
<p style="margin:0;text-align:center"><img src="cid:pase-qr" width="240" height="240" alt="Código QR de tu pase"></p>
${passActions(pass.id, registration.folio, event)}`,
    ),
  };
}

/** A la asistente no le toca aceptar por nadie: cada invitado activa su propio pase. */
async function renderPassActivation(
  refId: string,
): Promise<EmailContent | null> {
  const pass = await prisma.pass.findUnique({
    where: { id: refId },
    include: {
      registration: {
        include: {
          guest: true,
          event: true,
          publishedTable: { select: { name: true } },
          order: { include: { buyer: true } },
        },
      },
    },
  });
  if (!pass || pass.status !== 'pending_activation') {
    return null;
  }
  const { registration } = pass;
  const { event, guest, order } = registration;
  const host =
    order.buyer.organization ??
    `${order.buyer.firstName} ${order.buyer.lastName}`;
  return {
    subject: `Tienes un lugar reservado para ${event.name}`,
    html: layout(
      `Tienes un lugar reservado, ${guest.firstName}`,
      `<p style="margin:0 0 14px">${escapeHtml(host)} reservó un lugar para ti. Confirma tus datos y acepta el aviso de privacidad para activar tu pase con código QR.</p>
${details([
  ['Evento', event.name],
  ['Fecha', formatDate(event.startsAt, event.timeZone)],
  ['Sede', event.venue ?? 'Por confirmar'],
  ...(registration.publishedTable
    ? ([['Mesa', registration.publishedTable.name]] as [string, string][])
    : []),
  ['Folio', registration.folio],
])}
${button(passUrl(pass.id), 'Confirmar y activar mi pase')}
<p style="margin:0;color:#6b6b6b;font-size:13px">La liga es personal. Si no reconoces este registro, puedes ignorar este mensaje.</p>`,
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
      `<p style="margin:0 0 14px">${delegateIntro(order)} Captura a cada invitado con esta liga privada, cuando te sea conveniente; cada persona recibirá un correo para activar su pase.</p>
${button(groupUrl(order.id), 'Registrar invitados')}
<p style="margin:0;color:#6b6b6b;font-size:13px">No compartas esta liga fuera de tu equipo: permite agregar y quitar invitados.</p>`,
    ),
  };
}

function delegateIntro(order: {
  seats: number;
  delegateName: string | null;
  buyer: {
    firstName: string;
    lastName: string;
    organization: string | null;
  };
}): string {
  const buyer = `${order.buyer.firstName} ${order.buyer.lastName}`;
  if (order.delegateName) {
    const from = order.buyer.organization
      ? `${buyer} (${order.buyer.organization})`
      : buyer;
    return `Hola, ${escapeHtml(order.delegateName)}. ${escapeHtml(from)} compró ${order.seats} lugares y te encargó registrar a los invitados.`;
  }
  return `Hola, ${escapeHtml(order.buyer.firstName)}. Tu compra de ${order.seats} lugares está confirmada.`;
}

async function renderRegistrationInvite(
  refId: string,
): Promise<EmailContent | null> {
  const order = await prisma.order.findUnique({
    where: { id: refId },
    include: {
      buyer: true,
      event: true,
      ticketType: { select: { name: true } },
    },
  });
  if (!order || order.status !== 'confirmed' || !order.groupTokenHash) {
    return null;
  }
  const several = order.seats > 1;
  return {
    subject: `Completa tu registro para ${order.event.name}`,
    html: layout(
      'Tu compra está confirmada',
      `<p style="margin:0 0 14px">${
        order.delegateName
          ? delegateIntro(order)
          : `Hola, ${escapeHtml(order.buyer.firstName)}. Confirmamos tu pago.`
      } ${
        several
          ? `Registra a las ${order.seats} personas que asistirán: cada una recibirá su propio pase con código QR.`
          : 'Completa tu registro para recibir tu pase con código QR.'
      }</p>
${details([
  ['Evento', order.event.name],
  ['Fecha', formatDate(order.event.startsAt, order.event.timeZone)],
  ['Boleto', order.ticketType.name],
  ['Lugares', String(order.seats)],
  ['Referencia', order.reference],
])}
${button(groupUrl(order.id), several ? 'Registrar asistentes' : 'Completar mi registro')}
<p style="margin:0;color:#6b6b6b;font-size:13px">Esta liga es privada: no la compartas${several ? ' fuera de tu grupo' : ''}.</p>`,
    ),
  };
}

interface MergeValues {
  nombre: string;
  apellidos: string;
  evento: string;
  fecha: string;
  sede: string;
}

function merge(text: string, values: MergeValues): string {
  return text.replace(
    /\{\{\s*(nombre|apellidos|evento|fecha|sede)\s*\}\}/g,
    (_match, key: keyof MergeValues) => values[key],
  );
}

/** El texto es del equipo pero los datos no: todo se escapa antes de dar formato. */
function bodyToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const html = escapeHtml(paragraph.trim()).replace(
        /https?:\/\/[^\s<]+/g,
        (url) => `<a href="${url}" style="color:#0077C9">${url}</a>`,
      );
      return `<p style="margin:0 0 14px;white-space:pre-line">${html}</p>`;
    })
    .join('\n');
}

function campaignContent(
  campaign: {
    subject: string;
    body: string;
    event: {
      name: string;
      slug: string;
      status: string;
      modules: unknown;
      startsAt: Date | null;
      timeZone: string;
      venue: string | null;
    } | null;
  },
  person: { firstName: string; lastName: string },
  unsubscribe: string | null,
): EmailContent {
  const { event } = campaign;
  const values: MergeValues = {
    nombre: person.firstName,
    apellidos: person.lastName,
    evento: event?.name ?? '',
    fecha: event ? formatDate(event.startsAt, event.timeZone) : '',
    sede: event?.venue ?? '',
  };
  const subject = merge(campaign.subject, values);
  const open =
    event?.status === 'active' &&
    Array.isArray(event.modules) &&
    event.modules.includes('publicRegistration');
  const footer = unsubscribe
    ? ` Si ya no quieres recibir estas comunicaciones, <a href="${unsubscribe}" style="color:#0077C9">date de baja aquí</a>.`
    : ' Aquí aparecerá la liga para darse de baja.';
  return {
    subject,
    html: layout(
      subject,
      `${bodyToHtml(merge(campaign.body, values))}${open ? button(registrationUrl(event.slug), 'Quiero registrarme') : ''}`,
      footer,
    ),
  };
}

const campaignEvent = {
  select: {
    name: true,
    slug: true,
    status: true,
    modules: true,
    startsAt: true,
    timeZone: true,
    venue: true,
  },
};

async function renderCampaign(refId: string): Promise<EmailContent | null> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: refId },
    include: {
      contact: true,
      campaign: { include: { event: campaignEvent } },
    },
  });
  // Se revisa al enviar: una baja o una cancelación detienen lo que siga en cola.
  if (
    !recipient ||
    recipient.campaign.status !== 'queued' ||
    recipient.contact.optedOutAt ||
    !recipient.contact.email
  ) {
    return null;
  }
  return campaignContent(
    recipient.campaign,
    recipient.contact,
    unsubscribeUrl(recipient.contact.id),
  );
}

const SAMPLE_PERSON = { firstName: 'Nombre', lastName: 'Apellidos' };

async function renderCampaignTest(refId: string): Promise<EmailContent | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: refId },
    include: { event: campaignEvent },
  });
  if (!campaign) {
    return null;
  }
  const content = campaignContent(campaign, SAMPLE_PERSON, null);
  return { ...content, subject: `[Prueba] ${content.subject}` };
}

function renderContent(
  kind: string,
  refId: string,
): Promise<EmailContent | null> {
  switch (kind) {
    case 'pass':
      return renderPass(refId);
    case 'seat_notice':
      return renderPass(refId, true);
    case 'order_pending':
      return renderOrderPending(refId);
    case 'group_link':
      return renderGroupLink(refId);
    case 'pass_activation':
      return renderPassActivation(refId);
    case 'event_reminder':
      return renderEventReminder(refId);
    case 'registration_invite':
      return renderRegistrationInvite(refId);
    case 'campaign':
      return renderCampaign(refId);
    case 'campaign_test':
      return renderCampaignTest(refId);
    default:
      return Promise.resolve(null);
  }
}

/** Vista previa para la pantalla, con las imágenes dentro del propio HTML. */
export async function renderCampaignPreview(
  campaignId: string,
): Promise<{ subject: string; html: string } | null> {
  const email = await renderEmail('campaign_test', campaignId);
  if (!email) {
    return null;
  }
  const html = email.inlineImages.reduce(
    (result, image) =>
      result.replace(
        `cid:${image.contentId}`,
        `data:image/png;base64,${image.contentBase64}`,
      ),
    email.html,
  );
  return { subject: email.subject.replace(/^\[Prueba\] /, ''), html };
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
  const icons = await withIcons(content.html);
  content.html = icons.html;
  const images = [...(content.inlineImages ?? []), ...icons.images];
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
