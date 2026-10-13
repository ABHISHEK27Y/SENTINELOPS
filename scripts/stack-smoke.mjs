import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Run only against the isolated demo stack with its traffic-generator.
const base = process.env.SENTINELOPS_SMOKE_URL ?? 'http://localhost:4000';
const auth = { token: null };
async function request(path, method = 'GET', body, expected = 200) {
  const response = await globalThis.fetch(`${base}${path}`, {
    method,
    signal: globalThis.AbortSignal.timeout(10000),
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
async function until(label, work, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await work();
    if (result) return result;
    await delay(5000);
  }
  throw new Error(`Timed out: ${label}`);
}
await request('/api/ready');
await request('/api/incidents', 'GET', undefined, 401);
auth.token = (
  await request('/api/auth/login', 'POST', {
    email: 'engineer@sentinelops.dev',
    password: 'engineer123',
  })
).token;
await request(
  '/api/failures/db_latency',
  'POST',
  { service: 'payment-service', params: { targetMs: 99999 } },
  400
);
console.info('Authentication and validation passed; collecting healthy baseline for 80 seconds.');
await request('/api/failures/payment-service?type=db_latency', 'DELETE');
await delay(80000);
try {
  const injectedAt = Date.now();
  await request('/api/failures/db_latency', 'POST', {
    service: 'payment-service',
    params: { targetMs: 2000, ttlMs: 600000 },
  });
  const incident = await until('payment incident with fresh fault evidence', async () => {
    const candidates = (await request('/api/incidents')).filter(
      i => i.status === 'DETECTED' && i.affected_services.includes('payment-service')
    );
    for (const candidate of candidates) {
      const details = await request(`/api/incidents/${candidate.id}`);
      if (
        details.anomalies.some(
          a =>
            a.service_id === 'payment-service' &&
            a.metric === 'db_query_latency_ms' &&
            a.value >= 1000 &&
            Date.parse(a.created_at) >= injectedAt
        )
      )
        return candidate;
    }
    return null;
  });
  console.info(`Detected incident ${incident.id}; investigating and proposing remediation.`);
  await request(`/api/incidents/${incident.id}/investigate`, 'POST', {});
  const proposal = await request(`/api/incidents/${incident.id}/remediate`, 'POST', {});
  const action = proposal.actions.find(
    a => a.type === 'clear_injected_fault' && a.targetService === 'payment-service'
  );
  assert.ok(action, 'Expected an explicitly scoped demo fault-clear action');
  await request(`/api/remediation/${action.id}/approve`, 'POST', {}, 202);
  await request(`/api/remediation/${action.id}/approve`, 'POST', {}, 409);
  console.info('Approval accepted and duplicate rejected; waiting for verified recovery.');
  await until(
    'fresh verified recovery',
    async () => {
      const current = await request(`/api/incidents/${incident.id}`);
      const executed = current.remediation.find(a => a.id === action.id);
      if (executed?.status === 'FAILED')
        throw new Error(`Execution failed: ${JSON.stringify(executed.result)}`);
      return current.status === 'RESOLVED';
    },
    180000
  );
  await request(`/api/incidents/${incident.id}/postmortem`, 'POST', {});
  console.info('Full fault-to-postmortem workflow passed.');
} catch (error) {
  console.error('Fault-to-postmortem workflow failed:', error);
  throw error;
} finally {
  await request('/api/failures/payment-service?type=db_latency', 'DELETE');
}
