# Decisiones y pendientes

## Fase 0

- El repo privado `UKA-TI/uka-eventos` está creado. El trabajo está en
  `feat/phase-0-bootstrap` y el PR #1 apunta a `main`.
- La CI `quality` pasó en el PR: `npm ci`, lint, typecheck, pruebas y build.
- El equipo reporta haber validado en GoDaddy Node.js v22.23.4 y una conexión
  desde el hosting a MySQL de cPanel mediante `SELECT 1`. Se acepta como prueba
  previa de compatibilidad del proveedor; todavía no valida el despliegue ni
  las variables de esta aplicación.
- La API acepta el `PORT` asignado por GoDaddy, con `API_PORT` como alternativa
  para desarrollo local. La configuración de base de datos se inyecta por
  `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`.
- No se necesita Docker en producción ni para arrancar web y API localmente.
  Compose queda como opción para desarrollar con MySQL y Mailpit aislados.
  `MYSQL_IMAGE=mysql:8.0` es una opción local provisional y configurable; al
  ejecutar la prueba local, puede elegirse una versión compatible con cPanel.
- Mailpit es solo una bandeja local; el SMTP institucional no se configura en
  esta fase.
- `CORS_ORIGIN`, puertos y nivel de logs son configurables por entorno. El
  origen permitido de producción debe confirmarse antes de desplegar el frontend.
- El smoke test automatizado prueba la ruta HTTP y verifica que emite `SELECT 1`
  (con una conexión simulada). El equipo aún debe desplegar esta API en GoDaddy
  y comprobar la ruta contra el MySQL real de cPanel.

## Controles de `main` mientras el repo siga privado

La cuenta GitHub actual responde HTTP 403 al consultar la protección de ramas y
GitHub informa que el plan debe actualizarse o el repo hacerse público. No
cambiar la visibilidad para sortear el control.

Alternativas:

1. **Seguir en GitHub con controles técnicos completos (recomendación):** usar
   un plan que admita protección de ramas en repos privados. En cuenta personal,
   evaluar GitHub Pro; para administración centralizada de organización, GitHub
   Team. Entonces exigir PR hacia `main`, impedir push/force-push directo,
   requerir `quality` y configurar aprobación independiente si hay más de una
   persona revisora.
2. **Mantener GitHub Free privado como está:** ejecutar CI en cada PR, limitar
   acceso de escritura y hacer que una persona responsable revise y fusione
   manualmente. Esto conserva la privacidad, pero es un control de proceso: no
   impide técnicamente un push directo ni obliga al servidor a exigir CI verde.
   No equivale al criterio original de protección obligatoria.
3. **Migrar el repo canónico privado a GitLab Free:** GitLab documenta reglas de
   rama protegida en el nivel Free; se puede bloquear push directo y permitir
   merge por Merge Request. En Free, las aprobaciones de MR son opcionales y no
   bloquean la fusión; validar los checks obligatorios de pipeline para la
   configuración concreta antes de migrar. Requiere mover el repositorio y
   sustituir GitHub Actions por GitLab CI (o definir un espejo).

Fuentes oficiales consultadas:

- [Planes de GitHub](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)
- [Protección de ramas de GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Reglasets de GitHub: planes y alcance](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Ramas protegidas de GitLab](https://docs.gitlab.com/user/project/repository/branches/protected/)
- [Aprobaciones de Merge Request en GitLab](https://docs.gitlab.com/user/project/merge_requests/approvals/)

## Cierre pendiente de Fase 0

1. Elegir una alternativa de control para `main` y configurar/verificar el
   control técnico o documentar formalmente la excepción de proceso.
2. Desplegar esta API en GoDaddy Node.js Hosting, configurar las variables de
   entorno allí (sin guardar secretos en Git) y confirmar que
   `GET /api/health` devuelve HTTP 200 cuando la aplicación ejecuta `SELECT 1`
   contra MySQL de cPanel.
3. La prueba de Docker Compose local es opcional; no bloquea la fase si el equipo
   acepta desarrollar contra MySQL instalado o el entorno remoto autorizado.
