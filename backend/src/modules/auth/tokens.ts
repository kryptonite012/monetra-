import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../../config/env';
import type { Role } from '../../types/auth';

const ISSUER = 'monetra-api';
const AUDIENCE = 'monetra-app';

export interface AccessClaims {
  sub: string;
  sid: string;
  role: Role;
  email: string;
}

export function signAccessToken(claims: AccessClaims): { token: string; expiresIn: number } {
  const token = jwt.sign({ sid: claims.sid, role: claims.role, email: claims.email, typ: 'access' }, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: claims.sub,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });
  const decoded = jwt.decode(token) as { exp: number; iat: number };
  return { token, expiresIn: decoded.exp - decoded.iat };
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as jwt.JwtPayload;
  if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('Invalid token type');
  }
  return { sub: payload.sub, sid: payload.sid, role: payload.role as Role, email: String(payload.email) };
}
