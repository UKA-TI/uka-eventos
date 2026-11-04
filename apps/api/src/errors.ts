import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: 'Revisa los datos capturados.',
        details: error.issues.map(({ path, message }) => ({
          path: path.join('.'),
          message,
        })),
      });
      return;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      response
        .status(409)
        .json({ error: 'Ya existe un registro con ese mismo valor.' });
      return;
    }

    if (error instanceof AppError && error.statusCode < 500) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    logger.error({ err: error }, 'Request failed');
    if (error instanceof AppError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    response.status(500).json({ error: 'Internal server error' });
  };
}
