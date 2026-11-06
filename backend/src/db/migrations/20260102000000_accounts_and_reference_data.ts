import type { Knex } from 'knex';
import { money, timestamps, updatedAtTrigger, uuidPk } from '../helpers';

/**
 * Money containers and reference data: accounts (bank, cash, wallet, card),
 * balance snapshots for reconciliation, categories, merchants,
 * auto-categorisation rules and payment methods.
 */

interface CategorySeed {
  slug: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  icon: string;
  color: string;
  children?: Array<[slug: string, name: string]>;
}

export const SYSTEM_CATEGORIES: CategorySeed[] = [
  { slug: 'food', name: 'Food & Dining', kind: 'expense', icon: 'utensils', color: '#f97316', children: [['food.groceries', 'Groceries'], ['food.restaurants', 'Restaurants'], ['food.delivery', 'Food Delivery'], ['food.cafes', 'Cafes & Snacks']] },
  { slug: 'housing', name: 'Housing', kind: 'expense', icon: 'home', color: '#8b5cf6', children: [['housing.rent', 'Rent'], ['housing.maintenance', 'Society Maintenance'], ['housing.repairs', 'Repairs & Services'], ['housing.furnishing', 'Furnishing']] },
  { slug: 'utilities', name: 'Bills & Utilities', kind: 'expense', icon: 'zap', color: '#eab308', children: [['utilities.electricity', 'Electricity'], ['utilities.water', 'Water'], ['utilities.gas', 'Gas / LPG'], ['utilities.internet', 'Internet & Broadband'], ['utilities.mobile', 'Mobile Recharge'], ['utilities.dth', 'DTH / Cable']] },
  { slug: 'transport', name: 'Transport', kind: 'expense', icon: 'car', color: '#0ea5e9', children: [['transport.fuel', 'Fuel'], ['transport.cab', 'Cab & Auto'], ['transport.public', 'Metro, Bus & Train'], ['transport.service', 'Vehicle Service'], ['transport.tolls', 'Parking & Tolls']] },
  { slug: 'shopping', name: 'Shopping', kind: 'expense', icon: 'shopping-bag', color: '#ec4899', children: [['shopping.clothing', 'Clothing & Footwear'], ['shopping.electronics', 'Electronics'], ['shopping.household', 'Household Supplies'], ['shopping.personal_care', 'Personal Care']] },
  { slug: 'health', name: 'Health', kind: 'expense', icon: 'heart-pulse', color: '#ef4444', children: [['health.medicines', 'Medicines'], ['health.doctor', 'Doctor & Diagnostics'], ['health.insurance', 'Health Insurance'], ['health.fitness', 'Fitness']] },
  { slug: 'education', name: 'Education', kind: 'expense', icon: 'graduation-cap', color: '#6366f1', children: [['education.fees', 'School & College Fees'], ['education.courses', 'Courses & Certifications'], ['education.books', 'Books & Supplies']] },
  { slug: 'entertainment', name: 'Entertainment', kind: 'expense', icon: 'clapperboard', color: '#14b8a6', children: [['entertainment.ott', 'OTT Subscriptions'], ['entertainment.events', 'Movies & Events'], ['entertainment.hobbies', 'Hobbies & Games']] },
  { slug: 'travel', name: 'Travel', kind: 'expense', icon: 'plane', color: '#06b6d4', children: [['travel.flights', 'Flights'], ['travel.trains', 'Trains & Buses'], ['travel.hotels', 'Hotels & Stays'], ['travel.holidays', 'Holiday Packages']] },
  { slug: 'financial', name: 'Financial', kind: 'expense', icon: 'landmark', color: '#64748b', children: [['financial.emi', 'EMI / Loan Repayment'], ['financial.bank_charges', 'Bank & Card Charges'], ['financial.interest', 'Interest Paid'], ['financial.taxes', 'Taxes'], ['financial.life_insurance', 'Life Insurance']] },
  { slug: 'family', name: 'Family & Personal', kind: 'expense', icon: 'users', color: '#a855f7', children: [['family.gifts', 'Gifts & Donations'], ['family.childcare', 'Childcare'], ['family.pets', 'Pets'], ['family.household_help', 'Household Help']] },
  { slug: 'expense.other', name: 'Other Expenses', kind: 'expense', icon: 'circle-dashed', color: '#94a3b8' },
  { slug: 'income.salary', name: 'Salary', kind: 'income', icon: 'briefcase', color: '#16a34a' },
  { slug: 'income.business', name: 'Business Income', kind: 'income', icon: 'store', color: '#15803d' },
  { slug: 'income.freelance', name: 'Freelance', kind: 'income', icon: 'laptop', color: '#22c55e' },
  { slug: 'income.rental', name: 'Rental Income', kind: 'income', icon: 'building', color: '#4ade80' },
  { slug: 'income.interest', name: 'Interest', kind: 'income', icon: 'percent', color: '#65a30d' },
  { slug: 'income.dividends', name: 'Dividends', kind: 'income', icon: 'trending-up', color: '#84cc16' },
  { slug: 'income.capital_gains', name: 'Capital Gains', kind: 'income', icon: 'line-chart', color: '#10b981' },
  { slug: 'income.refunds', name: 'Refunds & Cashback', kind: 'income', icon: 'rotate-ccw', color: '#059669' },
  { slug: 'income.gifts', name: 'Gifts Received', kind: 'income', icon: 'gift', color: '#34d399' },
  { slug: 'income.other', name: 'Other Income', kind: 'income', icon: 'plus-circle', color: '#6ee7b7' },
  { slug: 'transfer.internal', name: 'Account Transfer', kind: 'transfer', icon: 'arrow-left-right', color: '#475569' },
  { slug: 'transfer.card_payment', name: 'Credit Card Payment', kind: 'transfer', icon: 'credit-card', color: '#334155' },
  { slug: 'transfer.savings', name: 'Savings & Investments', kind: 'transfer', icon: 'piggy-bank', color: '#0f766e' },
  { slug: 'transfer.cash_withdrawal', name: 'Cash Withdrawal', kind: 'transfer', icon: 'banknote', color: '#78716c' },
];

export async function up(knex: Knex): Promise<void> {
  // -------------------------------------------------------------- accounts
  await knex.schema.createTable('accounts', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('nickname');
    t.text('type').notNullable();
    t.text('institution_name');
    t.specificType('account_number_last4', 'char(4)');
    t.text('ifsc');
    t.specificType('currency', 'char(3)').notNullable().defaultTo('INR');
    money(t, 'opening_balance').notNullable().defaultTo(0);
    t.date('opening_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    money(t, 'credit_limit');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('include_in_net_worth').notNullable().defaultTo(true);
    t.date('closed_on');
    money(t, 'closing_balance');
    // Monetra never connects to banks without an authorised integration; all accounts are manual today.
    t.text('data_source').notNullable().defaultTo('manual');
    t.text('color');
    t.text('notes');
    timestamps(knex, t);
    t.index(['user_id', 'is_active']);
  });
  await knex.raw(`
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_type_check CHECK (type IN ('savings', 'current', 'salary', 'cash', 'wallet', 'credit_card', 'overdraft', 'other')),
      ADD CONSTRAINT accounts_last4_check CHECK (account_number_last4 IS NULL OR account_number_last4 ~ '^[0-9]{4}$'),
      ADD CONSTRAINT accounts_ifsc_check CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
      ADD CONSTRAINT accounts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
      ADD CONSTRAINT accounts_credit_limit_check CHECK (credit_limit IS NULL OR credit_limit >= 0),
      ADD CONSTRAINT accounts_data_source_check CHECK (data_source IN ('manual', 'import', 'aggregator')),
      ADD CONSTRAINT accounts_closed_check CHECK ((closed_on IS NULL) = is_active);
    CREATE UNIQUE INDEX accounts_user_name_unique ON accounts (user_id, lower(name));
  `);
  await updatedAtTrigger(knex, 'accounts');

  // Statement / manual balance snapshots used by reconciliation.
  await knex.schema.createTable('account_balances', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('account_id').notNullable().references('accounts.id').onDelete('CASCADE');
    t.date('as_of_date').notNullable();
    money(t, 'balance').notNullable();
    money(t, 'computed_balance').notNullable();
    money(t, 'difference').notNullable();
    t.text('source').notNullable().defaultTo('statement');
    t.boolean('reconciled').notNullable().defaultTo(false);
    t.uuid('adjustment_transaction_id');
    t.text('note');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'as_of_date', 'source']);
  });
  await knex.raw(`ALTER TABLE account_balances ADD CONSTRAINT account_balances_source_check CHECK (source IN ('statement', 'manual', 'computed'))`);

  // ------------------------------------------------------------ categories
  await knex.schema.createTable('transaction_categories', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').references('users.id').onDelete('CASCADE');
    t.uuid('parent_id').references('transaction_categories.id').onDelete('RESTRICT');
    t.text('slug');
    t.text('name').notNullable();
    t.text('kind').notNullable();
    t.text('icon');
    t.text('color');
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamp('archived_at', { useTz: true });
    timestamps(knex, t);
    t.index(['user_id']);
  });
  await knex.raw(`
    ALTER TABLE transaction_categories
      ADD CONSTRAINT transaction_categories_kind_check CHECK (kind IN ('income', 'expense', 'transfer')),
      ADD CONSTRAINT transaction_categories_system_check CHECK (is_system = (user_id IS NULL));
    CREATE UNIQUE INDEX transaction_categories_unique_name
      ON transaction_categories (user_id, parent_id, lower(name), kind) NULLS NOT DISTINCT;
    CREATE UNIQUE INDEX transaction_categories_slug_unique ON transaction_categories (slug) WHERE slug IS NOT NULL;
  `);
  await updatedAtTrigger(knex, 'transaction_categories');

  for (const cat of SYSTEM_CATEGORIES) {
    const [parent] = await knex('transaction_categories')
      .insert({ slug: cat.slug, name: cat.name, kind: cat.kind, icon: cat.icon, color: cat.color, is_system: true })
      .returning('id');
    for (const [slug, name] of cat.children ?? []) {
      await knex('transaction_categories').insert({ slug, name, kind: cat.kind, icon: cat.icon, color: cat.color, is_system: true, parent_id: parent.id });
    }
  }

  // ------------------------------------------------------------- merchants
  await knex.schema.createTable('merchants', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('normalized_name').notNullable();
    t.uuid('default_category_id').references('transaction_categories.id').onDelete('SET NULL');
    t.text('upi_vpa');
    t.text('website');
    timestamps(knex, t);
    t.unique(['user_id', 'normalized_name']);
  });
  await updatedAtTrigger(knex, 'merchants');

  await knex.schema.createTable('categorization_rules', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('pattern').notNullable();
    t.text('match_field').notNullable().defaultTo('any');
    t.uuid('category_id').notNullable().references('transaction_categories.id').onDelete('CASCADE');
    t.integer('priority').notNullable().defaultTo(100);
    t.integer('times_applied').notNullable().defaultTo(0);
    timestamps(knex, t);
    t.index(['user_id', 'priority']);
  });
  await knex.raw(`
    ALTER TABLE categorization_rules
      ADD CONSTRAINT categorization_rules_field_check CHECK (match_field IN ('any', 'description', 'merchant', 'upi')),
      ADD CONSTRAINT categorization_rules_pattern_check CHECK (length(pattern) BETWEEN 2 AND 100);
  `);
  await updatedAtTrigger(knex, 'categorization_rules');

  // ------------------------------------------------------- payment methods
  // Only non-secret identifiers are stored: never full card numbers, CVVs, UPI PINs or OTPs.
  await knex.schema.createTable('payment_methods', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('type').notNullable();
    t.text('label').notNullable();
    t.text('upi_vpa');
    t.text('upi_app');
    t.text('card_network');
    t.specificType('card_last4', 'char(4)');
    t.smallint('card_expiry_month');
    t.smallint('card_expiry_year');
    t.uuid('linked_account_id').references('accounts.id').onDelete('SET NULL');
    t.boolean('is_default').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.index(['user_id']);
  });
  await knex.raw(`
    ALTER TABLE payment_methods
      ADD CONSTRAINT payment_methods_type_check CHECK (type IN ('cash', 'upi', 'debit_card', 'credit_card', 'net_banking', 'wallet', 'cheque', 'other')),
      ADD CONSTRAINT payment_methods_last4_check CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
      ADD CONSTRAINT payment_methods_vpa_check CHECK (upi_vpa IS NULL OR upi_vpa ~ '^[a-zA-Z0-9._-]{2,128}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$'),
      ADD CONSTRAINT payment_methods_expiry_check CHECK (
        (card_expiry_month IS NULL OR card_expiry_month BETWEEN 1 AND 12) AND (card_expiry_year IS NULL OR card_expiry_year BETWEEN 2000 AND 2100)
      ),
      ADD CONSTRAINT payment_methods_card_fields_check CHECK (type IN ('debit_card', 'credit_card') OR card_last4 IS NULL);
    CREATE UNIQUE INDEX payment_methods_one_default ON payment_methods (user_id) WHERE is_default;
    CREATE UNIQUE INDEX payment_methods_label_unique ON payment_methods (user_id, lower(label));
  `);
  await updatedAtTrigger(knex, 'payment_methods');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('payment_methods');
  await knex.schema.dropTableIfExists('categorization_rules');
  await knex.schema.dropTableIfExists('merchants');
  await knex.schema.dropTableIfExists('transaction_categories');
  await knex.schema.dropTableIfExists('account_balances');
  await knex.schema.dropTableIfExists('accounts');
}
