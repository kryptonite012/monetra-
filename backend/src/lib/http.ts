import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import type { AuthUser, Role } from '../types/auth';
import { unauthorized } from './errors';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Schema = z.ZodType | undefined;
type Infer<T> = T extends z.ZodType ? z.output<T> : Record<string, never>;

export interface EndpointContext<B, Q, P> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  /** The authenticated user (throws if accessed on a public endpoint without a session). */
  readonly user: AuthUser;
}

export interface EndpointOptions<B extends Schema, Q extends Schema, P extends Schema> {
  summary: string;
  description?: string;
  body?: B;
  query?: Q;
  params?: P;
  /** HTTP status for successful JSON responses (default 200). */
  status?: number;
  /** Extra middleware executed before validation (e.g. file uploads, role checks). */
  middleware?: RequestHandler[];
  /** When true the handler writes the response itself (files, streams). */
  raw?: boolean;
  /** Endpoints require authentication unless marked public (secure by default). */
  public?: boolean;
  /** Restricts the endpoint to these roles. */
  roles?: Role[];
  handler: (ctx: EndpointContext<Infer<B>, Infer<Q>, Infer<P>>) => unknown | Promise<unknown>;
}

interface RegisteredRoute {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  status: number;
  public: boolean;
  roles?: Role[];
  raw: boolean;
}

const registry: RegisteredRoute[] = [];

/** Every route registered through {@link apiRouter}; used to build the OpenAPI document. */
export function registeredRoutes(): readonly RegisteredRoute[] {
  return registry;
}

/**
 * A thin, typed wrapper around an Express router. Each endpoint declares its
 * zod schemas once: they validate the request at runtime, type the handler at
 * compile time and feed the generated OpenAPI documentation.
 */
export function apiRouter(prefix: string, tag: string, baseMiddleware: RequestHandler[] = []) {
  const router = Router();
  if (baseMiddleware.length) router.use(...baseMiddleware);

  function add<B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
    method: Method,
    path: string,
    opts: EndpointOptions<B, Q, P>,
  ) {
    registry.push({
      method,
      path: `${prefix}${path === '/' ? '' : path}`,
      tag,
      summary: opts.summary,
      description: opts.description,
      body: opts.body,
      query: opts.query,
      params: opts.params,
      status: opts.status ?? 200,
      public: Boolean(opts.public),
      roles: opts.roles,
      raw: Boolean(opts.raw),
    });

    const handler: RequestHandler = async (req, res) => {
      const ctx: EndpointContext<Infer<B>, Infer<Q>, Infer<P>> = {
        req,
        res,
        body: (opts.body ? opts.body.parse(req.body ?? {}) : {}) as Infer<B>,
        query: (opts.query ? opts.query.parse(req.query) : {}) as Infer<Q>,
        params: (opts.params ? opts.params.parse(req.params) : {}) as Infer<P>,
        get user(): AuthUser {
          if (!req.user) throw unauthorized();
          return req.user;
        },
      };
      const result = await opts.handler(ctx);
      if (opts.raw || res.headersSent) return;
      const status = opts.status ?? 200;
      if (status === 204 || result === undefined) {
        res.status(status === 200 ? 204 : status).end();
        return;
      }
      res.status(status).json(isEnvelope(result) ? result : { data: result });
    };

    const guards: RequestHandler[] = opts.public ? [] : [requireAuth];
    if (!opts.public && opts.roles?.length) guards.push(requireRole(...opts.roles));
    router[method](path, ...guards, ...(opts.middleware ?? []), handler);
  }

  return {
    router,
    get: <B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
      path: string,
      opts: EndpointOptions<B, Q, P>,
    ) => add('get', path, opts),
    post: <B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
      path: string,
      opts: EndpointOptions<B, Q, P>,
    ) => add('post', path, opts),
    put: <B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
      path: string,
      opts: EndpointOptions<B, Q, P>,
    ) => add('put', path, opts),
    patch: <B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
      path: string,
      opts: EndpointOptions<B, Q, P>,
    ) => add('patch', path, opts),
    delete: <B extends Schema = undefined, Q extends Schema = undefined, P extends Schema = undefined>(
      path: string,
      opts: EndpointOptions<B, Q, P>,
    ) => add('delete', path, opts),
  };
}

/** Responses that already carry `{ data, meta }` are passed through unchanged. */
export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

export function envelope<T>(data: T, meta: Record<string, unknown>): Envelope<T> {
  return { data, meta };
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === 'object' && value !== null && 'data' in value && 'meta' in value && Object.keys(value).length === 2
  );
}

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

export const idParams = z.object({ id: z.uuid() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type Pagination = z.infer<typeof paginationQuery>;

export function pageMeta(p: Pagination, total: number) {
  return { page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** ISO calendar date (YYYY-MM-DD) that is also a real date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Invalid calendar date');

/** A month expressed as YYYY-MM. */
export const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month in YYYY-MM format');

export const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code')
  .default('INR');

/** Query-string boolean ("true"/"false"/"1"/"0"). */
export const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/** Trimmed text with a maximum length; empty strings become null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
