import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  delay: vi.fn(),
  failedExecution: false,
  before: true,
  approvals: 0,
}));
vi.mock('node:timers/promises', () => ({ setTimeout: deps.delay }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  deps.failedExecution = false;
  deps.before = true;
  deps.approvals = 0;
  deps.delay.mockResolvedValue(undefined);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('local deployment scripts', () => {
  it('generates monitoring workloads with persistent storage and mounted configuration', async () => {
    let output = '';
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((_path, data) => {
      output = String(data);
    });
    await import('./generate-monitoring.mjs');
    expect(write.mock.calls[0]?.[0]).toMatch(/06-monitoring.yaml$/);
    const manifests = output
      .replace(/^#.*\n/, '')
      .split('\n---\n')
      .map(text => JSON.parse(text));
    const deployments = manifests.filter(resource => resource.kind === 'Deployment');
    for (const name of [
      'prometheus',
      'grafana',
      'loki',
      'alertmanager',
      'otel-collector',
      'jaeger',
    ])
      expect(deployments.some(resource => resource.metadata.name === name)).toBe(true);
    for (const name of ['prometheus', 'grafana', 'loki', 'alertmanager']) {
      const deployment = deployments.find(resource => resource.metadata.name === name);
      expect(
        deployment.spec.template.spec.volumes.some(
          (volume: { persistentVolumeClaim?: object }) => volume.persistentVolumeClaim
        )
      ).toBe(true);
      expect(
        manifests.some(
          resource =>
            resource.kind === 'PersistentVolumeClaim' && resource.metadata.name === `${name}-data`
        )
      ).toBe(true);
    }
    const collector = deployments.find(resource => resource.metadata.name === 'otel-collector');
    expect(
      collector.spec.template.spec.volumes.some(
        (volume: { configMap?: { name: string } }) => volume.configMap?.name === 'otel-config'
      )
    ).toBe(true);
  });
  function mockStack() {
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      const path = new URL(url).pathname;
      let status = 200;
      let data: unknown = {};
      if (path === '/api/auth/login') data = { token: 'smoke-token' };
      else if (path === '/api/incidents') {
        if (!request.headers || !(request.headers as Record<string, string>)['authorization'])
          status = 401;
        else if (deps.before) {
          deps.before = false;
          data = [];
        } else data = [{ id: 'INC-1', status: 'DETECTED', affected_services: ['payment-service'] }];
      } else if (path === '/api/failures/db_latency' && String(request.body).includes('99999'))
        status = 400;
      else if (path === '/api/incidents/INC-1/remediate')
        data = {
          actions: [
            { id: 'action-a', type: 'clear_injected_fault', targetService: 'payment-service' },
          ],
        };
      else if (path === '/api/remediation/action-a/approve')
        status = ++deps.approvals === 1 ? 202 : 409;
      else if (path === '/api/incidents/INC-1')
        data = {
          status: deps.approvals > 0 ? 'RESOLVED' : 'DETECTED',
          anomalies: [
            {
              service_id: 'payment-service',
              metric: 'db_query_latency_ms',
              value: 2000,
              created_at: new Date().toISOString(),
            },
          ],
          remediation: [
            {
              id: 'action-a',
              status: deps.failedExecution ? 'FAILED' : 'EXECUTED',
              result: { detail: 'test outcome' },
            },
          ],
        };
      return { status, json: async () => data };
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  it('orchestrates authenticated approval, distinct recovery and cleanup using the documented API contract', async () => {
    const fetch = mockStack();
    await import('./stack-smoke.mjs');
    expect(deps.delay).toHaveBeenCalledWith(80000);
    expect(deps.approvals).toBe(2);
    expect(fetch.mock.calls.some(call => String(call[0]).endsWith('/postmortem'))).toBe(true);
    expect(fetch.mock.calls.at(-1)?.[1].method).toBe('DELETE');
    expect(fetch.mock.calls.at(-1)?.[0]).toContain('?type=db_latency');
  });
  it('cleans up its scoped fault when execution fails and never claims workflow success', async () => {
    deps.failedExecution = true;
    const fetch = mockStack();
    await expect(import('./stack-smoke.mjs')).rejects.toThrow('Execution failed');
    expect(fetch.mock.calls.at(-1)?.[1].method).toBe('DELETE');
    expect(fetch.mock.calls.some(call => String(call[0]).endsWith('/postmortem'))).toBe(false);
  });
});
