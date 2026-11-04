import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns healthy when SELECT 1 succeeds', async () => {
    const database = { query: vi.fn().mockResolvedValue([[{ 1: 1 }], []]) };
    const response = await request(createApp(database)).get('/api/health');

    expect(database.query).toHaveBeenCalledWith('SELECT 1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns service unavailable when the database query fails', async () => {
    const database = { query: vi.fn().mockRejectedValue(new Error('offline')) };
    const response = await request(createApp(database)).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Service unavailable' });
  });
});
