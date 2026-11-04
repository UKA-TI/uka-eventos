# UKA Eventos

Plataforma de registro y operación de eventos de Un Kilo de Ayuda. El archivo
`uka-eventos-mockup-gala.html` conserva el mockup visual de referencia.

## Requisitos

- Node.js 22.23.4 (referencia validada por el equipo en GoDaddy) y npm 10 o
  superior.
- Visual Studio Code (se recomiendan las extensiones listadas en
  `.vscode/extensions.json`).
- Docker Desktop es opcional; solo se necesita para ejecutar MySQL y Mailpit
  locales mediante Compose.

## Inicio local en Windows + VS Code

1. Clona el repositorio y abre su carpeta en VS Code.
2. Usa la versión de Node declarada en `.nvmrc` (con nvm-windows, por ejemplo,
   `nvm install 22.23.4` y `nvm use 22.23.4`). Copia `.env.example` a `.env` y
   configura una base MySQL accesible. No uses credenciales de producción en
   el equipo local. `DATABASE_URL` es la cadena que usa Prisma; codifica en
   URL cualquier carácter especial de usuario o contraseña. Las variables
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` siguen siendo
   compatibles con la API si no se define `DATABASE_URL`.
3. En una terminal PowerShell, ejecuta:

   ```powershell
   npm ci
   npm run dev
   ```

4. Abre <http://localhost:5173>. La API escucha en
   <http://localhost:3001/api/health>.

La API devuelve HTTP 200 solo cuando `SELECT 1` se ejecuta correctamente en
MySQL. Si el servicio de base de datos no está disponible, responde HTTP 503.
La interfaz y la API arrancan sin Docker, pero el estado de salud será 503 si
no hay una base MySQL accesible y configurada en `.env`.

### Prisma y datos de desarrollo

Con una base MySQL compatible configurada en `DATABASE_URL`, ejecuta:

```powershell
npm run db:generate
npm run db:migrate
```

`db:migrate` crea y aplica una migración local de desarrollo. Necesita una base
shadow: configura `SHADOW_DATABASE_URL` con un esquema vacío e independiente o
da al usuario local de migraciones permiso para crearla. En un entorno ya
desplegado, aplica migraciones revisadas con `npm run db:deploy`; no uses
`migrate dev` en producción.

El seed es solo para desarrollo y solicita `SEED_ADMIN_PASSWORD`,
`SEED_RECEPTION_PASSWORD` y `SEED_QUERY_PASSWORD` en `.env` (cada una con al
menos 12 caracteres). No usa contraseñas predeterminadas. Ejecútalo con
`npm run db:seed`; crea el evento Gala y datos ficticios y es repetible.

La prueba unitaria de folios, con cobertura mínima del 90%, corre con
`npm run test:folio-coverage`. La verificación de concurrencia contra MySQL
real requiere una base migrada y corre con `npm run test:folio-integration`;
crea y elimina un evento de prueba.

### Servicios locales opcionales

Para levantar MySQL y Mailpit con Docker Compose, ejecuta
`npm run infra:up`; Mailpit queda en <http://localhost:8025>. Para detenerlos,
ejecuta `npm run infra:down`. También puedes configurar MySQL y un servidor SMTP
de desarrollo instalados localmente y no instalar Docker.

Docker no forma parte del despliegue de producción: GoDaddy Node.js Hosting
ejecuta la API y el servicio MySQL de cPanel. En ese entorno la aplicación usa
el `PORT` que asigna GoDaddy y requiere las variables de conexión MySQL.

Para preparar la API para GoDaddy, ejecuta `npm ci`, `npm run build` y
`npm start`. Configura `DATABASE_URL` en las variables de entorno de la
aplicación en cPanel (o las variables `DB_*` compatibles con la API); no subas
`.env` al hosting ni al repositorio. Antes de ejecutar migraciones o el seed
desde CLI, configura también `DATABASE_URL`. El endpoint de humo es
`GET /api/health`.

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
no se deben guardar en el repositorio. El equipo ya validó en GoDaddy Node.js
v22.23.4 y una conexión a MySQL de cPanel con `SELECT 1`. Eso valida el entorno
del proveedor; el smoke test de `/api/health` de esta aplicación todavía debe
ejecutarse después de configurar las variables y desplegarla. Las decisiones y
controles pendientes están en `docs/decisiones.md`.
