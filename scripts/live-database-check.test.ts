import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  env: { DATABASE_URL: 'postgresql://demo:demo@localhost:5432/demo' },
  query: vi.fn(),
  close: vi.fn(),
  inbox: false,
  effect: false,
  envelope: null as null | { eventId: string },
  published: false,
  status: 'DETECTED',
  lockBusy: true,
}));
vi.mock('../packages/config/src/env.ts', () => ({ getEnv: () => state.env }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
vi.mock('../packages/db/src/index.ts', () => ({
  query: state.query,
  closePool: state.close,
  transaction: async (work: () => Promise<unknown>) => work(),
  processEvent: async (_consumer: string, _id: string, work: () => Promise<void>) => {
    if (state.inbox) return;
    state.inbox = true;
    try {
      await work();
    } catch (error) {
      state.inbox = false;
      state.effect = false;
      throw error;
    }
  },
  enqueueEvent: async (_topic: string, envelope: { eventId: string }) => {
    state.envelope = envelope;
  },
  dispatchOutbox: async (send: (...args: unknown[]) => Promise<boolean>) => {
    if (state.lockBusy) {
      state.lockBusy = false;
      return;
    }
    if (state.published) return;
    if (!(await send('acceptance', state.envelope, 'acceptance')))
      throw new Error('outbox delivery failed');
    state.published = true;
  },
  transitionIncident: async (_id: string, to: string) => {
    if (state.status !== 'DETECTED' || to !== 'INVESTIGATING') return false;
    state.status = to;
    return true;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});
it('keeps live acceptance isolated and cleans its schema after transactional and lock-retry checks', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes("INSERT INTO pipeline_state(name) VALUES ('effect')")) state.effect = true;
    if (sql.includes('count(*)'))
      return {
        rows: [
          {
            n: sql.includes('rolled-back')
              ? 0
              : sql.includes('event_inbox')
                ? Number(state.inbox)
                : sql.includes('incident_events')
                  ? 1
                  : Number(state.effect),
          },
        ],
      };
    if (sql.includes('SELECT published_at'))
      return { rows: [{ published_at: state.published ? 'published' : null }] };
    return { rows: [], rowCount: 1 };
  });
  await import('./live-database-check.mjs');
  const calls = state.query.mock.calls.map(([sql]) => String(sql));
  expect(calls[0]).toMatch(/^CREATE SCHEMA acceptance_[a-f0-9]+$/);
  expect(calls.at(-1)).toMatch(/^DROP SCHEMA IF EXISTS acceptance_[a-f0-9]+ CASCADE$/);
  expect(calls.some(sql => /DROP.*public/.test(sql))).toBe(false);
  expect(state.close).toHaveBeenCalledOnce();
  expect(new URL(state.env.DATABASE_URL).searchParams.get('options')).toContain(
    'search_path=acceptance_'
  );
});
