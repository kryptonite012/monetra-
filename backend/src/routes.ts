import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes';

/** Mounts every versioned API module under /api/v1. */
export function apiV1(): Router {
  const router = Router();
  router.use('/auth', authRoutes);
  return router;
}
