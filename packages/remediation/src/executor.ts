import { getEnv } from '@sentinelops/config';
import { FaultType } from '@sentinelops/shared-types';

import type { ProposedAction } from './recommend.js';

export interface ExecutionResult {
  ok: boolean;
  detail: string;
}

export interface RemediationExecutor {
  execute(action: ProposedAction): Promise<ExecutionResult>;
}

/** No-op executor for tests and dry runs. */
export class MockExecutor implements RemediationExecutor {
  async execute(action: ProposedAction): Promise<ExecutionResult> {
    return { ok: true, detail: `mock executed ${action.type} on ${action.targetService}` };
  }
}

/**
 * Demo executor: in this environment a "remediation" is applied by clearing the
 * injected fault on the target service (DELETE /admin/faults), which physically
 * restores its behaviour — the same endpoint failure-injection uses. Real
 * deployments would call Docker/Kubernetes here.
 */
export class FaultApiExecutor implements RemediationExecutor {
  constructor(private baseUrlFor: (service: string) => string) {}

  async execute(action: ProposedAction): Promise<ExecutionResult> {
    try {
      if (!getEnv().DEMO_MODE || action.type !== 'clear_injected_fault')
        return { ok: false, detail: 'no real infrastructure executor configured' };
      const faultType = action.params?.['faultType'];
      if (
        typeof faultType !== 'string' ||
        !Object.values(FaultType).some(type => type === faultType)
      )
        return { ok: false, detail: 'demo execution requires a supported faultType' };
      const base = this.baseUrlFor(action.targetService);
      const res = await fetch(`${base}/admin/faults/${faultType}`, {
        method: 'DELETE',
        headers: { 'x-internal-token': getEnv().INTERNAL_API_TOKEN },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} clearing faults` };
      return {
        ok: true,
        detail: `demo ${action.type}: cleared ${faultType} on ${action.targetService}; no infrastructure operation performed`,
      };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
