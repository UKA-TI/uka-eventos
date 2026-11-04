# Decisiones y pendientes

## Fase 0

- El repo local se inicializó con `main` y el trabajo de preparación vive en
  `feat/phase-0-bootstrap`. El propietario definitivo del repositorio remoto
  `uka-eventos` debe confirmarse antes de crearlo; la sesión de GitHub actual
  puede operar como `UKA-TI`.
- La versión del servicio MySQL de Docker está parametrizada en `MYSQL_IMAGE`.
  `mysql:8.0` es solo un valor local provisional y debe igualarse a la versión
  disponible en GoDaddy antes de cerrar la prueba de infraestructura.
- Host, puerto, base, usuario, contraseña, TLS y lista de IPs para Remote MySQL
  dependen del cPanel y deben configurarse fuera del repositorio.
- `CORS_ORIGIN`, puertos y nivel de logs son configurables por entorno. El
  origen permitido de producción debe confirmarse antes del despliegue.
- Mailpit es solo una bandeja local; las credenciales SMTP institucionales no
  se configuran ni se necesitan para el endpoint de salud.
- La configuración PWA y el lector de QR se incorporarán en la Fase 5, junto
  con el flujo de check-in, para no activar plugins sin una superficie que los
  consuma en esta fase.
- El equipo no tiene Docker CLI disponible en esta máquina. Aunque hay un
  servicio MySQL local escuchando en el puerto 3306, no sustituye la prueba de
  Compose ni la conexión remota exigida para cerrar la fase.

## Pendiente para cierre de Fase 0

1. Confirmar el propietario (organización o cuenta) del repo remoto `uka-eventos`.
2. Crear el repo privado, proteger `main` con PR obligatorio y CI requerido, y
   publicar esta rama para abrir el PR.
3. Confirmar versión/host de MySQL, IP pública de salida y credenciales
   temporales de cPanel para habilitar Remote MySQL y ejecutar el smoke test
   desde GoDaddy. No guardar credenciales en Git ni en el chat.
4. Confirmar que GoDaddy ofrece una versión de Node.js compatible (preferible
   Node.js 22 LTS, 22.13 o superior) y acceso a variables de entorno del hosting.
