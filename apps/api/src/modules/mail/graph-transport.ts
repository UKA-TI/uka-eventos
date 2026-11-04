import { config } from '../../config.js';
import type { OutgoingEmail } from './templates.js';

export interface MailTransport {
  send(toEmail: string, message: OutgoingEmail): Promise<void>;
}

/**
 * El servicio no está disponible o mal configurado: el mensaje no tiene la culpa.
 * Sirve para no gastar sus intentos mientras se corrige, por ejemplo un secreto vencido.
 */
export class MailServiceError extends Error {
  override name = 'MailServiceError';
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const response = await fetch(
    `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.MAIL_CLIENT_ID ?? '',
        client_secret: config.MAIL_CLIENT_SECRET ?? '',
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_codes?: number[];
  };
  if (!response.ok || !body.access_token) {
    const code = body.error_codes?.[0];
    throw new MailServiceError(
      `No se obtuvo el token de correo: ${body.error ?? response.status}${code ? ` (AADSTS${code})` : ''}`,
    );
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3000) * 1000,
  };
  return cachedToken.value;
}

/** Envía con Microsoft Graph como el buzón configurado en MAIL_FROM. */
export const graphTransport: MailTransport = {
  async send(toEmail, message) {
    const token = await getAccessToken();
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.MAIL_FROM)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          saveToSentItems: true,
          message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: [{ emailAddress: { address: toEmail } }],
            ...(message.inlineImage
              ? {
                  attachments: [
                    {
                      '@odata.type': '#microsoft.graph.fileAttachment',
                      name: message.inlineImage.name,
                      contentType: 'image/png',
                      contentBytes: message.inlineImage.contentBase64,
                      contentId: message.inlineImage.contentId,
                      isInline: true,
                    },
                  ],
                }
              : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      const text = `Microsoft Graph respondió ${response.status}: ${detail.slice(0, 300)}`;
      // Permisos que aún no se propagan, límites de Microsoft o caídas: no es
      // culpa del mensaje. Un 400 sí lo es, por ejemplo una dirección inválida.
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        throw new MailServiceError(text);
      }
      throw new Error(text);
    }
  },
};
