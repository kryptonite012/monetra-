import type { Knex } from 'knex';
import { money, timestamps, updatedAtTrigger, uuidPk } from '../helpers';

/**
 * Loans & EMI schedules, savings goals, investments, assets & liabilities,
 * bills & subscriptions, notifications, generated reports and net-worth
 * snapshots.
 */
export async function up(knex: Knex): Promise<void> {
  // ------------------------------------------------------------------ loans
  await knex.schema.createTable('loans', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('loan_type').notNullable();
    t.text('lender').notNullable();
    t.text('account_number_last4');
    money(t, 'principal').notNullable();
    t.decimal('interest_rate', 7, 4).notNullable();
    t.text('interest_type').notNullable().defaultTo('reducing');
    t.integer('tenure_months').notNullable();
    t.date('start_date').notNullable();
    t.date('first_emi_date').notNullable();
    money(t, 'emi_amount').notNullable();
    money(t, 'processing_fee').notNullable().defaultTo(0);
    t.uuid('repayment_account_id').references('accounts.id').onDelete('SET NULL');
    t.uuid('disbursement_transaction_id').references('transactions.id');
    t.text('status').notNullable().defaultTo('active');
    t.date('closed_on');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'status']);
  });
  await knex.raw(`
    ALTER TABLE loans
      ADD CONSTRAINT loans_type_check CHECK (loan_type IN ('personal', 'education', 'home', 'vehicle', 'gold', 'business', 'consumer_durable', 'credit_card_emi', 'other')),
      ADD CONSTRAINT loans_interest_type_check CHECK (interest_type IN ('reducing', 'flat')),
      ADD CONSTRAINT loans_status_check CHECK (status IN ('active', 'closed', 'foreclosed')),
      ADD CONSTRAINT loans_amounts_check CHECK (principal > 0 AND emi_amount > 0 AND processing_fee >= 0 AND interest_rate >= 0 AND interest_rate <= 60),
      ADD CONSTRAINT loans_tenure_check CHECK (tenure_months BETWEEN 1 AND 480),
      ADD CONSTRAINT loans_dates_check CHECK (first_emi_date >= start_date);
  `);
  await updatedAtTrigger(knex, 'loans');

  await knex.schema.createTable('loan_installments', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('loan_id').notNullable().references('loans.id').onDelete('CASCADE');
    t.integer('installment_no').notNullable();
    t.date('due_date').notNullable();
    money(t, 'opening_principal').notNullable();
    money(t, 'emi_amount').notNullable();
    money(t, 'principal_component').notNullable();
    money(t, 'interest_component').notNullable();
    money(t, 'closing_principal').notNullable();
    t.text('status').notNullable().defaultTo('due');
    money(t, 'paid_amount');
    t.date('paid_on');
    t.uuid('transaction_id').references('transactions.id');
    timestamps(knex, t);
    t.unique(['loan_id', 'installment_no']);
    t.index(['user_id', 'status', 'due_date']);
  });
  await knex.raw(`
    ALTER TABLE loan_installments
      ADD CONSTRAINT loan_installments_status_check CHECK (status IN ('due', 'paid', 'prepayment', 'cancelled')),
      ADD CONSTRAINT loan_installments_math_check CHECK (emi_amount = principal_component + interest_component AND closing_principal = opening_principal - principal_component);
  `);
  await updatedAtTrigger(knex, 'loan_installments');

  // ------------------------------------------------------------------ goals
  await knex.schema.createTable('savings_goals', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('goal_type').notNullable();
    money(t, 'target_amount').notNullable();
    t.date('target_date');
    money(t, 'monthly_contribution');
    t.decimal('expected_return_rate', 7, 4).notNullable().defaultTo(0);
    t.uuid('linked_account_id').references('accounts.id').onDelete('SET NULL');
    t.smallint('priority').notNullable().defaultTo(3);
    t.text('status').notNullable().defaultTo('active');
    t.timestamp('achieved_at', { useTz: true });
    t.text('color');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'status']);
  });
  await knex.raw(`
    ALTER TABLE savings_goals
      ADD CONSTRAINT savings_goals_type_check CHECK (goal_type IN ('emergency', 'education', 'vehicle', 'house', 'vacation', 'retirement', 'wedding', 'gadget', 'custom')),
      ADD CONSTRAINT savings_goals_status_check CHECK (status IN ('active', 'achieved', 'paused', 'cancelled')),
      ADD CONSTRAINT savings_goals_amount_check CHECK (target_amount > 0 AND (monthly_contribution IS NULL OR monthly_contribution >= 0)),
      ADD CONSTRAINT savings_goals_priority_check CHECK (priority BETWEEN 1 AND 5),
      ADD CONSTRAINT savings_goals_rate_check CHECK (expected_return_rate BETWEEN 0 AND 30);
  `);
  await updatedAtTrigger(knex, 'savings_goals');

  await knex.schema.createTable('goal_contributions', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('goal_id').notNullable().references('savings_goals.id').onDelete('CASCADE');
    money(t, 'amount').notNullable();
    t.date('contributed_on').notNullable();
    t.text('note');
    t.uuid('transfer_group_id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['goal_id', 'contributed_on']);
  });
  await knex.raw(`ALTER TABLE goal_contributions ADD CONSTRAINT goal_contributions_amount_check CHECK (amount <> 0)`);

  // ------------------------------------------------------------ investments
  await knex.schema.createTable('investments', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('instrument_type').notNullable();
    t.text('name').notNullable();
    t.text('symbol');
    t.text('isin');
    t.text('scheme_code');
    t.text('exchange');
    t.text('folio_or_account');
    t.decimal('units', 24, 8).notNullable().defaultTo(0);
    money(t, 'invested_amount').notNullable().defaultTo(0);
    money(t, 'realized_gain').notNullable().defaultTo(0);
    t.decimal('current_price', 19, 6);
    money(t, 'current_value_override');
    // Every valuation is labelled with where it came from.
    t.text('price_source').notNullable().defaultTo('manual');
    t.text('price_provider');
    t.timestamp('price_as_of', { useTz: true });
    t.decimal('interest_rate', 7, 4);
    t.smallint('compounding_per_year');
    t.date('start_date');
    t.date('maturity_date');
    money(t, 'maturity_amount');
    t.text('risk_level');
    t.text('status').notNullable().defaultTo('active');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'status']);
  });
  await knex.raw(`
    ALTER TABLE investments
      ADD CONSTRAINT investments_type_check CHECK (instrument_type IN (
        'stock', 'mutual_fund', 'etf', 'fixed_deposit', 'recurring_deposit', 'gold', 'sovereign_gold_bond', 'bond', 'ppf', 'epf', 'nps', 'crypto', 'real_estate_fund', 'other'
      )),
      ADD CONSTRAINT investments_price_source_check CHECK (price_source IN ('manual', 'live', 'delayed', 'simulated', 'calculated')),
      ADD CONSTRAINT investments_status_check CHECK (status IN ('active', 'closed', 'matured')),
      ADD CONSTRAINT investments_units_check CHECK (units >= 0),
      ADD CONSTRAINT investments_risk_check CHECK (risk_level IS NULL OR risk_level IN ('low', 'moderate', 'high', 'very_high')),
      ADD CONSTRAINT investments_isin_check CHECK (isin IS NULL OR isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$');
  `);
  await updatedAtTrigger(knex, 'investments');

  await knex.schema.createTable('investment_transactions', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('investment_id').notNullable().references('investments.id').onDelete('CASCADE');
    t.text('type').notNullable();
    t.date('trade_date').notNullable();
    t.decimal('units', 24, 8).notNullable().defaultTo(0);
    t.decimal('price', 19, 6).notNullable().defaultTo(0);
    money(t, 'amount').notNullable();
    money(t, 'fees').notNullable().defaultTo(0);
    money(t, 'realized_gain');
    t.uuid('cash_account_id').references('accounts.id').onDelete('SET NULL');
    t.uuid('transaction_id').references('transactions.id');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['investment_id', 'trade_date']);
  });
  await knex.raw(`
    ALTER TABLE investment_transactions
      ADD CONSTRAINT investment_transactions_type_check CHECK (type IN ('buy', 'sell', 'dividend', 'interest', 'bonus', 'split', 'fee')),
      ADD CONSTRAINT investment_transactions_amounts_check CHECK (units >= 0 AND price >= 0 AND amount >= 0 AND fees >= 0);
  `);

  // -------------------------------------------------- assets & liabilities
  await knex.schema.createTable('assets', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('asset_type').notNullable();
    money(t, 'purchase_value');
    t.date('purchase_date');
    money(t, 'current_value').notNullable();
    t.date('valuation_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    t.text('valuation_source').notNullable().defaultTo('manual');
    t.decimal('annual_change_rate', 7, 4);
    t.boolean('include_in_net_worth').notNullable().defaultTo(true);
    t.uuid('linked_loan_id').references('loans.id').onDelete('SET NULL');
    t.date('disposed_on');
    money(t, 'disposal_value');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id']);
  });
  await knex.raw(`
    ALTER TABLE assets
      ADD CONSTRAINT assets_type_check CHECK (asset_type IN ('real_estate', 'land', 'vehicle', 'gold', 'jewellery', 'business', 'collectible', 'electronics', 'receivable', 'other')),
      ADD CONSTRAINT assets_valuation_source_check CHECK (valuation_source IN ('manual', 'appraisal', 'calculated')),
      ADD CONSTRAINT assets_values_check CHECK (current_value >= 0 AND (purchase_value IS NULL OR purchase_value >= 0));
  `);
  await updatedAtTrigger(knex, 'assets');

  await knex.schema.createTable('liabilities', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('liability_type').notNullable();
    t.text('counterparty');
    money(t, 'original_amount');
    money(t, 'amount_outstanding').notNullable();
    t.decimal('interest_rate', 7, 4);
    t.date('due_date');
    t.text('status').notNullable().defaultTo('open');
    t.date('settled_on');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'status']);
  });
  await knex.raw(`
    ALTER TABLE liabilities
      ADD CONSTRAINT liabilities_type_check CHECK (liability_type IN ('personal_borrowing', 'family_loan', 'tax_due', 'payable', 'security_deposit', 'bnpl', 'other')),
      ADD CONSTRAINT liabilities_status_check CHECK (status IN ('open', 'settled')),
      ADD CONSTRAINT liabilities_amount_check CHECK (amount_outstanding >= 0);
  `);
  await updatedAtTrigger(knex, 'liabilities');

  // ------------------------------------------------- bills & subscriptions
  await knex.schema.createTable('bills', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('biller');
    t.text('bill_type').notNullable();
    t.uuid('category_id').references('transaction_categories.id').onDelete('SET NULL');
    t.text('consumer_number');
    t.text('amount_type').notNullable().defaultTo('variable');
    money(t, 'expected_amount');
    t.text('frequency').notNullable().defaultTo('monthly');
    t.date('next_due_date').notNullable();
    t.smallint('reminder_days_before').notNullable().defaultTo(3);
    t.boolean('auto_pay').notNullable().defaultTo(false);
    t.uuid('default_account_id').references('accounts.id').onDelete('SET NULL');
    t.uuid('payment_method_id').references('payment_methods.id').onDelete('SET NULL');
    t.text('status').notNullable().defaultTo('active');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'status', 'next_due_date']);
  });
  await knex.raw(`
    ALTER TABLE bills
      ADD CONSTRAINT bills_type_check CHECK (bill_type IN ('electricity', 'water', 'gas', 'internet', 'mobile', 'dth', 'rent', 'insurance', 'maintenance', 'education', 'credit_card', 'tax', 'other')),
      ADD CONSTRAINT bills_amount_type_check CHECK (amount_type IN ('fixed', 'variable')),
      ADD CONSTRAINT bills_frequency_check CHECK (frequency IN ('monthly', 'bimonthly', 'quarterly', 'half_yearly', 'yearly')),
      ADD CONSTRAINT bills_status_check CHECK (status IN ('active', 'paused', 'cancelled')),
      ADD CONSTRAINT bills_reminder_check CHECK (reminder_days_before BETWEEN 0 AND 30),
      ADD CONSTRAINT bills_expected_check CHECK (expected_amount IS NULL OR expected_amount > 0);
  `);
  await updatedAtTrigger(knex, 'bills');

  await knex.schema.createTable('subscriptions', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('provider');
    t.text('plan');
    money(t, 'amount').notNullable();
    t.text('billing_cycle').notNullable().defaultTo('monthly');
    t.date('start_date');
    t.date('next_renewal_date').notNullable();
    t.uuid('category_id').references('transaction_categories.id').onDelete('SET NULL');
    t.uuid('default_account_id').references('accounts.id').onDelete('SET NULL');
    t.uuid('payment_method_id').references('payment_methods.id').onDelete('SET NULL');
    t.boolean('auto_renew').notNullable().defaultTo(true);
    t.smallint('reminder_days_before').notNullable().defaultTo(3);
    t.date('last_used_on');
    t.text('status').notNullable().defaultTo('active');
    t.date('cancelled_on');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'status', 'next_renewal_date']);
  });
  await knex.raw(`
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_cycle_check CHECK (billing_cycle IN ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')),
      ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('active', 'paused', 'cancelled')),
      ADD CONSTRAINT subscriptions_amount_check CHECK (amount > 0),
      ADD CONSTRAINT subscriptions_reminder_check CHECK (reminder_days_before BETWEEN 0 AND 30);
  `);
  await updatedAtTrigger(knex, 'subscriptions');

  await knex.schema.createTable('bill_payments', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('bill_id').references('bills.id').onDelete('CASCADE');
    t.uuid('subscription_id').references('subscriptions.id').onDelete('CASCADE');
    money(t, 'amount').notNullable();
    t.date('paid_on').notNullable();
    t.date('period_due_date');
    t.uuid('transaction_id').references('transactions.id');
    t.text('note');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'paid_on']);
  });
  await knex.raw(`
    ALTER TABLE bill_payments
      ADD CONSTRAINT bill_payments_target_check CHECK ((bill_id IS NULL) <> (subscription_id IS NULL)),
      ADD CONSTRAINT bill_payments_amount_check CHECK (amount > 0);
  `);

  // --------------------------------------------------------- notifications
  await knex.schema.createTable('notifications', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('type').notNullable();
    t.text('severity').notNullable().defaultTo('info');
    t.text('title').notNullable();
    t.text('body').notNullable();
    t.text('action_url');
    t.jsonb('data').notNullable().defaultTo('{}');
    t.text('dedupe_key');
    t.timestamp('read_at', { useTz: true });
    t.timestamp('emailed_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'read_at', 'created_at']);
    t.unique(['user_id', 'dedupe_key']);
  });
  await knex.raw(`
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'unusual_spending', 'budget_threshold', 'emi_due', 'bill_due', 'subscription_renewal', 'goal_milestone',
        'account_activity', 'security_alert', 'recurring_reminder', 'report_ready', 'system'
      )),
      ADD CONSTRAINT notifications_severity_check CHECK (severity IN ('info', 'success', 'warning', 'critical'));
  `);

  // ------------------------------------------------------------- reports
  await knex.schema.createTable('financial_reports', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('report_type').notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.text('format').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.text('title').notNullable();
    t.text('stored_filename');
    t.integer('size_bytes');
    t.jsonb('parameters').notNullable().defaultTo('{}');
    t.text('error');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('completed_at', { useTz: true });
    t.index(['user_id', 'created_at']);
  });
  await knex.raw(`
    ALTER TABLE financial_reports
      ADD CONSTRAINT financial_reports_type_check CHECK (report_type IN (
        'monthly_statement', 'annual_report', 'income_expense', 'account_statement', 'tax_summary', 'loan_statement', 'investment_report', 'net_worth'
      )),
      ADD CONSTRAINT financial_reports_format_check CHECK (format IN ('pdf', 'xlsx', 'csv')),
      ADD CONSTRAINT financial_reports_status_check CHECK (status IN ('pending', 'ready', 'failed')),
      ADD CONSTRAINT financial_reports_period_check CHECK (period_end >= period_start);
  `);

  await knex.schema.createTable('net_worth_snapshots', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.date('snapshot_date').notNullable();
    money(t, 'total_assets').notNullable();
    money(t, 'total_liabilities').notNullable();
    money(t, 'net_worth').notNullable();
    t.jsonb('breakdown').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'snapshot_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'net_worth_snapshots', 'financial_reports', 'notifications', 'bill_payments', 'subscriptions', 'bills', 'liabilities', 'assets',
    'investment_transactions', 'investments', 'goal_contributions', 'savings_goals', 'loan_installments', 'loans',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
