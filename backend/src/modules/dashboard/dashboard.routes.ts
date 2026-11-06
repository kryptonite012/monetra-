import { z } from 'zod';
import { cachedForUser } from '../../lib/cache';
import { apiRouter } from '../../lib/http';
import { cashflowSeries, dashboard, healthScore } from './dashboard.service';

const r = apiRouter('/dashboard', 'Dashboard');

r.get('/', {
  summary: 'Financial command centre: balances, cash flow, net worth, liabilities, bills, health score and charts',
  query: z.object({ period: z.enum(['month', 'quarter', 'year']).default('month') }),
  handler: ({ user, query }) => cachedForUser(user.id, `dashboard:${query.period}`, 60, () => dashboard(user.id, query.period)),
});

r.get('/cashflow', {
  summary: 'Monthly income, expenses and net cash flow',
  query: z.object({ months: z.coerce.number().int().min(1).max(60).default(12) }),
  handler: ({ user, query }) => cashflowSeries(user.id, query.months),
});

r.get('/health-score', {
  summary: 'Financial health score with component explanations',
  handler: ({ user }) => healthScore(user.id),
});

export default r.router;
