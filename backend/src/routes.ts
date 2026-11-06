import { Router } from 'express';
import adminRoutes from './modules/admin/admin.routes';
import auditRoutes from './modules/audit/audit.routes';
import authRoutes from './modules/auth/auth.routes';
import sessionRoutes from './modules/auth/sessions.routes';
import userRoutes from './modules/users/users.routes';
import { categories, merchants, rules } from './modules/categories/categories.routes';
import accountRoutes from './modules/accounts/accounts.routes';
import transactionRoutes from './modules/transactions/transactions.routes';
import upiRoutes from './modules/upi/upi.routes';
import incomeRoutes from './modules/income/income.routes';
import recurringRoutes from './modules/recurring/recurring.routes';
import paymentMethodRoutes from './modules/payment-methods/payment-methods.routes';

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
  router.use('/payment-methods', paymentMethodRoutes);
  router.use('/accounts', accountRoutes);
  router.use('/transactions', transactionRoutes);
  router.use('/upi', upiRoutes);
  router.use('/income', incomeRoutes);
  router.use('/recurring-rules', recurringRoutes);
  router.use('/admin', adminRoutes);
  return router;
}
