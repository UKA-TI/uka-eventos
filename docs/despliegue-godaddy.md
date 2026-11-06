# Publicar EVENTOS UKA en GoDaddy

La app se publica en **GoDaddy Node.js Hosting**, conectada al repositorio
`UKA-TI/uka-eventos` (rama `main`). Una sola app de Node entrega la API y la interfaz en
`https://eventos.unkilodeayuda.org.mx`.

> **En validación:** este documento se ajusta con lo que resulte del primer despliegue.

## Conexión con GitHub

El repositorio es privado. GoDaddy solo lo ve si su app de GitHub está **instalada** en la
cuenta UKA-TI con acceso a `uka-eventos`:
<https://github.com/apps/godaddy-node-js-hosting/installations/new>. Usa "Only select
repositories" y elige solo `uka-eventos`.

Cada cambio que llegue a `main` se puede volver a publicar desde el panel de GoDaddy.

## Base de datos

Usa la **base de datos alojada** del panel de la app. GoDaddy inyecta `DB_HOST`,
`DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`; la app y las migraciones las leen solas.
**No configures `DATABASE_URL`**: si existe, tiene prioridad sobre las `DB_*`.

La base de producción arranca vacía. No importes la base local: trae datos de prueba y
una cola de correos que se enviaría.

## Comandos

| Paso        | Comando                          |
| ----------- | -------------------------------- |
| Node        | 22                               |
| Instalación | `npm ci --include=dev`           |
| Compilación | `npm run build`                  |
| Inicio      | `npm run db:deploy && npm start` |

`--include=dev` hace falta porque la compilación usa TypeScript, Vite y Prisma, y con
`NODE_ENV=production` npm los omitiría. Las migraciones corren al iniciar porque es cuando
GoDaddy inyecta las variables de la base. `db:deploy` solo aplica migraciones revisadas y
no hace nada si la base ya está al día. Nunca uses `migrate dev` ni el seed en producción.

## Variables de entorno (secretos)

Se capturan en el panel de GoDaddy. No subas `.env` al servidor ni al repositorio.

| Variable                | Valor                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `production`                                                                            |
| `SESSION_SECRET`        | Texto aleatorio de 32 caracteres o más                                                  |
| `PASS_TOKEN_SECRET`     | Otro texto aleatorio de 32 caracteres o más. Si cambia, los QR emitidos dejan de servir |
| `PUBLIC_BASE_URL`       | `https://eventos.unkilodeayuda.org.mx`                                                  |
| `CORS_ORIGIN`           | `https://eventos.unkilodeayuda.org.mx`                                                  |
| `AZURE_TENANT_ID`       | Ver `docs/microsoft-entra.md`                                                           |
| `AZURE_CLIENT_ID`       | Ver `docs/microsoft-entra.md`                                                           |
| `BOOTSTRAP_ADMIN_EMAIL` | Correo de Microsoft del primer administrador                                            |
| `MAIL_FROM`             | `eventos@unkilodeayuda.org.mx`                                                          |
| `MAIL_CLIENT_ID`        | Ver `docs/correo-microsoft.md`                                                          |
| `MAIL_CLIENT_SECRET`    | Ver `docs/correo-microsoft.md`                                                          |

Para generar un texto aleatorio:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

GoDaddy asigna `PORT`. La API se niega a arrancar si falta `SESSION_SECRET`,
`PASS_TOKEN_SECRET`, `AZURE_TENANT_ID` o `AZURE_CLIENT_ID`, o si `DEV_LOGIN_ENABLED` está
activo.

## Después de publicar

1. Comprueba que `/api/health` responda `{"status":"ok","database":"ok"}`.
2. En Azure (Entra ID) agrega `https://eventos.unkilodeayuda.org.mx` como Redirect URI de
   la app de inicio de sesión.
3. Conecta el subdominio `eventos.unkilodeayuda.org.mx` a la app desde el panel.
4. Entra con tu cuenta de Microsoft. Los perfiles y el administrador se crean al arrancar.

## Mantener activa la cola de correo

La cola de correo corre dentro de la app. Si el hosting la apaga cuando no recibe visitas,
no salen correos mientras esté apagada. Comprueba este comportamiento en el primer
despliegue y, si pasa, programa una visita a `/api/health` cada 5 minutos.
