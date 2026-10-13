import { closePool, up } from '@sentinelops/db';
import type { Role } from '@sentinelops/shared-types';

import { provisionUser } from './provision-user.js';

async function main() {
  const [email, name, role = 'VIEWER'] = process.argv.slice(2);
  const password = process.env['SENTINELOPS_OPERATOR_PASSWORD'];
  if (!email || !name || !password)
    throw new Error(
      'Usage: npm run auth:create-user -- EMAIL NAME ROLE; supply password via SENTINELOPS_OPERATOR_PASSWORD'
    );
  await up();
  const id = await provisionUser(email, name, role as Role, password);
  console.info(`Created user ${id}`);
}
main()
  .catch(error => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(closePool);
