import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

import { getEnv } from '../packages/config/src/env.ts';
import {
  query,
  transaction,
  closePool,
  processEvent,
  enqueueEvent,
  dispatchOutbox,
  transitionIncident,
} from '../packages/db/src/index.ts';

// Clone only the acceptance tables into a unique schema. Existing demo rows
// and the running outbox dispatcher remain outside this connection's scope.
const env = getEnv();
const url = new URL(env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Local demo database required');
url.hostname = '127.0.0.1';
const schema = `acceptance_${randomUUID().replaceAll('-', '')}`;
const inboxId = randomUUID();
url.searchParams.set('options', `-csearch_path=${schema},public`);
env.DATABASE_URL = url.toString();
async function dispatchWhenAvailable(send) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    let attempted = false;
    await dispatchOutbox(async (...args) => {
      attempted = true;
      return send(...args);
    });
    if (attempted) return;
    await delay(100);
  }
  throw new Error('outbox lock unavailable during acceptance');
}
try {
  await query(`CREATE SCHEMA ${schema}`);
  for (const table of [
    'incidents',
    'incident_events',
    'event_inbox',
    'event_outbox',
    'pipeline_state',
  ])
    await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  await assert.rejects(
    transaction(async () => {
      await query("INSERT INTO pipeline_state(name) VALUES ('rolled-back')");
      await transaction(async () => {
        throw new Error('expected rollback');
      });
    }),
    /expected rollback/
  );
  assert.equal(
    (await query("SELECT count(*)::int AS n FROM pipeline_state WHERE name='rolled-back'")).rows[0]
      .n,
    0
  );
  await assert.rejects(
    processEvent('acceptance', inboxId, async () => {
      await query("INSERT INTO pipeline_state(name) VALUES ('effect')");
      throw new Error('handler failure');
    }),
    /handler failure/
  );
  assert.equal((await query('SELECT count(*)::int AS n FROM event_inbox')).rows[0].n, 0);
  const effect = async () => {
    await query("INSERT INTO pipeline_state(name) VALUES ('effect')");
  };
  await Promise.all([
    processEvent('acceptance', inboxId, effect),
    processEvent('acceptance', inboxId, effect),
  ]);
  assert.equal(
    (await query("SELECT count(*)::int AS n FROM pipeline_state WHERE name='effect'")).rows[0].n,
    1
  );
  const eventId = randomUUID();
  await enqueueEvent('acceptance', { eventId, service: 'acceptance' });
  await assert.rejects(
    dispatchWhenAvailable(async () => false),
    /delivery failed/
  );
  assert.equal(
    (await query('SELECT published_at FROM event_outbox WHERE id=$1', [eventId])).rows[0]
      .published_at,
    null
  );
  let sends = 0;
  await dispatchWhenAvailable(async (_topic, envelope) => {
    assert.equal(envelope.eventId, eventId);
    sends++;
    return true;
  });
  await dispatchOutbox(async () => {
    sends++;
    return true;
  });
  assert.equal(sends, 1);
  await query(
    "INSERT INTO incidents(id,title,status,severity,correlation_id,started_at) VALUES ('acceptance','Test','DETECTED','INFO','acceptance',now())"
  );
  const races = await Promise.all([
    transitionIncident('acceptance', 'INVESTIGATING', 'first', 'DETECTED'),
    transitionIncident('acceptance', 'INVESTIGATING', 'second', 'DETECTED'),
  ]);
  assert.equal(races.filter(Boolean).length, 1);
  assert.equal(
    (await query("SELECT count(*)::int AS n FROM incident_events WHERE incident_id='acceptance'"))
      .rows[0].n,
    1
  );
  assert.equal(await transitionIncident('acceptance', 'RESOLVED', 'illegal'), false);
  console.info(
    'Live PostgreSQL rollback, nested transactions, concurrent inbox dedupe, outbox confirmation/retry and lifecycle race checks passed.'
  );
} finally {
  try {
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await closePool();
  }
}
