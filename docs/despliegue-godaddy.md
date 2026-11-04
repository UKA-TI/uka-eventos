# Publicar EVENTOS UKA en GoDaddy

Una sola app de Node en cPanel entrega la API y la interfaz en
`https://eventos.unkilodeayuda.org.mx`.

> **Pendiente de validar:** esta aplicación todavía no se ha desplegado en GoDaddy. El
> equipo solo probó Node.js 22.23.4 y la conexión a MariaDB. Ajusta este documento con
> lo que resulte del primer despliegue.

## Variables de entorno

Configúralas en cPanel. No subas `.env` al servidor ni al repositorio.

| Variable                | Valor                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `production`                                                                              |
| `DATABASE_URL`          | `mysql://usuario:contraseña@host:3306/base`, con caracteres especiales codificados en URL |
| `SESSION_SECRET`        | Texto aleatorio de 32 caracteres o más                                                    |
| `CORS_ORIGIN`           | `https://eventos.unkilodeayuda.org.mx`                                                    |
| `AZURE_TENANT_ID`       | Ver `docs/microsoft-entra.md`                                                             |
| `AZURE_CLIENT_ID`       | Ver `docs/microsoft-entra.md`                                                             |
| `BOOTSTRAP_ADMIN_EMAIL` | Tu correo de Microsoft                                                                    |
| `PASS_TOKEN_SECRET`     | Texto aleatorio de 32 caracteres o más. Si cambia, los QR emitidos dejan de funcionar     |
| `PUBLIC_BASE_URL`       | `https://eventos.unkilodeayuda.org.mx`                                                    |
| `MAIL_FROM`             | `eventos@unkilodeayuda.org.mx`                                                            |
| `MAIL_CLIENT_ID`        | Ver `docs/correo-microsoft.md`                                                            |
| `MAIL_CLIENT_SECRET`    | Ver `docs/correo-microsoft.md`                                                            |

GoDaddy asigna `PORT`. La API se niega a arrancar si falta alguna variable obligatoria
o si `DEV_LOGIN_ENABLED` está activo.

## Pasos

1. Crea la base de datos y su usuario en cPanel.
2. Crea el subdominio `eventos.unkilodeayuda.org.mx` y activa HTTPS.
3. Crea la app de Node.js 22 y usa `apps/api/dist/server.js` como archivo de inicio.
4. Sube el código y, en la terminal de cPanel, ejecuta:

   ```bash
   npm ci
   npm run build
   npm run db:deploy
   ```

   `db:deploy` solo aplica migraciones revisadas. Nunca uses `migrate dev` ni el seed
   en producción.

5. Reinicia la app y comprueba que `/api/health` responda
   `{"status":"ok","database":"ok"}`.
6. Entra con tu cuenta de Microsoft. Los perfiles y tu usuario administrador se crean
   al arrancar.

## Mantener activa la cola de correo

La cola de correo corre dentro de la app de Node. Muchos hospedajes con cPanel apagan la
app cuando no recibe visitas, y mientras esté apagada no salen correos. Crea una tarea
programada (Cron Job) en cPanel que la mantenga despierta cada 5 minutos:

```bash
curl -fsS https://eventos.unkilodeayuda.org.mx/api/health > /dev/null
```

Comprueba este comportamiento en el primer despliegue.
