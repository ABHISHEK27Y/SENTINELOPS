import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('./pool.js', () => db);
import { dispatchOutbox, enqueueEvent, processEvent, withPipelineState } from './reliability.js';

beforeEach(() => {
  vi.resetAllMocks();
  db.transaction.mockImplementation(async work => work());
});

describe('inbox and outbox boundaries', () => {
  it('does not apply an already committed event twice', async () => {
    db.query.mockResolvedValue({ rowCount: 0, rows: [] });
    const work = vi.fn();
    await processEvent('ingestor', 'event-a', work);
    expect(work).not.toHaveBeenCalled();
  });
  it('propagates handler failure through the transaction boundary', async () => {
    db.query.mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(
      processEvent('ingestor', 'event-a', async () => {
        throw new Error('write failed');
      })
    ).rejects.toThrow('write failed');
    expect(db.transaction).toHaveBeenCalledOnce();
  });
  it('keeps stable event identity when enqueueing', async () => {
    await enqueueEvent(
      'incident.events',
      { eventId: 'stable-id', service: 'engine' },
      'incident-id'
    );
    expect(db.query.mock.calls[0]?.[1]).toEqual([
      'stable-id',
      'incident.events',
      'incident-id',
      '{"eventId":"stable-id","service":"engine"}',
    ]);
  });
  it('does not mark an outbox row published if delivery fails', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({
      rows: [{ id: 'a', topic: 'incident.events', event_key: 'inc', envelope: { eventId: 'a' } }],
    });
    await expect(dispatchOutbox(async () => false)).rejects.toThrow('outbox delivery failed');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it('only marks published after broker confirmation and skips a competing dispatcher', async () => {
    const send = vi.fn().mockResolvedValue(true);
    db.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    await dispatchOutbox(send);
    expect(send).not.toHaveBeenCalled();
    db.query
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'a', topic: 'incident.events', event_key: 'inc', envelope: { eventId: 'a' } }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await dispatchOutbox(send);
    expect(send).toHaveBeenCalledWith('incident.events', { eventId: 'a' }, 'inc');
    expect(db.query.mock.calls.at(-1)?.[1]).toEqual(['a']);
  });
  it('loads and saves pipeline state under the same transaction', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ data: { baseline: 100 } }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await withPipelineState('detector', async state => ({
      state: { ...(state as object), next: true },
      result: 42,
    }));
    expect(result).toBe(42);
    expect(db.query.mock.calls[1]?.[0]).toContain('FOR UPDATE');
    expect(db.query.mock.calls[2]?.[1]).toEqual(['detector', '{"baseline":100,"next":true}']);
  });
});
