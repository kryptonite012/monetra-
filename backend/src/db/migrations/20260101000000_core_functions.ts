import type { Knex } from 'knex';

/**
 * Shared database functions.
 * - set_updated_at(): keeps updated_at current on every UPDATE.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP FUNCTION IF EXISTS set_updated_at() CASCADE');
}
