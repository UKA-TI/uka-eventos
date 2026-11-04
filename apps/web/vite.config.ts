import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const fromHere = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

/** Archivos de la app instalable. El ícono sale de img/, como el resto de la marca. */
function pwaFiles(): Plugin {
  const icon = readFileSync(fromHere('../../img/logo_uka.png'));
  const manifest = JSON.stringify({
    name: 'EVENTOS UKA',
    short_name: 'EVENTOS UKA',
    description: 'Recepción y administración de eventos de Un Kilo de Ayuda',
    start_url: '/recepcion',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0077C9',
    icons: [
      {
        src: '/icono-app.png',
        // PNG: el ancho y el alto están en los bytes 16 a 23 del archivo.
        sizes: `${icon.readUInt32BE(16)}x${icon.readUInt32BE(20)}`,
        type: 'image/png',
        purpose: 'any',
      },
    ],
  });
  const files: Record<string, { source: string | Buffer; type: string }> = {
    'manifest.webmanifest': {
      source: manifest,
      type: 'application/manifest+json',
    },
    'icono-app.png': { source: icon, type: 'image/png' },
    'sw.js': {
      source: readFileSync(fromHere('./pwa/sw.js'), 'utf8'),
      type: 'text/javascript',
    },
  };
  return {
    name: 'eventos-uka-pwa',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files[request.url?.split('?')[0]?.slice(1) ?? ''];
        if (!file) {
          next();
          return;
        }
        response.setHeader('Content-Type', file.type);
        response.end(file.source);
      });
    },
    generateBundle() {
      for (const [fileName, { source }] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaFiles()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
