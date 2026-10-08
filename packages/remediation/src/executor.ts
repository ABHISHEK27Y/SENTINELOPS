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
    const base = this.baseUrlFor(action.targetService);
    try {
      const res = await fetch(`${base}/admin/faults`, { method: 'DELETE' });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} clearing faults` };
      return {
        ok: true,
        detail: `${action.type}: cleared faults on ${action.targetService}`,
      };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
