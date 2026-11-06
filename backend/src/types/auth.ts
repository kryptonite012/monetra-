export type Role = 'user' | 'admin' | 'support';

/** The authenticated principal attached to each request by the auth middleware. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
