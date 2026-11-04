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
| A       | Limpieza, login con Microsoft, perfiles y diseño institucional                 | Terminada   |
| B       | Series y ediciones, módulos activables, tipos de boleto, formulario por evento | Terminada   |
| C       | Registro público, QR, correo con limitador, pagos manuales                     | En revisión |
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
  había llegado a producción. Desde la fase B cada cambio es una migración nueva, que
  conserva los datos existentes.
- **Series y ediciones:** todo evento pertenece a una serie y tiene un año de edición.
  Es la base de la comparación año con año de la fase F. El tipo de evento es texto
  libre con sugerencias, para admitir tipos nuevos sin programar.
- **Estado de un evento:** se crea como borrador. Para activarlo necesita fecha de
  inicio, prefijo de folio y al menos un boleto activo, incluso si es gratuito. Un
  evento activo no puede perder esos requisitos.
- **Boletos:** reemplazan la cuota por persona. Precio 0 significa gratuito, y un boleto
  puede incluir varios lugares, como una mesa de 10. Exceder el aforo solo genera un
  aviso, porque los boletos pueden no venderse todos.
- **Nueva edición:** copia configuración, boletos y formulario, pero nunca registros ni
  asistentes. No copia las fechas de venta, porque ya no aplicarían.
- **Módulos:** se guardan por evento y parten de valores sugeridos según el tipo. En
  esta fase solo se configuran; sus pantallas llegan en las fases siguientes.
- **Formulario:** nombre, apellidos, correo y teléfono siempre se piden; cada evento
  agrega sus propias preguntas.
- **Correo:** Microsoft 365 con Microsoft Graph, porque el SMTP con contraseña se
  desactiva por defecto a fines de diciembre de 2026. Usa un registro propio con secreto,
  limitado al buzón de eventos con RBAC para aplicaciones de Exchange. Una cola en la
  base de datos envía hasta 25 correos por minuto y 8,000 al día, y reintenta con espera
  creciente. Los límites de Microsoft son de 30 por minuto y 10,000 destinatarios al día
  por buzón. Un correo que ya no aplica, como el aviso de un pedido ya pagado, se omite.
- **Pedidos y lugares:** un pedido es la compra y cada persona es un registro con su
  folio y su pase. Un boleto de un lugar es de quien lo compra; uno de varios lugares se
  reparte con una liga privada una vez confirmado.
- **QR después del pago:** en eventos de paga el pase se emite solo cuando el pago total
  se registra en el CRM. En los gratuitos, al registrarse. Anular un pago que deja
  incompleto el pedido, o cancelarlo, invalida sus pases.
- **Tokens de pases:** se derivan del id con `PASS_TOKEN_SECRET` y la base solo guarda su
  hash. Permite reenviar el mismo QR sin almacenarlo. Cambiar el secreto invalida los QR.
- **Sobreventa:** la venta bloquea la fila del evento dentro de la transacción, de modo
  que el cupo no se excede con registros simultáneos.
- **Datos de invitados capturados por terceros:** quien captura confirma que el invitado
  autorizó compartir sus datos, y queda registrado. El pase enlaza el aviso de privacidad.
- **Base de datos:** MariaDB 10.11.19, igual que GoDaddy. En local escucha en
  `127.0.0.1:3307`. XAMPP (MariaDB 10.4) no se usa porque su tabla de privilegios
  reportó un índice corrupto.
- **Folios:** prefijo del evento, dos dígitos del año UTC de inicio y consecutivo de
  cuatro dígitos. Se probó con 500 transacciones simultáneas.

## Pendientes

- Conectar el correo. Ver `docs/correo-microsoft.md`.
- Revisar con el responsable legal el consentimiento de los invitados capturados por una
  empresa y de las ventas directas capturadas por el equipo.
- Los pedidos pendientes de pago ocupan lugar hasta que alguien los cancele; no vencen
  solos. Definir si deben tener fecha límite.
- Módulos aún sin pantalla: acompañantes, mesas, rifa y donativos.
- Tema visual de la Gala en páginas públicas: queda para la landing.
- Importar las ventas actuales de la Gala cuando exista el archivo. Sin eso, esos
  compradores no recibirán su QR.
- Crear el registro de EVENTOS UKA en Entra ID y probar el login real. Ver
  `docs/microsoft-entra.md`.
- Primer despliegue en GoDaddy, cuando el flujo local esté aprobado. Ver
  `docs/despliegue-godaddy.md`.
- Sustituir `img/logo_uka.png` si se consigue una mejor versión,
  conservando el nombre.
- Revisar con el responsable legal si el aviso de privacidad cubre los datos de eventos.

## GitHub

El repositorio `UKA-TI/uka-eventos` es privado y el plan actual no permite proteger
ramas. Se acordó trabajar por PR, con revisión manual y CI en verde antes de integrar.
Revisar esta limitación antes de agregar colaboradores.
