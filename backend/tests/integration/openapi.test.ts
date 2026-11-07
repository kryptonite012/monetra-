import { describe, expect, it } from 'vitest';
import { api } from '../helpers/api';

describe('API documentation', () => {
  it('publishes an OpenAPI document covering every module', async () => {
    const res = await api().get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const paths = Object.keys(res.body.paths);
    for (const p of ['/auth/login', '/accounts/{id}', '/transactions', '/expenses', '/budgets', '/loans/{id}/prepay', '/investments/portfolio', '/reports', '/assistant/ask']) {
      expect(paths).toContain(p);
    }
    const login = res.body.paths['/auth/login'].post;
    expect(login.security).toEqual([]);
    expect(login.requestBody.content['application/json'].schema.properties.email).toBeTruthy();
    expect(res.body.paths['/accounts'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(res.body.paths['/transactions'].get.parameters.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['from', 'to', 'search', 'page']));
  });

  it('serves Swagger UI', async () => {
    const res = await api().get('/api/docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
