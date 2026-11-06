import type { Knex } from 'knex';
import { money, timestamps, updatedAtTrigger, uuidPk } from '../helpers';

/**
 * Income & expense records (rich metadata on top of ledger entries),
 * recurring schedules, receipts, expense splits and monthly budgets.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('recurring_rules', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('kind').notNullable();
    t.text('name').notNullable();
    t.uuid('account_id').notNullable().references('accounts.id').onDelete('CASCADE');
    money(t, 'amount').notNullable();
    t.uuid('category_id').references('transaction_categories.id').onDelete('SET NULL');
    t.uuid('payment_method_id').references('payment_methods.id').onDelete('SET NULL');
    t.text('income_source');
    t.text('merchant_name');
    t.text('description').notNullable();
    t.text('frequency').notNullable();
    t.smallint('interval_count').notNullable().defaultTo(1);
    t.date('start_date').notNullable();
    t.date('end_date');
    t.date('next_run_on').notNullable();
    t.date('last_run_on');
    t.boolean('auto_post').notNullable().defaultTo(true);
    t.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.index(['is_active', 'next_run_on']);
    t.index(['user_id']);
  });
  await knex.raw(`
    ALTER TABLE recurring_rules
      ADD CONSTRAINT recurring_rules_kind_check CHECK (kind IN ('income', 'expense')),
      ADD CONSTRAINT recurring_rules_amount_check CHECK (amount > 0),
      ADD CONSTRAINT recurring_rules_frequency_check CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
      ADD CONSTRAINT recurring_rules_interval_check CHECK (interval_count BETWEEN 1 AND 24),
      ADD CONSTRAINT recurring_rules_dates_check CHECK (end_date IS NULL OR end_date >= start_date);
  `);
  await updatedAtTrigger(knex, 'recurring_rules');

  await knex.schema.createTable('income_records', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('transaction_id').notNullable().unique().references('transactions.id');
    t.text('source_type').notNullable();
    t.text('payer_name');
    money(t, 'gross_amount').notNullable();
    money(t, 'tax_deducted').notNullable().defaultTo(0);
    money(t, 'other_deductions').notNullable().defaultTo(0);
    money(t, 'net_amount').notNullable();
    t.date('period_month');
    t.boolean('is_taxable').notNullable().defaultTo(true);
    t.uuid('recurring_rule_id').references('recurring_rules.id').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('deleted_at', { useTz: true });
    timestamps(knex, t);
    t.index(['user_id', 'source_type']);
  });
  await knex.raw(`
    ALTER TABLE income_records
      ADD CONSTRAINT income_records_source_check CHECK (source_type IN (
        'salary', 'business', 'freelance', 'rental', 'interest', 'dividend', 'capital_gains', 'pension', 'bonus', 'gift', 'refund', 'other'
      )),
      ADD CONSTRAINT income_records_amounts_check CHECK (
        gross_amount > 0 AND tax_deducted >= 0 AND other_deductions >= 0
        AND net_amount = gross_amount - tax_deducted - other_deductions AND net_amount > 0
      );
  `);
  await updatedAtTrigger(knex, 'income_records');

  await knex.schema.createTable('expense_records', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('transaction_id').notNullable().unique().references('transactions.id');
    money(t, 'gst_amount');
    t.boolean('is_tax_deductible').notNullable().defaultTo(false);
    t.text('tax_section');
    t.boolean('is_reimbursable').notNullable().defaultTo(false);
    t.boolean('is_split').notNullable().defaultTo(false);
    t.uuid('recurring_rule_id').references('recurring_rules.id').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('deleted_at', { useTz: true });
    timestamps(knex, t);
    t.index(['user_id']);
  });
  await knex.raw(`
    ALTER TABLE expense_records
      ADD CONSTRAINT expense_records_gst_check CHECK (gst_amount IS NULL OR gst_amount >= 0),
      ADD CONSTRAINT expense_records_section_check CHECK (tax_section IS NULL OR tax_section IN ('80C', '80D', '80E', '80G', '80GG', '80TTA', '24B', 'HRA', 'other'));
  `);
  await updatedAtTrigger(knex, 'expense_records');

  await knex.schema.createTable('expense_splits', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('expense_record_id').notNullable().references('expense_records.id').onDelete('CASCADE');
    t.text('participant_name').notNullable();
    t.text('participant_contact');
    money(t, 'share_amount').notNullable();
    t.boolean('is_settled').notNullable().defaultTo(false);
    t.date('settled_on');
    t.uuid('settlement_transaction_id').references('transactions.id');
    timestamps(knex, t);
    t.index(['expense_record_id']);
  });
  await knex.raw(`ALTER TABLE expense_splits ADD CONSTRAINT expense_splits_share_check CHECK (share_amount > 0)`);
  await updatedAtTrigger(knex, 'expense_splits');

  // Receipt files live outside the web root; only metadata is stored here.
  await knex.schema.createTable('receipts', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('expense_record_id').references('expense_records.id').onDelete('SET NULL');
    t.text('original_filename').notNullable();
    t.text('stored_filename').notNullable().unique();
    t.text('mime_type').notNullable();
    t.integer('size_bytes').notNullable();
    t.text('sha256').notNullable();
    t.timestamp('uploaded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });
  await knex.raw(`
    ALTER TABLE receipts
      ADD CONSTRAINT receipts_mime_check CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
      ADD CONSTRAINT receipts_size_check CHECK (size_bytes > 0 AND size_bytes <= 20971520);
  `);

  await knex.schema.createTable('budgets', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.date('month').notNullable();
    t.text('name').notNullable();
    money(t, 'total_limit');
    money(t, 'savings_target');
    money(t, 'expected_income');
    t.text('notes');
    timestamps(knex, t);
    t.unique(['user_id', 'month']);
  });
  await knex.raw(`
    ALTER TABLE budgets
      ADD CONSTRAINT budgets_month_first_day CHECK (EXTRACT(DAY FROM month) = 1),
      ADD CONSTRAINT budgets_amounts_check CHECK (
        (total_limit IS NULL OR total_limit > 0) AND (savings_target IS NULL OR savings_target >= 0) AND (expected_income IS NULL OR expected_income >= 0)
      );
  `);
  await updatedAtTrigger(knex, 'budgets');

  await knex.schema.createTable('budget_categories', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('budget_id').notNullable().references('budgets.id').onDelete('CASCADE');
    t.uuid('category_id').notNullable().references('transaction_categories.id').onDelete('CASCADE');
    money(t, 'limit_amount').notNullable();
    t.smallint('alert_threshold_pct').notNullable().defaultTo(80);
    timestamps(knex, t);
    t.unique(['budget_id', 'category_id']);
  });
  await knex.raw(`
    ALTER TABLE budget_categories
      ADD CONSTRAINT budget_categories_limit_check CHECK (limit_amount > 0),
      ADD CONSTRAINT budget_categories_threshold_check CHECK (alert_threshold_pct BETWEEN 1 AND 100);
  `);
  await updatedAtTrigger(knex, 'budget_categories');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('budget_categories');
  await knex.schema.dropTableIfExists('budgets');
  await knex.schema.dropTableIfExists('receipts');
  await knex.schema.dropTableIfExists('expense_splits');
  await knex.schema.dropTableIfExists('expense_records');
  await knex.schema.dropTableIfExists('income_records');
  await knex.schema.dropTableIfExists('recurring_rules');
}
