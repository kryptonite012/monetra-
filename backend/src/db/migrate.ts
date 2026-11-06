/* Migration CLI: tsx src/db/migrate.ts [latest|rollback|status|reset] */
import knexFactory from 'knex';
import { knexConfig } from './knex';
import { logger } from '../lib/logger';

export async function migrateLatest(url?: string): Promise<string[]> {
  // Migrations run on a dedicated connection without row camelisation (knex reads its lock table directly).
  const knex = knexFactory(knexConfig({ camelize: false, url }));
  try {
    const [, applied] = await knex.migrate.latest();
    return applied as string[];
  } finally {
    await knex.destroy();
  }
}

async function main() {
  const command = process.argv[2] ?? 'latest';
  const knex = knexFactory(knexConfig({ camelize: false }));
  try {
    switch (command) {
      case 'latest': {
        const [batch, applied] = await knex.migrate.latest();
        logger.info({ batch, applied }, applied.length ? 'migrations applied' : 'database already up to date');
        break;
      }
      case 'rollback': {
        const [batch, reverted] = await knex.migrate.rollback();
        logger.info({ batch, reverted }, 'migrations rolled back');
        break;
      }
      case 'reset': {
        await knex.migrate.rollback(undefined, true);
        const [, applied] = await knex.migrate.latest();
        logger.info({ applied }, 'database reset');
        break;
      }
      case 'status': {
        const [done, pending] = await knex.migrate.list();
        console.log(`Applied: ${done.length}`);
        for (const m of done) console.log(`  ✔ ${m.name}`);
        console.log(`Pending: ${pending.length}`);
        for (const m of pending) console.log(`  … ${m.file}`);
        break;
      }
      default:
        throw new Error(`Unknown migration command "${command}"`);
    }
  } finally {
    await knex.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
