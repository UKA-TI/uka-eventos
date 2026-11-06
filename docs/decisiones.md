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
| C       | Registro público, QR, correo con limitador, pagos manuales                     | Terminada   |
| D       | Check-in PWA híbrido, puntos de acceso, incidencias                            | En revisión |
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
- **Check-in híbrido:** la misma regla atiende lecturas en vivo y sincronizadas. El
  dispositivo envía el hash del token, nunca el token, y cada lectura lleva un id propio
  para que reenviarla no duplique nada. El índice único por pase impide dos ingresos
  aunque lean dos puertas a la vez. Al sincronizar se respeta la hora de lectura, nunca
  una hora futura.
- **Datos en el dispositivo:** la lista sin conexión solo lleva nombre, folio y boleto.
  Se borra al cerrar sesión, con aviso si quedan lecturas sin enviar.
- **Lector de QR:** se usa `jsQR` en lugar de la API del navegador, que no existe en
  iPhone. La app instalable es propia y solo guarda la interfaz, nunca respuestas de la API.
- **Rifa:** si el módulo está activo, el folio se asigna al ingresar. En una lectura sin
  conexión se asigna al sincronizar, así que no se puede mostrar en ese momento.
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
- Módulos aún sin pantalla: acompañantes, mesas y donativos.
- Probar el check-in en teléfonos reales, en Android y en iPhone, con HTTPS.
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

## Contactos y comunicaciones

- **El correo identifica a la persona.** Cada registro se une al contacto con ese correo. Como
  quien se registra no demuestra ser dueño de la dirección, solo se completan datos vacíos: nunca
  se sobrescribe lo capturado por el equipo ni se revierte una baja.
- **Las comunicaciones piden permiso, como en un CRM profesional.** Es una casilla opcional, sin
  marcar de inicio y separada del aviso del evento, al registrarse o al activar el pase. Se guardan
  fecha, origen y versión del aviso, y solo a quien dio permiso le llegan comunicaciones. Cada una
  lleva su liga de baja. Pases y avisos de pago no dependen de esto.
- **Una casilla pública no revierte una baja:** quien llena el formulario no ha demostrado ser dueño
  del correo. Sí la revierte activar el pase desde la liga personal, o que el equipo registre el
  permiso a mano, lo que queda en la bitácora.
- **Un contacto con historia no se borra.** Se conservan sus registros y se le da de baja. Las
  solicitudes ARCO de cancelación todavía se atienden a mano por privacidad@unkilodeayuda.org.mx.
- **Un donativo no se borra.** Se anula con motivo para que los totales sean auditables.
- **Un segmento guarda filtros, no personas.** Se actualiza solo; al enviar, los destinatarios
  quedan fijos en esa comunicación.

## Compras hechas por otro medio

- **Quien ya pagó no se registra por la página pública.** Un administrador concilia el pago en el
  evento (**Registros > Conciliar compra**) y el sistema le envía una invitación con liga privada.
  Así nadie puede declararse pagado por su cuenta.
- **El pase sale al registrarse, no al conciliar.** Una compra puede ser de varios boletos o mesas;
  cada asistente recibe su propio pase.
- **Se guarda lo que realmente se recibió.** El monto admite descuentos y cortesías (0). Una misma
  referencia de pago no se puede conciliar dos veces dentro de un evento.
- **Pendiente:** esa liga no pregunta el formulario personalizado del evento, igual que la de mesas.

## Reportes

- **Solo eventos publicados.** Los borradores no cuentan en ningún reporte.
- **Registrados** son los asistentes confirmados, no las compras: una mesa de 10 sin registrar
  suma 10 lugares vendidos y 0 registrados. **Asistencia** es quienes ingresaron entre los
  registrados, y **Ocupación** los lugares apartados o vendidos contra el aforo.
- **Ingresos** son los pagos vigentes de pedidos no cancelados. Los **donativos** van aparte y
  nunca se suman a los ingresos.
- **Nuevas y que repiten** se calculan con el orden cronológico de todos los eventos, sin importar
  el filtro: alguien que vino en 2026 repite en 2027 aunque solo se mire 2027.
- **Ver y descargar son permisos distintos.** Los archivos contienen datos personales y cada
  descarga queda en la auditoría. El texto que parece fórmula de Excel se neutraliza, porque esos
  datos los captura cualquier persona en el registro público.

## Mesas y asistentes

- **Quien compra no suele registrar.** Una compra puede nombrar a un asistente: la liga privada le
  llega a esa persona, no al comprador. Se puede cambiar después desde la pestaña **Mesas**.
- **La asistente captura, pero no acepta por nadie.** Cada invitado recibe un correo, acepta el aviso
  de privacidad y solo entonces existe su QR. Solo quien compró y se registra a sí mismo acepta en la
  liga, y únicamente si no hay asistente.
- **Un correo, un lugar por evento** en la liga privada.
- **Todos los folios son consecutivos con el prefijo del evento,** también los de una mesa. Si un
  lugar cambia de invitado, el nuevo recibe el siguiente folio y el anterior queda anulado.
- **Sin activar, recepción da ingreso a mano** con motivo. La persona entra, pero no se registra un
  consentimiento que no dio.
- **La fecha límite es informativa:** se muestra y se marca como vencida, pero no bloquea la captura.

## Alta autorizada

Para quien llega sin registro. Requiere permiso de recepción o de registros, deja motivo en la
bitácora, no genera cobro y **no respeta el cupo a propósito**, porque es una decisión de quien
autoriza. Su correo es opcional.

## Acomodo de mesas

- **El plano es una imagen PNG o JPG** guardada en la base de datos. Las mesas se guardan en
  porcentaje del plano, así que no se mueven si la pantalla cambia de tamaño.
- **Una compra aparta todos sus lugares,** aunque aún no se registren los invitados: una mesa de
  10 con 4 registrados ocupa 10. Quien se registra después toma uno de esos lugares.
- **El grupo es la empresa o, si no tiene, la compra.** Compras de la misma empresa en momentos
  distintos quedan juntas.
- **El acomodo automático nunca separa un grupo que cabría en una mesa:** avisa y lo deja sin mesa.
  Solo divide a un grupo más grande que cualquier mesa, en mesas cercanas, y también avisa.
- **Lo movido a mano queda fijo** y un nuevo acomodo automático no lo toca.
- **Nada se ve hasta publicar.** Publicar avisa solo a quienes les cambió la mesa, con su pase. Quien
  aún no activa su pase recibe la invitación a activarlo, ya con su mesa.
- **Solo se acomoda lo pagado.** Una compra cancelada o con el pago anulado libera sus lugares.

## Guardar el pase

No hay integración con Apple Wallet ni Google Wallet: exigiría cuentas y certificados, y lo que se
necesita es conservar el QR. El pase ofrece descargar el QR como imagen, además del PDF y el
calendario. La liga de la asistente tampoco pregunta el formulario personalizado del evento.

## Acompañantes

No hay módulo de acompañantes: cada persona se registra con su propio boleto y su propio pase. Así la
base de contactos queda completa, y cualquiera de ellas puede convertirse en donante.

## Recepción sin QR

El folio no es secreto: va impreso en el pase y es consecutivo. Por eso escribirlo no da entrada
directa. Muestra a la persona para verificarla y exige un motivo, igual que buscarla por nombre, y
queda en la bitácora como ingreso manual, también si se hizo sin internet. La linterna solo aparece en
los teléfonos cuyo navegador permite controlarla.

## Control y privacidad

- **Bitácora:** registra lo que hizo cada persona con sesión. No hay forma de editarla ni borrarla desde
  el sistema. Quien se dio de baja desde su correo o aceptó el aviso en público no tiene sesión: eso se
  ve en Consentimientos.
- **Consentimientos:** "Aviso de privacidad" es el historial de aceptaciones por registro.
  "Comunicaciones" muestra el estado vigente de cada contacto, no su historial completo.
- **Permisos propios:** `audit.view` y `consents.view` son aparte porque muestran datos de todas las
  personas. Solo Administrador los trae de inicio.

## Reglas financieras

- **El estado financiero se calcula, no se captura:** pendiente, pagada parcial, pagada, reembolso
  parcial, reembolsada y cancelada salen de los pagos y reembolsos. Así nunca contradicen al dinero.
- **Vencer no cancela:** la fecha límite solo activa recordatorios y el reporte de cobranza. No libera
  lugares.
- **Plazos de pago, ajustables por evento:** 7 días por un lugar y 15 por una mesa o compra de varios
  lugares, que suele requerir orden de compra. Todo vence 10 días antes del evento, para acomodar las
  mesas con lo ya pagado. Quien compra después de esa fecha tiene 2 días, sin pasar del evento.
- **Recordatorios:** 3 días antes, el día que vence, y 3 y 7 días después. Terminan al pagar, cancelar
  o empezar el evento. Si alguien recuerda a mano, el automático espera un día.
- **Anular no es reembolsar:** anular corrige una captura equivocada, como si nunca hubiera pasado.
  Un reembolso es dinero que de verdad salió y queda como movimiento propio, con motivo y responsable.
- **Cancelar no borra el dinero:** lo cobrado se devuelve con un reembolso o se queda como importe
  retenido, que sigue contando como ingreso. Antes de esta regla desaparecía de los reportes.
- **Compra activa con saldo:** no admite reembolso. Para devolver un anticipo se cancela.
- **Separación de funciones:** Cobranza registra pagos y no autoriza reembolsos; Finanzas autoriza
  reembolsos y no captura cobros. Si el equipo es muy chico, se ajusta en Perfiles y permisos.
- **Quién puede:** cancelar una compra con pagos o reembolsar requiere `refunds.manage`, separado de
  `payments.manage`, para que quien registra cobros no sea necesariamente quien devuelve dinero.
- **Política de cancelación por tipo de evento:** quien compra la ve antes de pagar. Los plazos solo
  sugieren el porcentaje; la decisión es de finanzas y queda en la bitácora.
- **Cambio de nombre:** corregir es la misma persona, con el mismo QR. Ceder es otra persona: conserva
  folio y mesa, el QR anterior deja de valer y la nueva persona acepta el aviso por sí misma. La
  aceptación del aviso queda ligada a quien aceptó, no al lugar.
- **Datos fiscales:** el CRM los guarda y lleva el control de lo facturado; no emite CFDI. Los catálogos
  de régimen y uso son los más comunes y debe validarlos contabilidad.
- **Meta y resultado:** ingreso total es boletos netos más donativos. Resultado es ingreso menos costos
  reales. La proyección suma lo que falta cobrar y usa el presupuesto donde aún no hay costo real.
- **Cierre:** avisa pendientes y exige motivo si se cierra con ellos. Guarda los números de ese día y
  bloquea pagos, reembolsos, cancelaciones y presupuesto. Los donativos no se bloquean, porque pueden
  llegar después; quedan fuera de los números guardados. Se puede reabrir.
- **Catálogo:** los productos son los tipos de boleto actuales; no hay marca de deducible.

## Preparado para pasarela y archivo bancario

Pagos y reembolsos ya guardan su origen (`manual` hoy) y un identificador externo único. Cuando llegue
la pasarela o el archivo del banco, un mismo aviso repetido no podrá registrar dos veces el dinero, y
entrará por las mismas reglas de arriba. El crédito autorizado también se decidirá en esa etapa.

## Navegación por tarea

Regla: cada acción vive en un solo lugar, y cada sección aparece solo si el evento la usa.

- **Evento:** Tablero (solo números y alertas) · Ventas (Compras y pagos, Finanzas del evento) ·
  Asistentes (Lista de invitados, Registro por grupo, Acomodo de mesas) · Día del evento (Entradas e
  incidencias, Operadores de recepción) · Configuración (Datos, Tipos de boleto, Formulario, Puntos de
  acceso, Módulos).
- **El dinero de una compra** se maneja en Compras y pagos; **cada persona** (ver pase, reenviar, corregir
  o ceder) en Lista de invitados; la **liga de una mesa** en Registro por grupo; la **alta autorizada**
  en Entradas e incidencias.
- **Menú general:** Inicio · Eventos (Eventos y Series) · Recepción · Contactos (Personas, Empresas y
  Segmentos) · Comunicaciones · Donativos · Cobranza · Reportes · Usuarios y permisos · Control y
  privacidad (Bitácora y Consentimientos).

## Sin importador de Excel

Toda la información se trabajará desde este CRM: no se traerán contactos ni invitados de archivos.

## Perfiles de inicio

Administrador, Dirección, Coordinación de eventos, Supervisión de recepción, Recepción, Cobranza, Finanzas,
Procuración de fondos, Comunicación, Auditoría y privacidad, y Consulta. Se crean una sola vez y no
sobrescriben cambios posteriores. Sus permisos se editan en Perfiles y permisos; solo Administrador es fijo.
Los perfiles del sistema no se pueden borrar: si uno no se usa, simplemente no se asigna.

## Pendiente frente al mockup

Revisado contra `uka-eventos-mockup-gala.html`.

- WhatsApp: para una etapa futura.
- Probar el acomodo con el plano real de la sede, cuando se tenga.
- Pasarela de pago, conciliación por archivo bancario y crédito autorizado.
- Prueba de correos financieros en un buzón real.
- Cargar la política de cancelación cuando se apruebe.
- Publicación en GoDaddy. La landing de la Gala será otro proyecto.
