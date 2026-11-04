# Decisiones y pendientes

## Fase 0

- El repo local se inicializó con `main` y el trabajo de preparación vive en
  `feat/phase-0-bootstrap`. El repo privado nuevo `UKA-TI/uka-eventos` está
  creado y el PR #1 está abierto contra `main`.
- La protección de `main` sigue pendiente: GitHub respondió HTTP 403 indicando
  que el plan actual no admite protección para este repo privado. No se debe
  cambiar la visibilidad para sortearlo; habilitar la función mediante el plan
  o transferencia apropiados y después exigir PR y el check `quality`.
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
  Compose ni la conexión remota exigida para cerrar la fase. La API arranca,
  pero el health check local responde 503 porque las credenciales de ejemplo
  no corresponden al MySQL local.

## Pendiente para cierre de Fase 0

1. Habilitar la protección de ramas para el repo privado y requerir el PR y el
   check `quality` en `main`.
2. Instalar Docker Desktop y probar `docker compose up -d` con MySQL y Mailpit.
3. En cPanel, habilitar Remote MySQL para la IP de salida que corresponda y
   configurar un usuario de base de datos dedicado. No guardar ni compartir
   contraseñas en Git o chat.
4. Confirmar versión/host/puerto/nombre de MySQL, allowlist y que GoDaddy
   Node.js Hosting admite Node 22.13 o superior y variables de entorno.
5. Desplegar la API y verificar que `/api/health` en GoDaddy devuelve HTTP 200
   tras ejecutar `SELECT 1` contra el MySQL de cPanel.
