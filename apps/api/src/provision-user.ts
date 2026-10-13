import bcrypt from 'bcryptjs';

import { query, transaction } from '@sentinelops/db';
import { Role, type Role as RoleT } from '@sentinelops/shared-types';

/** Operator CLI boundary: only create, never silently reset an existing user. */
export async function provisionUser(
  email: string,
  name: string,
  role: RoleT,
  password: string
): Promise<string> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('valid email required');
  if (!name.trim() || name.length > 100) throw new Error('name must be 1..100 characters');
  if (!Object.values(Role).includes(role))
    throw new Error('role must be VIEWER, ENGINEER or ADMIN');
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw new Error('password must be at least 12 characters and at most 72 UTF-8 bytes');
  const hash = await bcrypt.hash(password, 12);
  return transaction(async () => {
    const user = (
      await query<{ id: string }>(
        'INSERT INTO users(email,name,role,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id',
        [email.toLowerCase().trim(), name.trim(), role, hash]
      )
    ).rows[0];
    if (!user) throw new Error('user already exists; no changes applied');
    await query(
      "INSERT INTO audit_log(actor,action,target,result) VALUES('operator-cli','create_user',$1,'CREATED')",
      [user.id]
    );
    return user.id;
  });
}
