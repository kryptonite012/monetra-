import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { todayIn } from '../../lib/dates';
import { badRequest, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams, isoDate, optionalText } from '../../lib/http';
import { dec, moneySchema, nonNegativeMoney, positiveMoney, rateSchema } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { audit } from '../audit/audit.service';
import { categoryBySlug } from '../categories/categories.service';
import { postTransfer } from '../transactions/ledger.service';
import { evaluateGoalProgress, goalDetails, listGoals } from './goals.service';

const r = apiRouter('/goals', 'Savings goals');

const GOAL_TYPES = ['emergency', 'education', 'vehicle', 'house', 'vacation', 'retirement', 'wedding', 'gadget', 'custom'] as const;

const fields = z.object({
  name: z.string().trim().min(2).max(80),
  goalType: z.enum(GOAL_TYPES),
  targetAmount: positiveMoney,
  targetDate: isoDate.nullish(),
  monthlyContribution: nonNegativeMoney.nullish(),
  expectedReturnRate: rateSchema,
  linkedAccountId: z.uuid().nullish(),
  priority: z.number().int().min(1).max(5),
  status: z.enum(['active', 'paused', 'cancelled']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  notes: optionalText(1000),
});

function toRow(v: Partial<z.infer<typeof fields>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      goal_type: v.goalType,
      target_amount: v.targetAmount,
      target_date: v.targetDate,
      monthly_contribution: v.monthlyContribution,
      expected_return_rate: v.expectedReturnRate,
      linked_account_id: v.linkedAccountId,
      priority: v.priority,
      status: v.status,
      color: v.color,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

r.get('/', {
  summary: 'List savings goals with progress and estimated completion',
  query: z.object({ status: z.enum(['active', 'achieved', 'paused', 'cancelled']).optional() }),
  handler: ({ user, query }) => listGoals(user.id, query.status),
});

r.post('/', {
  summary: 'Create a savings goal',
  status: 201,
  body: fields.extend({ expectedReturnRate: rateSchema.default('0'), priority: fields.shape.priority.default(3), status: fields.shape.status.default('active'), initialAmount: positiveMoney.optional() }),
  handler: async ({ user, body, req }) => {
    await requireOwnedRef('accounts', body.linkedAccountId, user.id, 'linkedAccountId');
    if (body.targetDate && body.targetDate <= todayIn()) throw unprocessable('Target date must be in the future', { field: 'targetDate' });
    const { initialAmount, ...rest } = body;
    const [goal] = await db('savings_goals').insert({ user_id: user.id, ...toRow(rest) }).returning('id');
    if (initialAmount) {
      await db('goal_contributions').insert({ user_id: user.id, goal_id: goal.id, amount: initialAmount, contributed_on: todayIn(), note: 'Opening amount' });
      await evaluateGoalProgress(user.id, goal.id, 0);
    }
    await audit({ action: 'goal.created', req, entityType: 'goal', entityId: goal.id });
    return goalDetails(user.id, goal.id);
  },
});

r.get('/:id', {
  summary: 'Goal details with contribution history',
  params: idParams,
  handler: ({ user, params }) => goalDetails(user.id, params.id),
});

r.patch('/:id', {
  summary: 'Update a goal',
  params: idParams,
  body: fields.partial(),
  handler: async ({ user, params, body }) => {
    await requireOwnedRef('accounts', body.linkedAccountId, user.id, 'linkedAccountId');
    const patch = toRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('savings_goals').where({ id: params.id, user_id: user.id }).update(patch).returning('id');
    if (!row) throw notFound('Goal');
    return goalDetails(user.id, params.id);
  },
});

r.delete('/:id', {
  summary: 'Delete a goal (ledger transfers made for it are kept)',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const deleted = await db('savings_goals').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Goal');
    await audit({ action: 'goal.deleted', req, entityType: 'goal', entityId: params.id });
    return undefined;
  },
});

r.post('/:id/contributions', {
  summary: 'Add money to (or withdraw from, with a negative amount) a goal',
  description: 'Optionally moves the money between two of your accounts, e.g. salary account → savings account.',
  status: 201,
  params: idParams,
  body: z.object({
    amount: moneySchema.refine((v) => !dec(v).isZero(), 'Amount cannot be zero'),
    contributedOn: isoDate.default(() => todayIn()),
    note: optionalText(300),
    fromAccountId: z.uuid().optional(),
    toAccountId: z.uuid().optional(),
  }),
  handler: async ({ user, params, body, req }) => {
    const before = await goalDetails(user.id, params.id);
    if (dec(body.amount).isNegative() && dec(before.savedAmount).plus(body.amount).isNegative()) {
      throw unprocessable('You cannot withdraw more than has been saved');
    }
    if (Boolean(body.fromAccountId) !== Boolean(body.toAccountId)) throw unprocessable('Provide both accounts to move money, or neither');
    await withTransaction(async (trx) => {
      let transferGroupId: string | null = null;
      if (body.fromAccountId && body.toAccountId) {
        const positive = dec(body.amount).isPositive();
        const transfer = await postTransfer(
          {
            userId: user.id,
            fromAccountId: positive ? body.fromAccountId : body.toAccountId,
            toAccountId: positive ? body.toAccountId : body.fromAccountId,
            amount: dec(body.amount).abs().toFixed(4),
            occurredOn: body.contributedOn,
            description: `${positive ? 'Saving for' : 'Withdrawal from'} ${before.name}`,
            categoryId: await categoryBySlug('transfer.savings', trx),
            kind: 'goal_contribution',
            metadata: { goalId: params.id },
          },
          trx,
        );
        transferGroupId = transfer.transferGroupId;
      }
      await trx('goal_contributions').insert({ user_id: user.id, goal_id: params.id, amount: body.amount, contributed_on: body.contributedOn, note: body.note ?? null, transfer_group_id: transferGroupId });
    });
    await evaluateGoalProgress(user.id, params.id, Number(before.completionPercent));
    await audit({ action: 'goal.contribution', req, entityType: 'goal', entityId: params.id, metadata: { amount: body.amount } });
    return goalDetails(user.id, params.id);
  },
});

r.delete('/:id/contributions/:contributionId', {
  summary: 'Remove a contribution record (does not move money back)',
  params: z.object({ id: z.uuid(), contributionId: z.uuid() }),
  handler: async ({ user, params }) => {
    const before = await goalDetails(user.id, params.id);
    const deleted = await db('goal_contributions').where({ id: params.contributionId, goal_id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Contribution');
    await evaluateGoalProgress(user.id, params.id, Number(before.completionPercent));
    return undefined;
  },
});

export default r.router;
