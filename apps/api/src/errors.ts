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
        error: 'Invalid request',
        details: error.issues.map(({ path, message }) => ({
          path: path.join('.'),
          message,
        })),
      });
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
