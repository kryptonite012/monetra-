import { z } from 'zod';
import { registeredRoutes } from '../lib/http';

type JsonSchema = Record<string, unknown>;

/**
 * Dynamic defaults such as "today" are evaluated when the schema is converted;
 * describe them instead so the published spec does not change every day.
 */
function stabiliseDefaults(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(stabiliseDefaults);
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.default === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.default)) {
    delete obj.default;
    obj.description = obj.description ?? 'Defaults to today (Asia/Kolkata)';
  }
  Object.values(obj).forEach(stabiliseDefaults);
}

function toSchema(schema: z.ZodType): JsonSchema {
  try {
    const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' }) as JsonSchema;
    delete out.$schema;
    stabiliseDefaults(out);
    return out;
  } catch {
    return { type: 'object' };
  }
}

/** Turns a zod object schema into OpenAPI query/path parameters. */
function parameters(schema: z.ZodType | undefined, location: 'query' | 'path') {
  if (!schema) return [];
  const json = toSchema(schema) as { properties?: Record<string, JsonSchema>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' || (json.required ?? []).includes(name),
    schema: s,
    description: typeof s.description === 'string' ? s.description : undefined,
  }));
}

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } },
      required: ['code', 'message'],
    },
  },
};

/** Builds the OpenAPI 3.1 document from every route registered through apiRouter(). */
export function buildOpenApiDocument(serverUrl = '/api/v1') {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();
  for (const route of registeredRoutes()) {
    tags.add(route.tag);
    const path = route.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      tags: [route.tag],
      summary: route.summary,
      description: route.description,
      operationId: `${route.method}${path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      parameters: [...parameters(route.params, 'path'), ...parameters(route.query, 'query')],
      responses: {
        [String(route.status)]: { description: route.status === 204 ? 'No content' : 'Success' },
        ...(route.body || route.query || route.params ? { 422: { description: 'Validation error', content: { 'application/json': { schema: errorSchema } } } } : {}),
        ...(route.public ? {} : { 401: { description: 'Missing or invalid access token', content: { 'application/json': { schema: errorSchema } } } }),
        ...(route.roles ? { 403: { description: `Requires role: ${route.roles.join(' or ')}` } } : {}),
      },
      security: route.public ? [] : [{ bearerAuth: [] }],
    };
    if (route.body) {
      op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(route.body) } } };
    }
    if (route.raw) op['x-response'] = 'binary or custom response';
    paths[path] = { ...(paths[path] ?? {}), [route.method]: op };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Monetra API',
      version: '1.0.0',
      description:
        'REST API for PROJECT MONETRA. Authenticate with a Bearer access token from /auth/login. Monetary amounts are decimal strings (never floats). ' +
        'Refresh tokens live in an httpOnly cookie; /auth/refresh and /auth/logout also require the X-CSRF-Token header obtained from /auth/csrf.',
      license: { name: 'MIT' },
    },
    servers: [{ url: serverUrl }],
    tags: [...tags].sort().map((name) => ({ name })),
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Error: errorSchema },
    },
    paths: Object.fromEntries(Object.entries(paths).map(([p, ops]) => [p.replace(/^/, ''), ops])),
  };
}
