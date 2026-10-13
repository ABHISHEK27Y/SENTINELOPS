import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  responses: {} as Record<string, object>,
  role: 'ENGINEER',
  token: 'token',
  id: 'INC-1',
  flow: null as null | {
    nodes: Array<{ data: { label: string }; style: { border: string } }>;
    edges: unknown[];
  },
}));
vi.mock('@/lib/useApi', () => ({
  useApi: (path: string) => ({
    data: null,
    error: null,
    loading: false,
    stale: false,
    updatedAt: null,
    reload: vi.fn(),
    ...state.responses[path],
  }),
}));
vi.mock('@/lib/store', () => ({
  useAuth: (selector?: (auth: object) => unknown) => {
    const auth = {
      token: state.token,
      user: { name: 'Test Operator', role: state.role },
      hydrated: true,
      hydrate: vi.fn(),
      logout: vi.fn(),
    };
    return selector ? selector(auth) : auth;
  },
  canApprove: (user: { role: string }) => ['ENGINEER', 'ADMIN'].includes(user.role),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useParams: () => ({ id: state.id }),
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children),
}));
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: NonNullable<typeof state.flow>) => {
    state.flow = props;
    return createElement('div', {}, props.nodes.map(n => n.data.label).join(', '));
  },
  Background: () => null,
  Controls: () => null,
}));
import Architecture from './architecture/page';
import Dashboard from './dashboard/page';
import Failures from './failures/page';
import IncidentDetail from './incidents/[id]/page';
import Incidents from './incidents/page';
import Login from './login/page';
import Runbooks from './runbooks/page';
import ServiceDetail from './services/[id]/page';
import Services from './services/page';

const service = {
  id: 'payment-service',
  displayName: 'Payment Service',
  tier: 'application',
  health: 'UNKNOWN',
  activeIncidents: 0,
};
const incident = {
  id: 'INC-1',
  title: 'Payment degraded',
  status: 'DETECTED',
  severity: 'HIGH',
  affected_services: ['payment-service'],
  confidence: 0.8,
  detected_at: '2026-10-10T10:00:00Z',
  started_at: '2026-10-10T10:00:00Z',
  root_cause: { title: 'Database latency' },
  timeline: [],
  anomalies: [],
  remediation: [],
  postmortem: null,
};
const html = (component: () => ReactNode) => renderToStaticMarkup(createElement(component));
beforeEach(() => {
  state.responses = {};
  state.role = 'ENGINEER';
  state.token = 'token';
  state.id = 'INC-1';
  state.flow = null;
});
describe('dashboard presentation and permissions', () => {
  it('distinguishes unavailable, loading and empty incident states', () => {
    state.responses['/api/incidents'] = { loading: true };
    expect(html(Dashboard)).toContain('Loading incidents');
    state.responses['/api/incidents'] = { error: 'offline' };
    expect(html(Dashboard)).toContain('Incident status unavailable');
    expect(html(Dashboard)).toContain('Live updates unavailable');
    state.responses['/api/incidents'] = { data: [] };
    expect(html(Dashboard)).toContain('No active incidents recorded');
  });
  it('shows active incidents and missing telemetry without claiming fleet health', () => {
    state.responses['/api/services'] = { data: [service], stale: true, updatedAt: Date.now() };
    state.responses['/api/incidents'] = {
      data: [incident, { ...incident, id: 'INC-2', status: 'RESOLVED' }],
      updatedAt: Date.now(),
    };
    const rendered = html(Dashboard);
    expect(rendered).toContain('UNKNOWN');
    expect(rendered).toContain('0/1');
    expect(rendered).toContain('INC-1');
    expect(rendered).not.toContain('INC-2');
    expect(rendered).toContain('Services last updated');
    expect(rendered).toContain('Incidents last updated');
  });
  it('renders service and incident rows with links and confidence', () => {
    state.responses['/api/services'] = { data: [service] };
    state.responses['/api/incidents'] = {
      data: [incident, { ...incident, id: 'INC-2', confidence: null }],
    };
    expect(html(Services)).toContain('/services/payment-service');
    expect(html(Services)).toContain('UNKNOWN');
    expect(html(Incidents)).toContain('/incidents/INC-1');
    expect(html(Incidents)).toContain('80%');
  });
  it('renders failure status as incomplete when a service cannot be reached', () => {
    state.responses['/api/failures'] = {
      data: [{ service: 'payment-service', faults: [], unreachable: true }],
    };
    expect(html(Failures)).toContain('Fault status incomplete');
    expect(html(Failures)).not.toContain('running clean');
    state.responses['/api/failures'] = { loading: true };
    expect(html(Failures)).toContain('Loading faults');
  });
  it('disables viewer injection and approval controls', () => {
    state.role = 'VIEWER';
    state.responses['/api/failures'] = {
      data: [{ service: 'payment-service', faults: [{ type: 'db_latency' }] }],
    };
    expect(html(Failures).match(/disabled=""/g)).toHaveLength(7);
    state.responses['/api/incidents/INC-1'] = {
      data: {
        ...incident,
        remediation: [
          {
            id: 'a',
            type: 'clear_injected_fault',
            target_service: 'payment-service',
            risk: 'LOW',
            status: 'PROPOSED',
            rationale: 'clear fault',
          },
        ],
      },
    };
    const rendered = html(IncidentDetail);
    expect(rendered).toContain('Requires ENGINEER/ADMIN approval');
    expect(rendered).not.toContain('Propose remediation');
    expect(rendered).toContain('disabled=""');
  });
  it('shows engineers evidence, approval actions and resolved postmortems', () => {
    state.responses['/api/incidents/INC-1'] = {
      stale: true,
      data: {
        ...incident,
        status: 'RESOLVED',
        anomalies: [
          { service_id: 'payment-service', metric: 'latency', value: 2500, baseline: 30 },
        ],
        timeline: [
          {
            at: incident.started_at,
            kind: 'ai_investigation',
            message: 'Investigated',
            data: {
              summary: 'Evidence summary',
              probableRootCause: 'Database latency',
              evidence: ['2500 ms'],
              alternativeHypotheses: ['Traffic surge'],
            },
          },
        ],
        remediation: [
          {
            id: 'a',
            type: 'clear_injected_fault',
            target_service: 'payment-service',
            risk: 'LOW',
            status: 'PROPOSED',
            rationale: 'clear fault',
          },
        ],
        postmortem: { content_md: '# Resolved payment' },
      },
    };
    const rendered = html(IncidentDetail);
    for (const text of [
      'Approve',
      'Reject',
      'Generate postmortem',
      'Evidence summary',
      '2500 ms',
      'Traffic surge',
      '# Resolved payment',
      'stale',
    ])
      expect(rendered).toContain(text);
  });
  it('shows incident fetch errors instead of an endless loading message', () => {
    state.responses['/api/incidents/INC-1'] = { error: 'unknown incident' };
    expect(html(IncidentDetail)).toContain('unknown incident');
  });
  it('renders dependency and service evidence with explicit empty states', () => {
    state.id = 'payment-service';
    state.responses['/api/services/payment-service'] = {
      data: { ...service, dependsOn: [], dependedOnBy: [], metrics: [], logs: [], anomalies: [] },
    };
    expect(html(ServiceDetail)).toContain('No samples yet');
    expect(html(ServiceDetail)).toContain('No logs');
    state.responses['/api/services/payment-service'] = {
      data: {
        ...service,
        dependsOn: ['postgres'],
        dependedOnBy: ['order-service'],
        metrics: [{ metric: 'latency', value: 2500 }],
        logs: [{ level: 'ERROR', message: 'pool timeout', ts: incident.started_at }],
        anomalies: [{ metric: 'latency', severity: 'HIGH' }],
      },
    };
    expect(html(ServiceDetail)).toContain('2500.00');
    expect(html(ServiceDetail)).toContain('pool timeout');
    expect(html(ServiceDetail)).toContain('postgres');
  });
  it('maps dependency health and incident counts into graph nodes', () => {
    state.responses['/api/dependencies'] = {
      data: {
        nodes: [
          {
            id: 'payment',
            label: 'Payment',
            tier: 'application',
            health: 'UNHEALTHY',
            activeIncidents: 2,
          },
          { id: 'db', label: 'DB', tier: 'data', health: 'UNKNOWN', activeIncidents: 0 },
        ],
        edges: [{ source: 'payment', target: 'db' }],
      },
    };
    expect(html(Architecture)).toContain('Payment ⚠2');
    expect(state.flow?.edges).toHaveLength(1);
    expect(state.flow?.nodes[0]?.style.border).toContain('#f85149');
  });
  it('protects unauthenticated pages and renders login and runbook entry points', () => {
    expect(html(Runbooks)).toContain('Database Troubleshooting');
    expect(html(Login)).toContain('type="password"');
    state.token = '';
    expect(html(Dashboard)).not.toContain('System Overview');
    expect(html(Dashboard)).toContain('Loading');
  });
});
