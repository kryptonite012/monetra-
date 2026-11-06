import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'CONFLICT', message: 'A record with these details already exists' },
  '23503': { status: 409, code: 'REFERENCE_ERROR', message: 'The record references, or is referenced by, other data' },
  '23514': { status: 422, code: 'CONSTRAINT_VIOLATION', message: 'The data violates a business rule' },
  '23502': { status: 422, code: 'CONSTRAINT_VIOLATION', message: 'A required value is missing' },
  '22P02': { status: 400, code: 'BAD_REQUEST', message: 'Invalid identifier or value format' },
  '22003': { status: 422, code: 'CONSTRAINT_VIOLATION', message: 'A numeric value is out of range' },
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, requestId: req.id },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const requestId = req.id;

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }

  const anyErr = err as PgError & { type?: string; status?: number; field?: string };

  if (anyErr.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body', requestId } });
    return;
  }
  if (anyErr.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId } });
    return;
  }
  if (anyErr.name === 'MulterError') {
    const status = anyErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: { code: 'UPLOAD_REJECTED', message: anyErr.message, requestId } });
    return;
  }
  // Raised by database triggers protecting the immutable ledger (SQLSTATE P0001).
  if (anyErr.code === 'P0001') {
    res.status(409).json({ error: { code: 'INTEGRITY_RULE', message: anyErr.message, requestId } });
    return;
  }
  if (anyErr.code && PG_ERRORS[anyErr.code]) {
    const mapped = PG_ERRORS[anyErr.code];
    logger.warn({ err: { code: anyErr.code, constraint: anyErr.constraint, table: anyErr.table }, requestId }, 'database constraint');
    res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        details: anyErr.constraint ? { constraint: anyErr.constraint } : undefined,
        requestId,
      },
    });
    return;
  }

  logger.error({ err, requestId }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong. Please try again.' : String(anyErr.message ?? err),
      requestId,
    },
  });
};
