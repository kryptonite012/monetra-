import type { Knex } from 'knex';

/** Remembers the last accepted TOTP time step so a code cannot be replayed. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.bigInteger('mfa_last_used_step');
    t.timestamp('mfa_enabled_at', { useTz: true });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('mfa_last_used_step');
    t.dropColumn('mfa_enabled_at');
  });
}
