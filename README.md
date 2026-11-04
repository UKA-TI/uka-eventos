# UKA Eventos

Plataforma de registro y operación de eventos de Un Kilo de Ayuda. El archivo
`uka-eventos-mockup-gala.html` conserva el mockup visual de referencia.

## Requisitos

- Node.js 22 LTS (22.13 o superior) y npm 10 o superior.
- Docker Desktop con Docker Compose para MySQL y Mailpit.
- Visual Studio Code (se recomiendan las extensiones listadas en
  `.vscode/extensions.json`).

## Inicio local en Windows + VS Code

1. Clona el repositorio y abre su carpeta en VS Code.
2. Copia `.env.example` a `.env` y ajusta los valores si los puertos locales
   están ocupados.
3. En una terminal PowerShell, ejecuta:

   ```powershell
   npm ci
   docker compose up -d
   npm run dev
   ```

4. Abre <http://localhost:5173>. La API se sirve en
   <http://localhost:3001/api/health> y la bandeja local de correo en
   <http://localhost:8025>.

La API devuelve HTTP 200 solo cuando `SELECT 1` se ejecuta correctamente en
MySQL. Si el servicio de base de datos no está disponible, responde HTTP 503.

## Calidad

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Los commits siguen Conventional Commits; Husky ejecuta Prettier para los
archivos preparados y la CI valida lint, tipos, pruebas y build en los PR a
`main`.

## Configuración de despliegue

Los secretos y valores por entorno se configuran mediante variables de entorno;
no se deben guardar en el repositorio. Antes de desplegar en GoDaddy hay que
confirmar la versión y el host MySQL de cPanel, Remote MySQL, TLS, el origen
CORS y la versión de Node.js disponible en el plan. Las decisiones pendientes
están en `docs/decisiones.md`.
