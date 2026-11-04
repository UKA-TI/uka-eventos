import { logoUrl } from '../brand.js';
import { useQueryClient } from '@tanstack/react-query';
import { authSessionResponseSchema } from '@uka/shared';
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiRequest, errorText } from '../api.js';
import { completeMicrosoftLogin, startMicrosoftLogin } from '../auth/msal.js';
import { sessionKey, useAuthConfig, useSession } from '../auth/session.js';
import { Loading, Notice } from '../components/ui.js';

const devAccounts = [
  ['admin@uka.test', 'Administrador'],
  ['recepcion@uka.test', 'Recepción'],
  ['consulta@uka.test', 'Consulta'],
];

export function LoginPage() {
  const session = useSession();
  const authConfig = useAuthConfig();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const redirectHandled = useRef(false);
  const microsoft = authConfig.data?.microsoft;

  const openSession = async (path: string, body: unknown) => {
    const result = authSessionResponseSchema.parse(
      await apiRequest(path, { method: 'POST', body: JSON.stringify(body) }),
    );
    queryClient.setQueryData(sessionKey, result);
  };

  // Al volver de Microsoft, cambia el id_token por una sesión de EVENTOS UKA.
  useEffect(() => {
    if (!microsoft || redirectHandled.current) {
      return;
    }
    redirectHandled.current = true;
    setBusy(true);
    completeMicrosoftLogin(microsoft.clientId, microsoft.tenantId)
      .then(async (idToken) => {
        if (idToken) {
          await openSession('/api/auth/microsoft', { idToken });
        }
      })
      .catch((error: unknown) => {
        setNotice(errorText(error, 'No se pudo iniciar sesión con Microsoft.'));
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [microsoft]);

  if (session.isPending || authConfig.isPending) {
    return <Loading />;
  }
  if (session.data?.user) {
    return <Navigate to="/" replace />;
  }

  const signIn = async () => {
    if (!microsoft) {
      return;
    }
    setNotice('');
    setBusy(true);
    try {
      await startMicrosoftLogin(microsoft.clientId, microsoft.tenantId);
    } catch (error) {
      setNotice(errorText(error, 'No se pudo abrir el acceso de Microsoft.'));
      setBusy(false);
    }
  };

  const devLogin = async (email: string) => {
    setNotice('');
    try {
      await openSession('/api/auth/dev-login', { email });
    } catch (error) {
      setNotice(errorText(error, 'No se pudo iniciar sesión.'));
    }
  };

  return (
    <main className="login-page">
      <aside className="login-aside">
        <p className="login-kicker">EVENTOS UKA</p>
        <h2>Eventos, boletos y contactos en un solo lugar.</h2>
        <p>
          Crea eventos, registra asistentes y opera la recepción de Un Kilo de
          Ayuda.
        </p>
      </aside>
      <div className="login-main">
        <div className="login-card">
          <img className="login-logo" src={logoUrl} alt="Un Kilo de Ayuda" />
          <h1>Inicia sesión</h1>
          <p className="muted">
            Acceso para colaboradores con cuenta de Microsoft de Un Kilo de
            Ayuda.
          </p>
          <Notice>{notice}</Notice>
          {authConfig.isError && <Notice>{authConfig.error.message}</Notice>}
          {microsoft ? (
            <button
              className="button primary wide"
              type="button"
              disabled={busy}
              onClick={signIn}
            >
              {busy ? 'Conectando…' : 'Iniciar sesión con Microsoft'}
            </button>
          ) : (
            <Notice>
              El inicio de sesión con Microsoft aún no está configurado.
            </Notice>
          )}
          {authConfig.data?.devLoginEnabled && (
            <div className="dev-login">
              <small>Solo en este equipo de desarrollo:</small>
              <div className="dev-login-buttons">
                {devAccounts.map(([email, label]) => (
                  <button
                    key={email}
                    className="button secondary small"
                    type="button"
                    onClick={() => void devLogin(email)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
