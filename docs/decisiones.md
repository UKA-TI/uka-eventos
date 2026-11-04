# Decisiones y pendientes

## Rumbo del producto (noviembre de 2026)

El proyecto dejó de ser el registro de la Gala y pasó a ser **EVENTOS UKA**, un CRM
para todos los eventos de Un Kilo de Ayuda, en `eventos.unkilodeayuda.org.mx`.

Decisiones del responsable del proyecto:

- **Acceso:** solo colaboradores con cuenta de Microsoft, por invitación. No hay
  contraseñas, cuentas para voluntarios ni ligas temporales.
- **Perfiles:** se administran dentro del CRM con una matriz visual, y se pueden crear
  perfiles nuevos.
- **Aplicación:** solo web, con PWA para recepción. No habrá Apple Wallet ni Google
  Wallet.
- **Check-in:** híbrido. Valida en vivo con internet; sin internet usa una lista
  descargada y sincroniza después.
- **Pagos:** primero registro manual. El pago en línea queda para después y puede haber
  eventos gratuitos.
- **Donativos:** módulo pendiente hasta definir la plataforma.
- **Correo:** Microsoft 365 con `eventos@unkilodeayuda.org.mx`, con un limitador en el
  backend para reducir costos. Se descartó un servicio externo como Brevo.
- **Historial:** no hay datos previos que importar.
- **Colores:** `#FECE00` y `#0077C9`. El carbón y dorado quedan solo para páginas
  públicas de la Gala.
- **Aviso de privacidad:** <https://www.unkilodeayuda.org.mx/aviso-de-privacidad/>
- **Forma de trabajo:** primero en local y después se exporta a GoDaddy.
- **Gala:** ya se enviaron invitaciones previas y el evento está en venta. Sigue
  programada para el 11 de febrero de 2027.

## Plan

| Fase    | Alcance                                                                        | Estado      |
| ------- | ------------------------------------------------------------------------------ | ----------- |
| A       | Limpieza, login con Microsoft, perfiles y diseño institucional                 | En revisión |
| B       | Series y ediciones, módulos activables, tipos de boleto, formulario por evento | Pendiente   |
| C       | Registro público, QR, correo con limitador, pagos manuales                     | Pendiente   |
| D       | Check-in PWA híbrido, puntos de acceso, incidencias                            | Pendiente   |
| E       | Contactos, empresas, segmentos, invitaciones, donativos manuales               | Pendiente   |
| F       | Tablero, comparativos y exportación                                            | Pendiente   |
| Después | Pago en línea, plataforma de donativos, landing de la Gala                     | Pendiente   |

## Decisiones técnicas

- **Login:** MSAL en el navegador con código y PKCE, validación del `id_token` en el
  servidor y sesión propia en cookie httpOnly. Sigue el esquema de Checador UKA, con
  un registro propio en el mismo tenant y sin secreto.
- **Identidad:** tenant + object id. El correo solo liga la invitación la primera vez.
- **Un perfil por usuario:** los permisos se leen en cada petición, así que un cambio
  aplica de inmediato. Se reemplazó la tabla `user_roles`.
- **Administrador:** tiene todos los permisos por código, incluidos los de módulos
  futuros, y no se puede editar.
- **Acceso de desarrollo:** `DEV_LOGIN_ENABLED` solo existe en local. La API no arranca
  en producción si está activo.
- **Una sola app de Node:** entrega API e interfaz para compartir origen y simplificar
  el hospedaje.
- **Migraciones:** se juntaron en `20261104180000_eventos_uka_init`, porque ninguna
  había llegado a producción.
- **Correo (fase C):** Microsoft desactiva por defecto el SMTP con contraseña a fines
  de diciembre de 2026, así que el envío debe usar Microsoft Graph con OAuth. Esa parte
  sí requerirá un secreto en el servidor, en un registro separado y limitado al buzón
  de eventos. El límite vigente es de 30 mensajes por minuto y 10,000 destinatarios
  al día por buzón.
- **Base de datos:** MariaDB 10.11.19, igual que GoDaddy. En local escucha en
  `127.0.0.1:3307`. XAMPP (MariaDB 10.4) no se usa porque su tabla de privilegios
  reportó un índice corrupto.
- **Folios:** prefijo del evento, dos dígitos del año UTC de inicio y consecutivo de
  cuatro dígitos. Se probó con 500 transacciones simultáneas.

## Pendientes

- Crear el registro de EVENTOS UKA en Entra ID y probar el login real. Ver
  `docs/microsoft-entra.md`.
- Primer despliegue en GoDaddy, cuando el flujo local esté aprobado. Ver
  `docs/despliegue-godaddy.md`.
- Sustituir `apps/web/public/img/logo_uka.png` si se consigue una mejor versión,
  conservando el nombre.
- Revisar con el responsable legal si el aviso de privacidad cubre los datos de eventos.

## GitHub

El repositorio `UKA-TI/uka-eventos` es privado y el plan actual no permite proteger
ramas. Se acordó trabajar por PR, con revisión manual y CI en verde antes de integrar.
Revisar esta limitación antes de agregar colaboradores.
