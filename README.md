# EVENTOS UKA

CRM para crear y administrar todos los eventos de Un Kilo de Ayuda. Se publica en
`eventos.unkilodeayuda.org.mx`. El acceso es solo por invitación y con cuenta de
Microsoft de la organización.

`uka-eventos-mockup-gala.html` es la referencia visual de la Gala y de sus flujos.

## Cómo está organizado

- `apps/api`: API con Express, Prisma y MariaDB. En producción también entrega la
  interfaz, así que todo vive en una sola app de Node.
- `apps/web`: interfaz con React y Vite.
- `packages/shared`: validaciones y catálogo de permisos que usan las dos apps.
- `docs/decisiones.md`: decisiones y pendientes del proyecto.
- `docs/microsoft-entra.md`: cómo registrar la aplicación en Entra ID.
- `docs/correo-microsoft.md`: cómo conectar el envío de correos.
- `docs/despliegue-godaddy.md`: cómo publicar en GoDaddy.

Se trabaja primero en local y después se exporta a GoDaddy.

## Inicio local

Requisitos: Node.js 22.23.4 (`.nvmrc`), npm 10 o superior y MariaDB 10.11, la misma
versión de GoDaddy.

1. Instala y activa Node con nvm-windows: `nvm install 22.23.4` y `nvm use 22.23.4`.
2. Copia `.env.example` como `.env` y configura `DATABASE_URL` y
   `SHADOW_DATABASE_URL`. Codifica en URL los caracteres especiales de la contraseña.
3. Agrega `DEV_LOGIN_ENABLED=true` para entrar sin Microsoft en tu equipo.
4. Ejecuta:

   ```powershell
   npm ci
   npm run db:deploy
   npm run db:seed
   npm run dev
   ```

5. Abre <http://localhost:5173>. La API responde en
   <http://localhost:3001/api/health>.

El seed es solo para desarrollo: crea tres cuentas de prueba (`*@uka.test`) y dos
eventos de ejemplo. Se niega a correr en producción.

## Acceso y permisos

- **Login:** el navegador autentica con Microsoft y el servidor valida el token
  (firma, emisor, audiencia y tenant). Después se usa una cookie de sesión httpOnly.
- **Invitaciones:** solo entra quien está registrado en **Usuarios**. La primera vez
  se liga su identidad de Microsoft (tenant + object id).
- **Perfiles:** Administrador, Recepción y Consulta vienen de fábrica, y se pueden
  crear más desde **Perfiles y permisos**. Administrador siempre tiene todo y no se
  puede modificar.
- **Límites de seguridad:** nadie puede otorgar permisos que no tiene ni cambiar su
  propio perfil o desactivarse.
- **Módulos nuevos:** se agregan al catálogo `permissionCatalog` de
  `packages/shared/src/index.ts` y aparecen solos en la matriz.

## Registro, pases y pagos

- **Ligas públicas, sin iniciar sesión:** `/r/<dirección>` para registrarse, `/pase/<token>`
  para ver el pase y `/mesa/<token>` para capturar invitados de un boleto con varios lugares.
- **Boletos gratuitos:** el pase se emite al registrarse.
- **Boletos de paga:** el lugar queda apartado y el pase se emite cuando el total se
  registra en el CRM. Si se anula el pago o se cancela el pedido, el QR deja de ser válido.
- **Cupo:** los pedidos pendientes y confirmados ocupan lugar. Un pendiente lo libera
  solo si se cancela.
- **Correos:** van a una cola con límite de envío. Sin configurar `MAIL_CLIENT_*`, esperan
  en la cola. Ver `docs/correo-microsoft.md`.

## Calidad

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Pruebas contra una base migrada, que no corren en CI:

```powershell
npm run test:db-integration --workspace @uka/api
npm run test:folio-integration
```

Los commits siguen Conventional Commits. La CI valida lint, tipos, pruebas y build
en los PR a `main`.
