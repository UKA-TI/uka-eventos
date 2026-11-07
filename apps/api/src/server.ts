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

try {
  await import('./run-server.js');
} catch (error) {
  const problem = describe(error);
  const line = `EVENTOS UKA no pudo arrancar: ${problem}`;
  console.log(line);
  console.error(line);
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  createServer((_request, response) => {
    response.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ status: 'error', problem }));
  }).listen(port);
}
