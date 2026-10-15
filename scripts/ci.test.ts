import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
const source = readFileSync('.github/workflows/ci.yml', 'utf8');
const workflow = parse(source) as { jobs: Record<string, { steps: Step[] }> };
describe('CI security gates', () => {
  it('pins every action to a complete commit with a readable version comment', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
        expect(source.split('\n').find(line => line.includes(step.uses!))).toMatch(/#\s+v?\d/);
      }
    }
  });
  it('fails on fixable high and critical image vulnerabilities', () => {
    const scan = workflow.jobs['docker-build']!.steps.find(step =>
      step.uses?.startsWith('aquasecurity/trivy-action@')
    );
    expect(scan?.with).toMatchObject({
      'exit-code': '1',
      'ignore-unfixed': true,
      severity: 'HIGH,CRITICAL',
    });
  });
  it('audits production dependencies after install and preserves the required coverage gate', () => {
    const steps = workflow.jobs['verify']!.steps;
    const install = steps.findIndex(step => step.run === 'npm ci --no-audit --no-fund');
    const audit = steps.findIndex(step => step.run === 'npm audit --omit=dev --audit-level=high');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(install);
    expect(steps.some(step => step.run === 'npm run test:coverage')).toBe(true);
  });
});
