import { Router } from 'express';
import adminRoutes from './modules/admin/admin.routes';
import auditRoutes from './modules/audit/audit.routes';
import authRoutes from './modules/auth/auth.routes';
import sessionRoutes from './modules/auth/sessions.routes';
import userRoutes from './modules/users/users.routes';
import { categories, merchants, rules } from './modules/categories/categories.routes';

/** Mounts every versioned API module under /api/v1. */
export function apiV1(): Router {
  const router = Router();
  router.use('/auth', authRoutes);
  router.use('/auth', sessionRoutes);
  router.use('/audit-logs', auditRoutes);
  router.use('/me', userRoutes);
  router.use('/categories', categories.router);
  router.use('/merchants', merchants.router);
  router.use('/categorization-rules', rules.router);
  router.use('/admin', adminRoutes);
  return router;
}
