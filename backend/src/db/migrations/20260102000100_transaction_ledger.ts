import type { Knex } from 'knex';
import { money, uuidPk } from '../helpers';

/**
 * The transaction ledger: the single source of truth for every movement of
 * money. Rows are immutable once written: corrections are made by posting a
 * reversal (and, if needed, a replacement), never by editing amounts.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    // NO ACTION (not RESTRICT) so that deleting a user can cascade through accounts and ledger in one statement.
    t.uuid('account_id').notNullable().references('accounts.id');
    t.text('direction').notNullable();
    money(t, 'amount').notNullable();
    t.specificType('currency', 'char(3)').notNullable().defaultTo('INR');
    t.text('kind').notNullable();
    t.uuid('category_id').references('transaction_categories.id');
    t.uuid('merchant_id').references('merchants.id');
    t.uuid('payment_method_id').references('payment_methods.id');
    t.date('occurred_on').notNullable();
    t.timestamp('posted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('description').notNullable();
    t.text('notes');
    t.text('reference');
    t.text('counterparty');
    t.uuid('transfer_group_id');
    t.text('status').notNullable().defaultTo('posted');
    t.uuid('reversal_of_id').references('transactions.id');
    t.uuid('reversed_by_id');
    t.uuid('supersedes_id').references('transactions.id');
    t.text('source').notNullable().defaultTo('manual');
    t.specificType('tags', 'text[]').notNullable().defaultTo('{}');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_direction_check CHECK (direction IN ('credit', 'debit')),
      ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0),
      ADD CONSTRAINT transactions_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
      ADD CONSTRAINT transactions_kind_check CHECK (kind IN (
        'income', 'expense', 'transfer', 'adjustment', 'refund', 'fee', 'interest',
        'loan_disbursement', 'loan_repayment', 'investment_buy', 'investment_sell',
        'bill_payment', 'goal_contribution', 'reversal'
      )),
      ADD CONSTRAINT transactions_status_check CHECK (status IN ('posted', 'reversed')),
      ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'recurring', 'import', 'system')),
      ADD CONSTRAINT transactions_reversal_link CHECK ((kind = 'reversal') = (reversal_of_id IS NOT NULL)),
      ADD CONSTRAINT transactions_reversed_link CHECK ((status = 'reversed') = (reversed_by_id IS NOT NULL)),
      ADD CONSTRAINT transactions_description_check CHECK (length(description) BETWEEN 1 AND 500);

    CREATE UNIQUE INDEX transactions_single_reversal ON transactions (reversal_of_id) WHERE reversal_of_id IS NOT NULL;
    CREATE INDEX transactions_user_date ON transactions (user_id, occurred_on DESC, posted_at DESC);
    CREATE INDEX transactions_account_date ON transactions (account_id, occurred_on);
    CREATE INDEX transactions_user_category ON transactions (user_id, category_id, occurred_on);
    CREATE INDEX transactions_user_kind ON transactions (user_id, kind, occurred_on);
    CREATE INDEX transactions_transfer_group ON transactions (transfer_group_id) WHERE transfer_group_id IS NOT NULL;
    CREATE INDEX transactions_reference ON transactions (user_id, reference) WHERE reference IS NOT NULL;
  `);

  // ------------------------------------------------------------------
  // Integrity triggers
  // ------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION transactions_guard_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      acct RECORD;
    BEGIN
      SELECT user_id, currency, is_active INTO acct FROM accounts WHERE id = NEW.account_id;
      IF acct.user_id IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'Account does not belong to this user';
      END IF;
      IF acct.currency <> NEW.currency THEN
        RAISE EXCEPTION 'Transaction currency % does not match account currency %', NEW.currency, acct.currency;
      END IF;
      IF NEW.status <> 'posted' OR NEW.reversed_by_id IS NOT NULL THEN
        RAISE EXCEPTION 'New ledger entries must be posted';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER transactions_before_insert BEFORE INSERT ON transactions
      FOR EACH ROW EXECUTE FUNCTION transactions_guard_insert();

    -- Financial fields are immutable. Only annotations (category, merchant,
    -- description, notes, tags, metadata) may change, plus the one-way
    -- posted -> reversed transition performed by the reversal workflow.
    CREATE OR REPLACE FUNCTION transactions_guard_update() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.direction IS DISTINCT FROM OLD.direction
        OR NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on
        OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
        OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
        OR NEW.reference IS DISTINCT FROM OLD.reference
        OR NEW.transfer_group_id IS DISTINCT FROM OLD.transfer_group_id
        OR NEW.reversal_of_id IS DISTINCT FROM OLD.reversal_of_id
        OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'Ledger entries are immutable; post a reversal or correction instead';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status OR NEW.reversed_by_id IS DISTINCT FROM OLD.reversed_by_id THEN
        IF NOT (OLD.status = 'posted' AND NEW.status = 'reversed' AND OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL) THEN
          RAISE EXCEPTION 'A ledger entry can only be reversed once';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER transactions_before_update BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION transactions_guard_update();

    CREATE OR REPLACE FUNCTION transactions_guard_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('monetra.allow_ledger_purge', true) = 'on' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Ledger entries cannot be deleted; post a reversal instead';
    END;
    $$;

    CREATE TRIGGER transactions_before_delete BEFORE DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION transactions_guard_delete();

    -- Current balance per account = opening balance + signed sum of ledger entries.
    -- Reversed entries stay in the sum together with their reversal, netting to zero.
    CREATE VIEW account_current_balances AS
      SELECT a.id AS account_id,
             a.user_id,
             a.opening_balance
               + COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END), 0) AS balance,
             COUNT(t.id) AS transaction_count,
             MAX(t.occurred_on) AS last_transaction_on
        FROM accounts a
        LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP VIEW IF EXISTS account_current_balances');
  await knex.schema.dropTableIfExists('transactions');
  await knex.raw('DROP FUNCTION IF EXISTS transactions_guard_insert()');
  await knex.raw('DROP FUNCTION IF EXISTS transactions_guard_update()');
  await knex.raw('DROP FUNCTION IF EXISTS transactions_guard_delete()');
}
