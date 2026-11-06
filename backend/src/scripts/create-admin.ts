/* Promotes an existing user to administrator: npm run admin:promote -- someone@example.com */
import { db, closeDb } from '../db/knex';
import { audit } from '../modules/audit/audit.service';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run admin:promote -- <email>');
  const [user] = await db('users').where({ email }).whereNull('deleted_at').update({ role: 'admin' }).returning(['id', 'email']);
  if (!user) throw new Error(`No active user with email ${email}`);
  await audit({ action: 'admin.user_promoted_cli', userId: user.id, actorId: null, entityType: 'user', entityId: user.id });
  console.log(`${user.email} is now an administrator.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
