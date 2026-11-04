# Conectar el correo de EVENTOS UKA

EVENTOS UKA envía los correos como `eventos@unkilodeayuda.org.mx` con Microsoft Graph.
Mientras no se conecte, los mensajes esperan en la cola y no se pierden.

Este es un **registro distinto** al del inicio de sesión, y sí usa un secreto. Se limita
para que solo pueda enviar como ese buzón.

## 1. Crear el registro

1. Entra a <https://entra.microsoft.com> y abre **Aplicaciones > Registros de
   aplicaciones > Nuevo registro**.
2. Captura:
   - **Nombre:** `EVENTOS UKA Correo`
   - **Tipos de cuenta:** solo este directorio organizativo (inquilino único)
   - **URI de redirección:** déjalo vacío
3. Haz clic en **Registrar** y copia el **Id. de aplicación (cliente)**.
4. Abre **Certificados y secretos > Nuevo secreto de cliente**, elige una vigencia y
   copia el **Valor** en ese momento, porque después ya no se muestra.

**No agregues el permiso `Mail.Send` en este registro.** Si lo concedes aquí, la
aplicación podría enviar como cualquier buzón de la organización. El permiso se da en el
paso 2, limitado a un solo buzón.

## 2. Limitar el permiso al buzón

Necesitas el **Id. de objeto** de la aplicación empresarial, que no es el del registro:
abre **Aplicaciones empresariales**, busca `EVENTOS UKA Correo` y cópialo de
**Información general**.

En PowerShell, con una cuenta de administrador de Exchange:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # solo la primera vez
Connect-ExchangeOnline

$clientId = '<Id. de aplicación (cliente)>'
$objectId = '<Id. de objeto de la aplicación empresarial>'

New-ServicePrincipal -AppId $clientId -ObjectId $objectId -DisplayName 'EVENTOS UKA Correo'

New-ManagementScope -Name 'Solo buzon eventos' `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'eventos@unkilodeayuda.org.mx'"

New-ManagementRoleAssignment -App $objectId `
  -Role 'Application Mail.Send' `
  -CustomResourceScope 'Solo buzon eventos'
```

Comprueba el resultado. El primero debe indicar `InScope: True` y el segundo `False`:

```powershell
Test-ServicePrincipalAuthorization -Identity $objectId -Resource 'eventos@unkilodeayuda.org.mx'
Test-ServicePrincipalAuthorization -Identity $objectId -Resource '<otro buzón de la organización>'
```

Los permisos pueden tardar **de 30 minutos a 2 horas** en aplicar.

## 3. Configurar la aplicación

Agrega estos valores a `.env` en local y a las variables de entorno en GoDaddy. No
compartas el secreto por chat ni por correo.

```
MAIL_FROM=eventos@unkilodeayuda.org.mx
MAIL_CLIENT_ID=<Id. de aplicación (cliente)>
MAIL_CLIENT_SECRET=<Valor del secreto>
```

Reinicia la API. El envío usa `AZURE_TENANT_ID`, que ya está configurado.

**Pon un recordatorio antes de que venza el secreto.** Al vencer, los correos se
quedarán en la cola hasta que capturas uno nuevo.

## Si el correo deja de funcionar

Los mensajes no se pierden: si Microsoft rechaza las credenciales, responde 401, 403 o 429,
o tiene una caída, la cola se detiene y reintenta cada 5 minutos sin gastar los intentos del
mensaje. El aviso aparece en la pestaña **Registros** del evento. Solo cuentan como fallidos
los errores propios de un mensaje, como una dirección inválida, y esos se pueden reintentar
desde ahí.

Las direcciones de dominios reservados para pruebas (`.test`, `.example`, `.invalid`,
`.localhost`) nunca se envían.

## Comunicaciones masivas

Las invitaciones comparten los límites de Microsoft con los pases, así que la cola les da un
trato distinto:

- Pases y avisos de pago salen siempre primero, aunque haya una comunicación en curso.
- Una comunicación solo puede usar el 80 % del límite diario; el resto queda reservado.
- A 25 correos por minuto, 1,000 destinatarios tardan unos 40 minutos.
- Si alguien se da de baja o se detiene el envío, lo que seguía en cola ya no sale.
- Cada comunicación lleva una liga para darse de baja. Pide confirmar con un botón porque los
  filtros de correo abren las ligas automáticamente. La baja no afecta pases ni avisos de pago.

Microsoft Graph no permite agregar el encabezado `List-Unsubscribe`, así que la baja se ofrece
solo con la liga dentro del mensaje.

## Límites de envío

La cola envía hasta 25 correos por minuto y 8,000 al día, por debajo de los límites de
Microsoft 365 de 30 por minuto y 10,000 destinatarios al día por buzón. Se ajustan con
`MAIL_RATE_PER_MINUTE` y `MAIL_DAILY_LIMIT`.

## Si algo falla

| Error                                             | Causa probable                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `No se obtuvo el token de correo: invalid_client` | El secreto es incorrecto o venció, se capturó el **Id. secreto** en lugar del **Valor**, o `MAIL_CLIENT_ID` no corresponde. |
| `Microsoft Graph respondió 403`                   | El permiso aún no se propaga o el alcance no incluye el buzón. Revisa el paso 2.                                            |
| `Microsoft Graph respondió 404`                   | `MAIL_FROM` no coincide con un buzón existente.                                                                             |
| `Microsoft Graph respondió 429`                   | Microsoft limitó los envíos. La cola reintenta sola, cada vez con más espera.                                               |
