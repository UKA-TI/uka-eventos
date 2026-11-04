# Registrar EVENTOS UKA en Microsoft Entra ID

Usa el mismo tenant de Checador UKA, pero con un registro propio. Así cada aplicación
tiene sus propias direcciones de regreso y se puede administrar por separado.

El inicio de sesión **no necesita un secreto**.

## Pasos

1. Entra a <https://entra.microsoft.com> con una cuenta con permiso para registrar
   aplicaciones.
2. Abre **Applications > App registrations > New registration**.
3. Captura:
   - **Name:** `EVENTOS UKA`
   - **Supported account types:** _Accounts in this organizational directory only_
     (Single tenant)
   - **Redirect URI:** plataforma **Single-page application (SPA)** y dirección
     `http://localhost:5173/login`
4. Haz clic en **Register**.
5. En **Overview**, copia **Application (client) ID** y **Directory (tenant) ID**.
6. En **Authentication**, dentro de la plataforma SPA, agrega también
   `https://eventos.unkilodeayuda.org.mx/login` y guarda.
7. Deja sin marcar las opciones de _Implicit grant_ y no crees ningún _client secret_.
8. En **API permissions**, deja el permiso predeterminado `User.Read` (delegado). Si
   administras el tenant, haz clic en **Grant admin consent** para que los
   colaboradores no vean la pantalla de consentimiento.

## Configuración

Agrega los valores a `.env` en local y a las variables de entorno en GoDaddy:

```
AZURE_TENANT_ID=<Directory (tenant) ID>
AZURE_CLIENT_ID=<Application (client) ID>
```

Reinicia la API después de cambiarlos.

## Primer administrador

- **En producción:** define `BOOTSTRAP_ADMIN_EMAIL` con tu correo de Microsoft antes
  del primer arranque. Solo se usa mientras no exista ningún administrador.
- **En local:** el seed ya crea un administrador de prueba, así que esa variable no
  aplica. Entra con el botón _Administrador_ e invítate desde **Usuarios** con ese
  perfil.

## Si algo falla

| Mensaje                        | Causa probable                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `AADSTS50011` (redirect URI)   | La dirección no está registrada como SPA o no coincide exactamente, incluido `/login`. |
| `AADSTS9002326` (cross-origin) | La dirección se registró como _Web_ en lugar de _SPA_.                                 |
| "Tu cuenta no tiene acceso"    | La persona no está invitada en **Usuarios**, o su correo es distinto al de Microsoft.  |
| "No se pudo validar tu sesión" | `AZURE_TENANT_ID` o `AZURE_CLIENT_ID` no corresponden a este registro.                 |
