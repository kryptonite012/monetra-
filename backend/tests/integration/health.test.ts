import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

describe('GET /health', () => {
  it('reports service status', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('error handling', () => {
  it('returns a JSON 404 with a request id for unknown routes', async () => {
    const res = await request(createApp()).get('/nope').set('X-Request-Id', 'test-request-0001');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe('test-request-0001');
    expect(res.headers['x-request-id']).toBe('test-request-0001');
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const res = await request(createApp()).post('/health').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
