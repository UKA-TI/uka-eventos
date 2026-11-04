import type { ReactNode } from 'react';
import { logoUrl } from '../../brand.js';

export function PublicLayout({
  children,
  privacyUrl,
  wide = false,
}: {
  children: ReactNode;
  privacyUrl?: string;
  wide?: boolean;
}) {
  return (
    <div className="public-page">
      <header className="public-header">
        <img src={logoUrl} alt="Un Kilo de Ayuda" />
      </header>
      <main className={wide ? 'public-card wide' : 'public-card'}>
        {children}
      </main>
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
