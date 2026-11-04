import type { ReactNode } from 'react';
import { logoUrl } from '../../brand.js';

export function PublicLayout({
  children,
  privacyUrl,
}: {
  children: ReactNode;
  privacyUrl?: string;
}) {
  return (
    <div className="public-page">
      <header className="public-header">
        <img src={logoUrl} alt="Un Kilo de Ayuda" />
      </header>
      <main className="public-card">{children}</main>
      {privacyUrl && (
        <footer className="public-footer">
          <a href={privacyUrl} target="_blank" rel="noreferrer">
            Aviso de privacidad
          </a>
        </footer>
      )}
    </div>
  );
}
