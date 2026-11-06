import type { Knex } from 'knex';
import { timestamps, updatedAtTrigger, uuidPk } from '../helpers';

/**
 * Identity & security tables: users, profiles, refresh-token sessions,
 * one-time verification tokens, MFA recovery codes, login activity and the
 * append-only audit log.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    uuidPk(knex, t);
    t.text('email').notNullable();
    t.timestamp('email_verified_at', { useTz: true });
    // Phone numbers are personal data: stored encrypted, with a keyed hash for uniqueness lookups.
    t.text('phone_encrypted');
    t.text('phone_hash');
    t.text('phone_last4');
    t.timestamp('phone_verified_at', { useTz: true });
    t.text('password_hash').notNullable();
    t.timestamp('password_changed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('role').notNullable().defaultTo('user');
    t.text('status').notNullable().defaultTo('active');
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
    t.text('mfa_secret_encrypted');
    t.text('mfa_pending_secret_encrypted');
    t.integer('failed_login_count').notNullable().defaultTo(0);
    t.timestamp('locked_until', { useTz: true });
    t.timestamp('last_login_at', { useTz: true });
    t.timestamp('deleted_at', { useTz: true });
    timestamps(knex, t);
  });
  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
      ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'support')),
      ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'locked', 'disabled', 'deleted')),
      ADD CONSTRAINT users_failed_login_count_check CHECK (failed_login_count >= 0);
    CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX users_phone_hash_unique ON users (phone_hash) WHERE phone_hash IS NOT NULL AND deleted_at IS NULL;
  `);
  await updatedAtTrigger(knex, 'users');

  await knex.schema.createTable('user_profiles', (t) => {
    t.uuid('user_id').primary().references('users.id').onDelete('CASCADE');
    t.text('full_name').notNullable();
    t.text('display_name');
    t.date('date_of_birth');
    t.text('occupation');
    t.text('employment_type');
    t.text('city');
    t.text('state');
    t.specificType('country', 'char(2)').notNullable().defaultTo('IN');
    t.specificType('base_currency', 'char(3)').notNullable().defaultTo('INR');
    t.text('locale').notNullable().defaultTo('en-IN');
    t.text('timezone').notNullable().defaultTo('Asia/Kolkata');
    t.decimal('monthly_income_estimate', 19, 4);
    t.smallint('financial_year_start_month').notNullable().defaultTo(4);
    t.boolean('onboarding_completed').notNullable().defaultTo(false);
    t.jsonb('preferences').notNullable().defaultTo('{}');
    timestamps(knex, t);
  });
  await knex.raw(`
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_fy_month_check CHECK (financial_year_start_month BETWEEN 1 AND 12),
      ADD CONSTRAINT user_profiles_income_check CHECK (monthly_income_estimate IS NULL OR monthly_income_estimate >= 0),
      ADD CONSTRAINT user_profiles_employment_check CHECK (
        employment_type IS NULL OR employment_type IN ('salaried', 'self_employed', 'business', 'student', 'retired', 'homemaker', 'other')
      );
  `);
  await updatedAtTrigger(knex, 'user_profiles');

  // Refresh-token sessions. Only a SHA-256 hash of each token is stored.
  await knex.schema.createTable('sessions', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.uuid('family_id').notNullable();
    t.text('token_hash').notNullable().unique();
    t.uuid('parent_id');
    t.uuid('replaced_by_id');
    t.specificType('ip', 'inet');
    t.text('user_agent');
    t.text('device_label');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_used_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true });
    t.text('revoked_reason');
    t.index(['user_id', 'revoked_at']);
    t.index(['family_id']);
  });

  // Hashed one-time tokens / codes for email & phone verification, password resets and MFA challenges.
  await knex.schema.createTable('auth_tokens', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('purpose').notNullable();
    t.text('token_hash').notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('consumed_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'purpose']);
    t.unique(['purpose', 'token_hash']);
  });
  await knex.raw(`
    ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check
      CHECK (purpose IN ('email_verify', 'phone_verify', 'password_reset', 'mfa_challenge'));
  `);

  await knex.schema.createTable('mfa_recovery_codes', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
    t.text('code_hash').notNullable();
    t.timestamp('used_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });

  await knex.schema.createTable('login_events', (t) => {
    uuidPk(knex, t);
    t.uuid('user_id').references('users.id').onDelete('CASCADE');
    t.text('email_attempted');
    t.boolean('success').notNullable();
    t.text('reason');
    t.text('method').notNullable().defaultTo('password');
    t.specificType('ip', 'inet');
    t.text('user_agent');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
  });

  // Append-only audit trail. No foreign key: entries outlive the rows they describe.
  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('user_id');
    t.uuid('actor_id');
    t.text('action').notNullable();
    t.text('entity_type');
    t.text('entity_id');
    t.specificType('ip', 'inet');
    t.text('user_agent');
    t.text('request_id');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
    t.index(['entity_type', 'entity_id']);
    t.index(['action']);
  });
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND current_setting('monetra.allow_audit_purge', true) = 'on' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'audit_logs is append-only (% not permitted)', TG_OP;
    END;
    $$;
    CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.raw('DROP FUNCTION IF EXISTS audit_logs_append_only()');
  await knex.schema.dropTableIfExists('login_events');
  await knex.schema.dropTableIfExists('mfa_recovery_codes');
  await knex.schema.dropTableIfExists('auth_tokens');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('user_profiles');
  await knex.schema.dropTableIfExists('users');
}
