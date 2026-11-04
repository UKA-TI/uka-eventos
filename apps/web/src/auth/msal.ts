import type { PublicClientApplication } from '@azure/msal-browser';

const scopes = ['openid', 'profile', 'email'];
let instance: PublicClientApplication | null = null;

async function getClient(clientId: string, tenantId: string) {
  if (!instance) {
    // Se carga solo al iniciar sesión: la librería pesa y el resto de la app no la usa.
    const msal = await import('@azure/msal-browser');
    instance = new msal.PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        // Debe volver directo a /login, donde se procesa la respuesta.
        redirectUri: `${window.location.origin}/login`,
        postLogoutRedirectUri: `${window.location.origin}/login`,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await instance.initialize();
  }
  return instance;
}

export async function startMicrosoftLogin(clientId: string, tenantId: string) {
  const client = await getClient(clientId, tenantId);
  await client.loginRedirect({ scopes, prompt: 'select_account' });
}

/** Devuelve el id_token si esta carga de página viene de regreso de Microsoft. */
export async function completeMicrosoftLogin(
  clientId: string,
  tenantId: string,
): Promise<string | null> {
  const client = await getClient(clientId, tenantId);
  const result = await client.handleRedirectPromise();
  return result?.idToken ?? null;
}
