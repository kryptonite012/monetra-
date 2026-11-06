export type ErrorDetails = Record<string, unknown> | Array<Record<string, unknown>>;

/** An error that is safe to expose to API clients. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: ErrorDetails) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (entity = 'Resource') => new AppError(404, 'NOT_FOUND', `${entity} not found`);
export const conflict = (message: string, details?: ErrorDetails) => new AppError(409, 'CONFLICT', message, details);
export const unprocessable = (message: string, details?: ErrorDetails) =>
  new AppError(422, 'UNPROCESSABLE', message, details);
export const tooManyRequests = (message = 'Too many requests, please try again later') =>
  new AppError(429, 'RATE_LIMITED', message);
