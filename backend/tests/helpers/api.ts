import request from 'supertest';
import { createApp } from '../../src/app';

export const app = createApp();
export const api = () => request(app);

let counter = 0;
export const STRONG_PASSWORD = 'Ledger#Mango2026';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  cookie: string;
  auth: { Authorization: string };
}

/** Registers a fresh user and returns its access token and refresh cookie. */
export async function createUser(overrides: Partial<{ email: string; fullName: string; phone: string }> = {}): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${Date.now()}${counter}@example.in`;
  const res = await api()
    .post('/api/v1/auth/register')
    .send({ email, password: STRONG_PASSWORD, fullName: overrides.fullName ?? 'Test User', phone: overrides.phone, acceptTerms: true });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  return {
    id: res.body.data.user.id,
    email,
    token: res.body.data.accessToken,
    cookie,
    auth: { Authorization: `Bearer ${res.body.data.accessToken}` },
  };
}

/** Fetches a CSRF token and returns the Cookie/header pair required by refresh and logout. */
export async function csrf(cookie = ''): Promise<{ Cookie: string; 'X-CSRF-Token': string }> {
  const res = await api().get('/api/v1/auth/csrf');
  const token = res.body.data.csrfToken as string;
  return { Cookie: [cookie, `monetra_csrf=${token}`].filter(Boolean).join('; '), 'X-CSRF-Token': token };
}

export function cookieValue(res: request.Response, name: string): string | undefined {
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const match = setCookie.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0].slice(name.length + 1);
}
