// Arranque protegido. Si la configuración o el inicio fallan, la app no se cierra en
// silencio: escribe el motivo en el registro y lo responde en cualquier dirección
// (por ejemplo /api/health), para diagnosticar hospedajes que no muestran errores.
// Nunca incluye valores de las variables, solo sus nombres.
import { createServer } from 'node:http';

type Issue = { path?: PropertyKey[]; code?: string };

const issueText: Record<string, string> = {
  too_small: 'es demasiado corta',
  invalid_format: 'no tiene el formato correcto',
  invalid_type: 'falta o no es válida',
  invalid_value: 'tiene un valor no permitido',
  custom: 'no es válida',
};

function describe(error: unknown): string {
  const issues = (error as { issues?: Issue[] } | null)?.issues;
  if (Array.isArray(issues)) {
    return issues
      .map((issue) => {
        const name =
          (issue.path ?? []).map(String).join('.') || 'configuración';
        return `${name} ${issueText[issue.code ?? ''] ?? 'no es válida'}`;
      })
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

const expected = [
  'NODE_ENV',
  'SESSION_SECRET',
  'PASS_TOKEN_SECRET',
  'PUBLIC_BASE_URL',
  'CORS_ORIGIN',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'BOOTSTRAP_ADMIN_EMAIL',
  'MAIL_FROM',
  'MAIL_CLIENT_ID',
  'MAIL_CLIENT_SECRET',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DATABASE_URL',
  'DEV_LOGIN_ENABLED',
];

// Qué recibe la app de cada variable, sin mostrar valores: "ok", "vacía" o "falta".
// También avisa de nombres casi iguales (espacios o minúsculas), un error común al
// capturarlas a mano.
function variables() {
  const status = Object.fromEntries(
    expected.map((name) => {
      const value = process.env[name];
      if (value === undefined) return [name, 'falta'];
      return [name, value.trim() === '' ? 'vacía' : 'ok'];
    }),
  );
  const lookalikes = Object.keys(process.env).filter(
    (name) =>
      !expected.includes(name) &&
      expected.includes(name.trim().toUpperCase().replace(/[\s-]/g, '_')),
  );
  return { status, lookalikes: lookalikes.map((name) => JSON.stringify(name)) };
}

try {
  await import('./run-server.js');
} catch (error) {
  const problem = describe(error);
  const received = variables();
  const line = `EVENTOS UKA no pudo arrancar: ${problem}`;
  console.log(line, JSON.stringify(received));
  console.error(line);
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  createServer((_request, response) => {
    response.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(
      JSON.stringify(
        { status: 'error', problem, variables: received },
        null,
        2,
      ),
    );
  }).listen(port);
}
