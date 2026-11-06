import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiRouter, envelope, idParams, isoDate, registeredRoutes } from '../../src/lib/http';
import { errorHandler } from '../../src/middleware/error-handler';

function buildApp() {
  const r = apiRouter('/things', 'Things');
  r.post('/', {
    summary: 'Create a thing',
    public: true,
    status: 201,
    body: z.object({ name: z.string().min(2), on: isoDate }),
    handler: ({ body }) => ({ ...body, created: true }),
  });
  r.get('/:id', {
    summary: 'Get a thing',
    public: true,
    params: idParams,
    handler: ({ params }) => envelope({ id: params.id }, { cached: false }),
  });
  r.delete('/:id', { summary: 'Delete', public: true, params: idParams, handler: () => undefined });
  r.get('/secret/area', { summary: 'Private', handler: () => ({ ok: true }) });
  const app = express();
  app.use(express.json());
  app.use('/things', r.router);
  app.use(errorHandler);
  return app;
}

describe('apiRouter', () => {
  const app = buildApp();

  it('validates and wraps JSON responses', async () => {
    const res = await request(app).post('/things').send({ name: 'Rent', on: '2026-02-28' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { name: 'Rent', on: '2026-02-28', created: true } });
  });

  it('returns structured validation errors', async () => {
    const res = await request(app).post('/things').send({ name: 'R', on: '2026-02-30' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['name', 'on']);
  });

  it('passes explicit envelopes through and validates params', async () => {
    const id = '7f5c6a4e-4a8b-4b7a-9f4e-2d4b1c3a9e10';
    const ok = await request(app).get(`/things/${id}`);
    expect(ok.body).toEqual({ data: { id }, meta: { cached: false } });
    const bad = await request(app).get('/things/not-a-uuid');
    expect(bad.status).toBe(422);
  });

  it('responds 204 when a handler returns nothing', async () => {
    const res = await request(app).delete('/things/7f5c6a4e-4a8b-4b7a-9f4e-2d4b1c3a9e10');
    expect(res.status).toBe(204);
  });

  it('requires authentication by default', async () => {
    const res = await request(app).get('/things/secret/area');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('records routes for API documentation', () => {
    const paths = registeredRoutes().map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('post /things');
    expect(paths).toContain('get /things/:id');
  });
});
