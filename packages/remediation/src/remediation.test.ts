import { describe, expect, it } from 'vitest';
import { recommendActions } from './recommend.js';
import { evaluateRecovery, RecoveryTracker } from './recovery.js';
import { MockExecutor } from './executor.js';

describe('recommendActions', () => {
  it('recommends pool increase + restart for a DB pool incident', () => {
    const actions = recommendActions({
      rootCauseService: 'postgres',
      affectedServices: ['postgres', 'payment-service', 'order-service'],
      metrics: ['db_pool_utilization', 'request_latency_ms'],
    });
    expect(actions[0]!.type).toBe('increase_connection_pool');
    expect(actions[0]!.risk).toBe('LOW');
    expect(actions[0]!.requiresApproval).toBe(false);
    // Targets a real client service, not the postgres infra node.
    expect(actions[0]!.targetService).toBe('payment-service');
    expect(actions.some((a) => a.type === 'restart_service' && a.requiresApproval)).toBe(true);
  });

  it('adds a rollback when a recent deployment correlates', () => {
    const actions = recommendActions({
      rootCauseService: 'payment-service',
      affectedServices: ['payment-service'],
      metrics: ['db_query_latency_ms'],
      hasRecentDeployment: true,
    });
    expect(actions.some((a) => a.type === 'rollback_deployment')).toBe(true);
  });

  it('recommends cache actions for a redis incident', () => {
    const actions = recommendActions({
      rootCauseService: 'redis',
      affectedServices: ['redis', 'notification-service'],
      metrics: ['redis_latency_ms', 'queue_depth'],
    });
    expect(actions.some((a) => a.type === 'clear_cache')).toBe(true);
  });
});

describe('recovery', () => {
  it('passes when metrics are within tolerance of baseline', () => {
    const r = evaluateRecovery([
      { metric: 'request_latency_ms', observed: 210, baseline: 180 },
      { metric: 'db_pool_utilization', observed: 0.2, baseline: 0.15 },
    ]);
    expect(r.recovered).toBe(true);
  });

  it('fails when a metric is still far above baseline', () => {
    const r = evaluateRecovery([
      { metric: 'request_latency_ms', observed: 2600, baseline: 180 },
    ]);
    expect(r.recovered).toBe(false);
  });

  it('requires consecutive passing windows to confirm', () => {
    const t = new RecoveryTracker(2);
    const good = [{ metric: 'request_latency_ms', observed: 190, baseline: 180 }];
    const bad = [{ metric: 'request_latency_ms', observed: 3000, baseline: 180 }];
    expect(t.observe(good).confirmed).toBe(false); // 1st pass
    expect(t.observe(good).confirmed).toBe(true); // 2nd consecutive pass
    expect(t.observe(bad).confirmed).toBe(false); // reset
  });
});

describe('MockExecutor', () => {
  it('reports success', async () => {
    const r = await new MockExecutor().execute({
      type: 'restart_service', targetService: 'payment-service',
      risk: 'MEDIUM', rationale: 'x', requiresApproval: true,
    });
    expect(r.ok).toBe(true);
  });
});
