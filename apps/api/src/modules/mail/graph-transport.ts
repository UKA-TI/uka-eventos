import { config } from '../../config.js';
import type { OutgoingEmail } from './templates.js';

export interface MailTransport {
  send(toEmail: string, message: OutgoingEmail): Promise<void>;
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
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      `No se obtuvo el token de correo: ${body.error ?? response.status}`,
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
      throw new Error(
        `Microsoft Graph respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
  },
};
