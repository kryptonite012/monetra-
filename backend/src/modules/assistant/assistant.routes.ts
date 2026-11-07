import { z } from 'zod';
import { apiRouter } from '../../lib/http';
import { detectAnomalies } from './anomaly';
import { expenditureForecast, FORECAST_DISCLAIMER, generateInsights, savingsForecast } from './insights.service';
import { addDays, todayIn } from '../../lib/dates';

const r = apiRouter('/assistant', 'AI assistant');

r.get('/insights', {
  summary: 'Personalised insights: spending changes, anomalies, unused subscriptions, budget overruns and forecasts',
  handler: async ({ user }) => ({ insights: await generateInsights(user.id), generatedAt: new Date().toISOString(), engine: 'monetra-rules-v1' }),
});

r.get('/forecast', {
  summary: 'Expenditure and savings forecasts with stated assumptions',
  query: z.object({ months: z.coerce.number().int().min(1).max(24).default(6), annualReturn: z.coerce.number().min(0).max(20).default(0) }),
  handler: async ({ user, query }) => ({
    expenditure: await expenditureForecast(user.id, Math.min(query.months, 6)),
    savings: await savingsForecast(user.id, query.months, query.annualReturn),
    disclaimer: FORECAST_DISCLAIMER,
  }),
});

r.get('/anomalies', {
  summary: 'Unusually large transactions in the last N days',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
  handler: async ({ user, query }) => detectAnomalies(user.id, addDays(todayIn(), -query.days), todayIn()),
});

export default r.router;
