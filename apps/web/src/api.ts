import { z } from 'zod';

export async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const result = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      result.success
        ? result.data.error
        : `El servidor respondió con un error (HTTP ${response.status}).`,
    );
  }
  // Una respuesta correcta puede venir vacía, como el 202 de "en cola": no es un error.
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

export function jsonRequest(
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  csrfToken: string,
): RequestInit {
  return {
    method,
    headers: { 'X-CSRF-Token': csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
