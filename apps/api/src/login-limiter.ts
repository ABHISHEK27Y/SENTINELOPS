import { createHash } from 'node:crypto';

import { query } from '@sentinelops/db';

/** Shared fixed window: every API replica consumes the same database bucket. */
export async function consumeLoginAttempt(
  ip: string
): Promise<{ allowed: boolean; retryAfter: number }> {
  const key = createHash('sha256').update(`login:${ip}`).digest('hex');
  const { rows } = await query<{ attempts: number; retry_after: number }>(
    `INSERT INTO login_attempts(key,attempts,reset_at) VALUES ($1,1,clock_timestamp()+interval '60 seconds')
     ON CONFLICT(key) DO UPDATE SET
       attempts=CASE WHEN login_attempts.reset_at<=clock_timestamp() THEN 1 ELSE login_attempts.attempts+1 END,
       reset_at=CASE WHEN login_attempts.reset_at<=clock_timestamp() THEN clock_timestamp()+interval '60 seconds' ELSE login_attempts.reset_at END
     RETURNING attempts,GREATEST(1,CEIL(EXTRACT(EPOCH FROM reset_at-clock_timestamp())))::integer AS retry_after`,
    [key]
  );
  if (!rows[0]) throw new Error('login limiter did not return a bucket');
  return { allowed: rows[0].attempts <= 10, retryAfter: rows[0].retry_after };
}

export async function pruneLoginAttempts(): Promise<void> {
  await query(`DELETE FROM login_attempts WHERE key IN (
    SELECT key FROM login_attempts WHERE reset_at<now() ORDER BY reset_at LIMIT 1000 FOR UPDATE SKIP LOCKED
  )`);
}
