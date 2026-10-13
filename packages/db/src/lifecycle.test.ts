import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), enqueue: vi.fn() }));
vi.mock('./pool.js', () => ({ query: db.query, transaction: db.transaction }));
vi.mock('./reliability.js', () => ({ enqueueEvent: db.enqueue }));

import { transitionIncident } from './lifecycle.js';

beforeEach(() => {
  vi.resetAllMocks();
  db.transaction.mockImplementation(async work => work());
  db.query.mockResolvedValue({ rows: [], rowCount: 1 });
  db.enqueue.mockResolvedValue(undefined);
});

describe('transactional incident lifecycle', () => {
  it.each([
    { rows: [], expected: undefined },
    { rows: [{ status: 'RESOLVED' }], expected: undefined },
    { rows: [{ status: 'VERIFYING' }], expected: 'REMEDIATING' as const },
  ])(
    'rejects missing, illegal or stale state without writing history',
    async ({ rows, expected }) => {
      db.query.mockResolvedValueOnce({ rows });
      expect(await transitionIncident('INC-1', 'RESOLVED', 'recovered', expected)).toBe(false);
      expect(db.query).toHaveBeenCalledOnce();
      expect(db.enqueue).not.toHaveBeenCalled();
    }
  );

  it('records resolution and its event under the same transaction', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'VERIFYING' }] });
    expect(await transitionIncident('INC-1', 'RESOLVED', 'fresh windows passed', 'VERIFYING')).toBe(
      true
    );
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(db.query.mock.calls[2]?.[1]).toEqual([
      'INC-1',
      'fresh windows passed',
      JSON.stringify({ from: 'VERIFYING', to: 'RESOLVED' }),
    ]);
    expect(db.enqueue).toHaveBeenCalledWith(
      'incident.events',
      expect.objectContaining({
        type: 'INCIDENT_RESOLVED',
        payload: { incidentId: 'INC-1', from: 'VERIFYING', status: 'RESOLVED' },
      }),
      'INC-1'
    );
  });

  it('propagates outbox failure so the outer database transaction can roll back', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: 'DETECTED' }] });
    db.enqueue.mockRejectedValue(new Error('outbox unavailable'));
    await expect(transitionIncident('INC-1', 'INVESTIGATING', 'started')).rejects.toThrow(
      'outbox unavailable'
    );
    expect(db.enqueue.mock.calls[0]?.[1]).toMatchObject({ type: 'INCIDENT_UPDATED' });
  });
});
