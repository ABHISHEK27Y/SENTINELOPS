import { query, transaction } from './pool.js';

export interface OutboxEnvelope {
  eventId: string;
  service: string;
  [field: string]: unknown;
}

/** Inbox completion is committed with the handler's database effects/outbox. */
export async function processEvent(
  consumer: string,
  eventId: string,
  work: () => Promise<void>
): Promise<void> {
  await transaction(async () => {
    const inserted = await query(
      'INSERT INTO event_inbox(consumer,event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',
      [consumer, eventId]
    );
    if (inserted.rowCount) await work();
  });
}

export async function enqueueEvent(
  topic: string,
  envelope: OutboxEnvelope,
  key = envelope.service
): Promise<void> {
  await query(
    'INSERT INTO event_outbox(id,topic,event_key,envelope) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [envelope.eventId, topic, key, JSON.stringify(envelope)]
  );
}

/** Global row locks serialize dispatch across processes. IDs stay stable on retry. */
export async function dispatchOutbox(
  send: (topic: string, envelope: OutboxEnvelope, key: string) => Promise<boolean>
): Promise<void> {
  await transaction(async () => {
    const lock = await query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(7349201) AS acquired'
    );
    if (!lock.rows[0]?.acquired) return;
    const { rows } = await query<{
      id: string;
      topic: string;
      event_key: string;
      envelope: OutboxEnvelope;
    }>(
      'SELECT id,topic,event_key,envelope FROM event_outbox WHERE published_at IS NULL ORDER BY sequence LIMIT 50 FOR UPDATE SKIP LOCKED'
    );
    for (const row of rows) {
      if (!(await send(row.topic, row.envelope, row.event_key)))
        throw new Error('outbox delivery failed');
      await query('UPDATE event_outbox SET published_at=now() WHERE id=$1', [row.id]);
    }
  });
}

export function startOutbox(
  send: Parameters<typeof dispatchOutbox>[0],
  onError: (err: unknown) => void
): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (!stopped && !running) {
      running = dispatchOutbox(send)
        .catch(onError)
        .finally(() => {
          running = null;
        });
    }
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

export async function withPipelineState<T>(
  name: string,
  work: (state: unknown) => Promise<{ state: unknown; result: T }>
): Promise<T> {
  return transaction(async () => {
    await query('INSERT INTO pipeline_state(name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    const { rows } = await query<{ data: unknown }>(
      'SELECT data FROM pipeline_state WHERE name=$1 FOR UPDATE',
      [name]
    );
    const next = await work(rows[0]!.data);
    await query('UPDATE pipeline_state SET data=$2,updated_at=now() WHERE name=$1', [
      name,
      JSON.stringify(next.state),
    ]);
    return next.result;
  });
}
