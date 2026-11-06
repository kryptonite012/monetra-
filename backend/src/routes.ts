import { Router } from 'express';
import adminRoutes from './modules/admin/admin.routes';
import authRoutes from './modules/auth/auth.routes';

/** Mounts every versioned API module under /api/v1. */
export function apiV1(): Router {
  const router = Router();
  router.use('/auth', authRoutes);
  router.use('/admin', adminRoutes);
  return router;
}
