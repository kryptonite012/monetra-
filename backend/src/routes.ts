import { Router } from 'express';
import adminRoutes from './modules/admin/admin.routes';
import auditRoutes from './modules/audit/audit.routes';
import authRoutes from './modules/auth/auth.routes';
import sessionRoutes from './modules/auth/sessions.routes';
import userRoutes from './modules/users/users.routes';

/** Mounts every versioned API module under /api/v1. */
export function apiV1(): Router {
  const router = Router();
  router.use('/auth', authRoutes);
  router.use('/auth', sessionRoutes);
  router.use('/audit-logs', auditRoutes);
  router.use('/me', userRoutes);
  router.use('/admin', adminRoutes);
  return router;
}
