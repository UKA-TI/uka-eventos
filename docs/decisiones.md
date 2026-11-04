# Decisiones y riesgos aceptados

## Fase 0 — cerrada con excepciones aprobadas

- Repo privado: `UKA-TI/uka-eventos`. El PR #1 se usó para integrar la base de
  Fase 0; la CI `quality` pasó con instalación limpia, lint, typecheck, pruebas
  y build.
- La cuenta actual no puede habilitar protección de ramas para este repo
  privado con el plan disponible: GitHub devuelve HTTP 403 e indica que se
  requiere GitHub Pro o hacer público el repo. El usuario decidió conservarlo
  privado y continuar con el control manual, aceptando que GitHub no bloquea
  técnicamente los pushes directos ni exige que `quality` esté verde antes de
  integrar. Política acordada: cambios por PR, revisión manual y comprobar CI
  verde antes de fusionar; limitar el acceso de escritura. Revisar la limitación
  antes de agregar colaboradores o usar el flujo para producción.
- El equipo reporta pruebas previas satisfactorias en GoDaddy con Node.js
  v22.23.4 y conexión a MySQL de cPanel mediante `SELECT 1`. Por petición del
  usuario, se difiere el despliegue de esta app y su `/api/health` real en
  GoDaddy. Esa validación específica sigue pendiente antes del uso en producción.
- Docker no es requisito de producción ni para arrancar web y API localmente.
  Compose permanece disponible como conveniencia para MySQL y Mailpit locales;
  no se instaló Docker ni se validó Compose en esta máquina.
- `.nvmrc` fija Node.js 22.23.4. La API usa el `PORT` asignado por GoDaddy y
  obtiene su conexión de `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y
  `DB_PASSWORD`. No guardar secretos en Git.
- `CORS_ORIGIN`, puertos y nivel de logs son configurables por entorno. Mailpit
  y el SMTP institucional no se configuran para la prueba de salud.
- Prueba local del mockup web/API: `npm run dev` arrancó sin Docker, el frontend
  respondió HTTP 200 y `/api/health` respondió HTTP 200 con
  `{"status":"ok","database":"ok"}`. Para esa lectura se usó `root` local de
  MariaDB en variables temporales del proceso; no se escribió contraseña en
  `.env` ni en Git.
- El servidor local es MariaDB 10.4.32, no una instalación confirmada de la
  misma versión/producto que cPanel. No se usará como evidencia de paridad con
  GoDaddy.

## GitHub: alternativas revisadas

1. **GitHub Pro (cuenta personal) o GitHub Team (organización):** continuar con
   repo privado y habilitar protección técnica: PR obligatorio, push/force-push
   directo bloqueado, check `quality` requerido y, si hay otro revisor,
   aprobación independiente. Es la opción recomendada para eliminar la
   excepción actual.
2. **GitLab Free privado:** permite proteger ramas y limitar push/merge; sin
   embargo, las aprobaciones de MR en Free son opcionales y no bloquean la
   fusión. Requiere mover el repo canónico y adaptar GitHub Actions a GitLab CI
   (o mantener un espejo).
3. **GitHub Free privado actual:** mantener PR/revisión/CI como política manual.
   Preserva privacidad y evita migración/licencia, pero no ofrece la garantía
   técnica pedida originalmente. Es la opción elegida temporalmente por el
   usuario.

Fuentes oficiales:

- [Planes de GitHub](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)
- [Protección de ramas de GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Reglasets de GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Ramas protegidas de GitLab](https://docs.gitlab.com/user/project/repository/branches/protected/)
- [Aprobaciones de Merge Request en GitLab](https://docs.gitlab.com/user/project/merge_requests/approvals/)

## Bloqueo para probar Fase 1 localmente

- XAMPP tiene MariaDB 10.4.32. `SELECT 1` funciona, pero la escritura de un
  usuario local falló y MariaDB informó que el índice de `mysql.global_priv`
  está corrupto. La cuenta temporal `uka_app@localhost` quedó sin privilegios;
  su limpieza también fue rechazada por el índice corrupto. No hacer más
  escrituras ni intentar reparar tablas del sistema sin respaldo/autorización.
- La base vacía `uka_eventos` fue creada para la prueba. No contiene datos de la
  aplicación.
- Antes de migrar o sembrar Fase 1: recuperar MariaDB local con respaldo o
  disponer de otra instancia de prueba, y confirmar la versión exacta de MySQL
  o MariaDB de GoDaddy para igualar el entorno de pruebas.
- El smoke test de `/api/health` desplegado en GoDaddy se difirió por decisión
  del usuario y deberá realizarse antes de producción.

## Fase 1 — implementación verificada; pendiente aprobación e integración

- Prisma 7 con adaptador MariaDB/MySQL y cliente generado en build. Se eligió
  Prisma 7.10.1 tras detectar que Prisma 6.19 presentaba hallazgos altos en
  `npm audit`; la versión elegida deja la auditoría sin vulnerabilidades.
- La API acepta `DATABASE_URL`; conserva `DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER` y `DB_PASSWORD` como alternativa de compatibilidad. Prisma CLI
  requiere `DATABASE_URL`. Los caracteres especiales de usuario o contraseña
  deben codificarse como URL. `migrate dev` admite un `SHADOW_DATABASE_URL`
  distinto para no requerir privilegios globales de creación de bases.
- El folio se forma con el prefijo configurado, los dos últimos dígitos del
  año UTC de `Event.startsAt` y un consecutivo de cuatro dígitos. El seed Gala
  representa el 11/02/2027 18:30 de Ciudad de México como 12/02/2027 00:30 UTC.
  La hora final se deja sin definir porque el mockup la señala como supuesto.
- `status`, `registrationMode` y `purpose` se guardan como texto para evitar
  fijar vocabularios de negocio todavía no acordados. El seed mantiene los tres
  eventos en borrador; dos son ejemplos genéricos sin fecha ni aforo. El aforo,
  acompañantes, cuota, sede y modo de la Gala reflejan los valores del mockup.
- El seed es exclusivamente de desarrollo; requiere contraseñas locales
  distintas (mínimo 12 caracteres), no incluidas en Git. Las cuentas ficticias
  usan el dominio reservado `.test`.
- El esquema incluye las entidades requeridas, `DATETIME(3)`, relaciones e
  índices únicos para folios por evento, hashes de token, un check-in por pase
  y folios de rifa por evento. El `SELECT ... FOR UPDATE` del contador queda
  dentro de la transacción de Prisma.
- El equipo confirmó GoDaddy con `SELECT VERSION()` =
  `10.11.19-MariaDB` y `@@version_comment` = `MariaDB Server`. Se preparó una
  instancia portátil aislada de esa misma versión, desde el paquete oficial
  cuyo SHA-256 se verificó; escucha solo en `127.0.0.1:3307`. XAMPP/MariaDB
  10.4.32 no se modificó.
- `prisma migrate dev` y `prisma db seed` se ejecutaron sin error contra esa
  instancia. El seed se repitió y verificó: 3 eventos, 40 mesas/400 lugares,
  compras 3/10, 8/8 y 0/5, 11 registros de ejemplo y 3 cuentas con sus roles.
- La prueba de integración ejecutó 500 transacciones concurrentes reales y
  confirmó 500 folios distintos. El adaptador normaliza el tipo numérico que
  entrega MariaDB antes de validarlo. La cobertura unitaria medida del servicio
  de folios es 100% en sentencias, ramas, funciones y líneas.
- **Pendiente:** aprobación del usuario e integración del PR #7. El smoke test
  de esta aplicación en GoDaddy sigue diferido por decisión previa; no se usó
  la base de producción para estas pruebas.
