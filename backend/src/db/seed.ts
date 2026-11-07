/**
 * Demo data seed: npm run seed
 *
 * Creates (or recreates) a demo user with twelve months of realistic Indian
 * household finances so every screen has something to show. Everything is
 * written through the same services the API uses, so the data obeys all
 * ledger and validation rules. The data is clearly fictional.
 */
import { config, isProduction } from '../config/env';
import { addDays, addMonths, monthStart, monthsBetween, todayIn } from '../lib/dates';
import { hashPassword } from '../lib/crypto';
import { logger } from '../lib/logger';
import { categoryBySlug } from '../modules/categories/categories.service';
import { createExpense } from '../modules/expenses/expenses.service';
import { createIncome } from '../modules/income/income.service';
import { createLoan, payInstallment } from '../modules/loans/loans.service';
import { recordInvestmentTransaction } from '../modules/investments/investments.service';
import { snapshotNetWorth } from '../modules/networth/networth.service';
import { postTransfer } from '../modules/transactions/ledger.service';
import { runAllTasks } from '../jobs/tasks';
import { closeDb, db, withTransaction } from './knex';

export const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'demo@monetra.app';
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo#Monetra2026';

/** Small deterministic PRNG so every seed run produces the same story. */
function rng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rand = rng();
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];

async function resetDemoUser() {
  const existing = await db('users').where({ email: DEMO_EMAIL }).first('id');
  if (!existing) return;
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL monetra.allow_ledger_purge = 'on'`);
    await trx('users').where({ id: existing.id }).delete();
  });
}

export async function seedDemo(): Promise<{ userId: string; email: string }> {
  await resetDemoUser();
  const today = todayIn();
  const start = monthStart(addMonths(today, -11));

  const [user] = await db('users')
    .insert({ email: DEMO_EMAIL, password_hash: await hashPassword(DEMO_PASSWORD), email_verified_at: db.fn.now() })
    .returning(['id']);
  const userId: string = user.id;
  await db('user_profiles').insert({
    user_id: userId,
    full_name: 'Aarav Mehta',
    display_name: 'Aarav',
    occupation: 'Product designer',
    employment_type: 'salaried',
    city: 'Bengaluru',
    state: 'Karnataka',
    monthly_income_estimate: '145000',
    onboarding_completed: true,
    preferences: JSON.stringify({ theme: 'system', emailNotifications: { billDue: true, emiDue: true, budgetThreshold: true } }),
  });

  const account = async (row: Record<string, unknown>) => (await db('accounts').insert({ user_id: userId, opening_date: start, ...row }).returning('id'))[0].id as string;
  const salary = await account({ name: 'HDFC Salary', type: 'salary', institution_name: 'HDFC Bank', account_number_last4: '4821', ifsc: 'HDFC0000123', opening_balance: '85000', color: '#0f766e' });
  const savings = await account({ name: 'SBI Savings', type: 'savings', institution_name: 'State Bank of India', account_number_last4: '7710', opening_balance: '240000', color: '#4f46e5' });
  const cash = await account({ name: 'Cash in hand', type: 'cash', opening_balance: '6000' });
  const card = await account({ name: 'ICICI Amazon Pay Card', type: 'credit_card', institution_name: 'ICICI Bank', account_number_last4: '3006', opening_balance: '0', credit_limit: '250000', color: '#f97316' });

  const method = async (row: Record<string, unknown>) => (await db('payment_methods').insert({ user_id: userId, ...row }).returning('id'))[0].id as string;
  const gpay = await method({ type: 'upi', label: 'GPay', upi_vpa: 'aarav.mehta@okhdfcbank', upi_app: 'Google Pay', linked_account_id: salary, is_default: true });
  const debit = await method({ type: 'debit_card', label: 'HDFC Debit', card_network: 'rupay', card_last4: '9182', linked_account_id: salary });
  const credit = await method({ type: 'credit_card', label: 'ICICI Amazon Pay', card_network: 'visa', card_last4: '3006', linked_account_id: card });

  // ------------------------------------------------------------ 12 months
  for (let m = 0; m < 12; m++) {
    const month = addMonths(start, m);
    const last = m === 11;
    await withTransaction(async (trx) => {
      await createIncome(userId, { accountId: salary, sourceType: 'salary', grossAmount: '168000', taxDeducted: '19500', otherDeductions: '3600', occurredOn: addDays(month, 0), payerName: 'Nimbus Design Labs', periodMonth: month.slice(0, 7) }, trx);
      if (m % 3 === 2) await createIncome(userId, { accountId: savings, sourceType: 'interest', grossAmount: String(between(1800, 2400)), occurredOn: addDays(month, 27), payerName: 'SBI' }, trx);
      if (m % 4 === 1) await createIncome(userId, { accountId: salary, sourceType: 'freelance', grossAmount: String(between(18000, 42000)), taxDeducted: '2000', occurredOn: addDays(month, 15), payerName: pick(['Studio Kite', 'Farmlink', 'Orbit Retail']) }, trx);

      const spend = async (day: number, amount: number, description: string, merchant: string, slug: string, opts: { account?: string; method?: string | null } = {}) => {
        const occurredOn = addDays(month, day);
        if (occurredOn > today) return;
        await createExpense(userId, { accountId: opts.account ?? salary, amount: String(amount), occurredOn, description, merchantName: merchant, categoryId: await categoryBySlug(slug, trx), paymentMethodId: opts.method === undefined ? gpay : opts.method, allowDuplicate: true }, trx);
      };
      await spend(2, 32000, 'House rent', 'Prestige Landlord', 'housing.rent', { method: debit });
      await spend(3, 3500, 'Society maintenance', 'Green Meadows RWA', 'housing.maintenance');
      await spend(5, between(1400, 2600), 'BESCOM electricity bill', 'BESCOM', 'utilities.electricity');
      await spend(6, 999, 'ACT Fibernet broadband', 'ACT Fibernet', 'utilities.internet');
      await spend(7, 649, 'Netflix', 'Netflix', 'entertainment.ott', { account: card, method: credit });
      await spend(8, 299, 'Jio postpaid', 'Jio', 'utilities.mobile');
      for (const d of [4, 11, 18, 25]) await spend(d, between(1800, 3800), 'Weekly groceries', pick(['BigBasket', 'DMart', 'Zepto', 'Blinkit']), 'food.groceries');
      for (let k = 0; k < between(5, 9); k++) await spend(between(1, 27), between(220, 780), 'Food delivery', pick(['Swiggy', 'Zomato']), 'food.delivery');
      for (let k = 0; k < 3; k++) await spend(between(1, 27), between(280, 520), 'Office commute', pick(['Uber', 'Rapido', 'Ola']), 'transport.cab');
      await spend(between(9, 14), between(2500, 3400), 'Petrol', pick(['HPCL', 'Indian Oil', 'Shell']), 'transport.fuel', { account: card, method: credit });
      await spend(between(12, 20), between(1200, 4800), pick(['Weekend dinner', 'Movie night', 'Concert tickets']), pick(['Toit', 'PVR', 'BookMyShow']), pick(['food.restaurants', 'entertainment.events']), { account: card, method: credit });
      await spend(between(15, 24), between(800, 6500), pick(['Clothes', 'Household items', 'Books']), pick(['Myntra', 'Amazon', 'Flipkart']), pick(['shopping.clothing', 'shopping.household', 'education.books']), { account: card, method: credit });
      if (m % 2 === 0) await spend(between(10, 20), between(450, 1800), 'Pharmacy', pick(['Apollo Pharmacy', '1mg']), 'health.medicines');
      if (m === 5) await spend(14, 38500, 'Goa trip flights & stay', 'MakeMyTrip', 'travel.holidays', { account: card, method: credit });
      if (m === 8) await spend(20, 24999, 'Annual health insurance', 'Star Health', 'health.insurance');
      const atmDay = addDays(month, 1);
      if (atmDay <= today) await postTransfer({ userId, fromAccountId: salary, toAccountId: cash, amount: '2000', occurredOn: atmDay, description: 'ATM cash withdrawal', categoryId: await categoryBySlug('transfer.cash_withdrawal', trx) }, trx);
      await spend(26, between(1200, 1900), 'Local market & household help', 'Local vendors', 'family.household_help', { account: cash, method: null });

      // Pay last month's card bill and save 25k every month.
      const payDay = addDays(month, 12);
      if (m > 0 && payDay <= today) {
        const { rows } = await trx.raw(`SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) AS due FROM transactions WHERE account_id = ? AND occurred_on < ?`, [card, month]);
        if (Number(rows[0].due) > 0) await postTransfer({ userId, fromAccountId: salary, toAccountId: card, amount: String(rows[0].due), occurredOn: payDay, description: 'ICICI card bill payment' }, trx);
      }
      const saveDay = addDays(month, 3);
      if (saveDay <= today && !last) await postTransfer({ userId, fromAccountId: salary, toAccountId: savings, amount: '25000', occurredOn: saveDay, description: 'Monthly savings', categoryId: await categoryBySlug('transfer.savings', trx) }, trx);
    });
  }

  // ------------------------------------------------------------- budgets
  const budgetCats: Array<[string, string, number]> = [
    ['food', '14000', 80],
    ['food.delivery', '4000', 80],
    ['transport', '6000', 85],
    ['shopping', '6000', 80],
    ['utilities', '4500', 90],
    ['entertainment', '3000', 80],
  ];
  for (const offset of [-2, -1, 0]) {
    const month = monthStart(addMonths(today, offset));
    const [b] = await db('budgets').insert({ user_id: userId, month, name: `Budget ${month.slice(0, 7)}`, savings_target: '40000' }).returning('id');
    for (const [slug, limit, pct] of budgetCats) {
      await db('budget_categories').insert({ user_id: userId, budget_id: b.id, category_id: await categoryBySlug(slug), limit_amount: limit, alert_threshold_pct: pct });
    }
  }

  // --------------------------------------------------------------- goals
  const goal = async (row: Record<string, unknown>, contributions: Array<[number, string]>) => {
    const [g] = await db('savings_goals').insert({ user_id: userId, ...row }).returning('id');
    for (const [monthsAgo, amount] of contributions) {
      await db('goal_contributions').insert({ user_id: userId, goal_id: g.id, amount, contributed_on: addDays(monthStart(addMonths(today, -monthsAgo)), 4) });
    }
  };
  await goal({ name: 'Emergency fund', goal_type: 'emergency', target_amount: '600000', monthly_contribution: '25000', linked_account_id: savings, priority: 1, expected_return_rate: '3' }, Array.from({ length: 11 }, (_, i) => [11 - i, '25000'] as [number, string]));
  await goal({ name: 'Japan holiday', goal_type: 'vacation', target_amount: '350000', target_date: addMonths(today, 14), monthly_contribution: '15000', priority: 2 }, [[6, '30000'], [4, '15000'], [2, '15000'], [1, '15000']]);
  await goal({ name: 'New laptop', goal_type: 'gadget', target_amount: '180000', target_date: addMonths(today, 4), monthly_contribution: '10000', priority: 3 }, [[3, '20000'], [1, '10000']]);

  // --------------------------------------------------------------- loans
  const carLoan = await createLoan(userId, { name: 'Car loan', loanType: 'vehicle', lender: 'HDFC Bank', principal: '650000', interestRate: '9.25', interestType: 'reducing', tenureMonths: 60, startDate: addMonths(start, -6), repaymentAccountId: salary, paidInstallments: 6 });
  const due = await db('loan_installments').where({ loan_id: carLoan, status: 'due' }).where('due_date', '<=', today).orderBy('installment_no');
  for (const inst of due) await payInstallment(userId, carLoan, inst.installmentNo, { accountId: salary, paidOn: inst.dueDate });
  // An older loan: every EMI that fell due before the seed date is marked as paid.
  const eduPaid = Math.min(84, monthsBetween('2022-08-01', today) + 1);
  await createLoan(userId, { name: 'Education loan', loanType: 'education', lender: 'SBI', principal: '400000', interestRate: '8.15', interestType: 'reducing', tenureMonths: 84, startDate: '2022-07-01', paidInstallments: eduPaid, repaymentAccountId: salary });

  // --------------------------------------------------------- investments
  const holding = async (row: Record<string, unknown>, buys: Array<{ monthsAgo: number; units?: string; price?: string; amount?: string }>, price?: string) => {
    const [inv] = await db('investments').insert({ user_id: userId, ...row }).returning('id');
    for (const b of buys) {
      await recordInvestmentTransaction(userId, inv.id, { type: 'buy', tradeDate: addDays(monthStart(addMonths(today, -b.monthsAgo)), 9), units: b.units, price: b.price, amount: b.amount });
    }
    if (price) await db('investments').where({ id: inv.id }).update({ current_price: price, price_source: 'manual', price_as_of: new Date() });
  };
  await holding({ instrument_type: 'mutual_fund', name: 'UTI Nifty 50 Index Fund - Direct Growth', scheme_code: '120716', risk_level: 'high' }, Array.from({ length: 10 }, (_, i) => ({ monthsAgo: 10 - i, units: '32.5', price: String(150 + i * 1.8) })), '171.40');
  await holding({ instrument_type: 'mutual_fund', name: 'Parag Parikh Flexi Cap - Direct Growth', scheme_code: '122639', risk_level: 'very_high' }, Array.from({ length: 8 }, (_, i) => ({ monthsAgo: 8 - i, units: '60', price: String(78 + i) })), '86.95');
  await holding({ instrument_type: 'stock', name: 'Infosys Ltd', symbol: 'INFY', exchange: 'NSE', isin: 'INE009A01021', risk_level: 'high' }, [{ monthsAgo: 9, units: '20', price: '1480' }, { monthsAgo: 3, units: '10', price: '1610' }], '1655.00');
  await holding({ instrument_type: 'fixed_deposit', name: 'SBI FD 2 years', interest_rate: '7.10', compounding_per_year: 4, start_date: addMonths(today, -8), maturity_date: addMonths(today, 16), risk_level: 'low' }, [{ monthsAgo: 8, amount: '200000' }]);
  await holding({ instrument_type: 'sovereign_gold_bond', name: 'SGB 2024 Series II', risk_level: 'moderate' }, [{ monthsAgo: 7, units: '10', price: '6200' }], '7350.00');

  // ---------------------------------------------- assets & liabilities
  await db('assets').insert([
    { user_id: userId, name: 'Honda City (2022)', asset_type: 'vehicle', purchase_value: '1250000', purchase_date: '2022-03-15', current_value: '820000', valuation_source: 'manual' },
    { user_id: userId, name: 'Family gold jewellery', asset_type: 'jewellery', current_value: '410000', valuation_source: 'appraisal' },
  ]);
  await db('liabilities').insert({ user_id: userId, name: 'Borrowed from Rohan for deposit', liability_type: 'personal_borrowing', counterparty: 'Rohan', original_amount: '60000', amount_outstanding: '35000', due_date: addMonths(today, 2) });

  // ------------------------------------------------ bills & subscriptions
  const nextDue = (day: number) => {
    const d = addDays(monthStart(today), day - 1);
    return d < today ? addMonths(d, 1) : d;
  };
  await db('bills').insert([
    { user_id: userId, name: 'Electricity', biller: 'BESCOM', bill_type: 'electricity', category_id: await categoryBySlug('utilities.electricity'), amount_type: 'variable', expected_amount: '2100', next_due_date: nextDue(5), default_account_id: salary, payment_method_id: gpay },
    { user_id: userId, name: 'Broadband', biller: 'ACT Fibernet', bill_type: 'internet', amount_type: 'fixed', expected_amount: '999', next_due_date: nextDue(6), default_account_id: salary, auto_pay: true },
    { user_id: userId, name: 'House rent', biller: 'Prestige Landlord', bill_type: 'rent', amount_type: 'fixed', expected_amount: '32000', next_due_date: nextDue(2), default_account_id: salary },
    { user_id: userId, name: 'Term insurance premium', biller: 'HDFC Life', bill_type: 'insurance', amount_type: 'fixed', expected_amount: '18600', frequency: 'yearly', next_due_date: addMonths(today, 3), default_account_id: salary },
  ]);
  await db('subscriptions').insert([
    { user_id: userId, name: 'Netflix', provider: 'Netflix', plan: 'Standard', amount: '649', next_renewal_date: nextDue(7), start_date: addMonths(today, -24), default_account_id: card, last_used_on: addDays(today, -2) },
    { user_id: userId, name: 'Spotify Premium', provider: 'Spotify', amount: '119', next_renewal_date: nextDue(14), start_date: addMonths(today, -18), default_account_id: card, last_used_on: addDays(today, -1) },
    { user_id: userId, name: 'Cult.fit Elite', provider: 'Cult.fit', amount: '1999', next_renewal_date: nextDue(20), start_date: addMonths(today, -10), default_account_id: card },
    { user_id: userId, name: 'Amazon Prime', provider: 'Amazon', amount: '1499', billing_cycle: 'yearly', next_renewal_date: addMonths(today, 5), start_date: addMonths(today, -7), default_account_id: card, last_used_on: addDays(today, -9) },
  ]);
  await db('recurring_rules').insert({
    user_id: userId,
    kind: 'income',
    name: 'Monthly salary',
    account_id: salary,
    amount: '145000',
    income_source: 'salary',
    description: 'Salary from Nimbus Design Labs',
    frequency: 'monthly',
    start_date: addMonths(monthStart(today), 1),
    next_run_on: addMonths(monthStart(today), 1),
    auto_post: false,
  });

  // ------------------------------------------- net worth history & alerts
  for (let m = 11; m >= 1; m--) await snapshotNetWorth(userId, addDays(monthStart(addMonths(today, -m + 1)), -1));
  await snapshotNetWorth(userId, today);
  await runAllTasks(today);
  return { userId, email: DEMO_EMAIL };
}

async function main() {
  if (isProduction && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refusing to seed demo data in production (set SEED_ALLOW_PRODUCTION=true to override).');
  }
  const started = Date.now();
  const { email } = await seedDemo();
  logger.info({ email, ms: Date.now() - started, database: config.DATABASE_URL.replace(/\/\/[^@]+@/, '//***@') }, 'demo data seeded');
  console.log(`\nDemo account ready:\n  email:    ${email}\n  password: ${DEMO_PASSWORD}\n`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
