#!/usr/bin/env node
import { closePool } from './pool.js';
import { status, up, migrationsDir } from './migrate.js';

/**
 * Migration CLI.
 *   node --import tsx packages/db/src/cli.ts up       # apply pending
 *   node --import tsx packages/db/src/cli.ts status   # show applied/pending
 */
async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  switch (cmd) {
    case 'up': {
      const { applied } = await up();
      console.log(
        applied.length
          ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
          : 'Database is up to date.',
      );
      break;
    }
    case 'status': {
      const s = await status();
      console.log(`dir: ${migrationsDir()}`);
      console.log(`applied (${s.applied.length}): ${s.applied.join(', ') || '—'}`);
      console.log(`pending (${s.pending.length}): ${s.pending.join(', ') || '—'}`);
      break;
    }
    default:
      console.error(`unknown command: ${cmd} (use 'up' or 'status')`);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
