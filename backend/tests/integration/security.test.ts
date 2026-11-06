import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

describe('security middleware', () => {
  const app = createApp();

  it('sets hardened headers and disables caching of API responses', async () => {
    const res = await request(app).get('/api/v1/auth/csrf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured origins only', async () => {
    const ok = await request(app).options('/api/v1/auth/login').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).options('/api/v1/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits credential endpoints', async () => {
    const limited = createApp({ rateLimit: { authMax: 3, apiMax: 1000 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(limited).post('/api/v1/auth/login').send({ email: 'rl@example.in', password: 'x' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
