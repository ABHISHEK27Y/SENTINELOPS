import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

type Selector = {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values: string[] }[];
};
type Peer = { podSelector?: Selector; namespaceSelector?: Selector };
type Rule = { from?: Peer[]; to?: Peer[]; ports?: { port: number; protocol: string }[] };
type Policy = {
  spec: { podSelector: Selector; policyTypes: string[]; ingress?: Rule[]; egress?: Rule[] };
};
const read = (file: string) => readFileSync(file, 'utf8');
const policies = parseAllDocuments(read('infrastructure/kubernetes/07-networkpolicies.yaml')).map(
  doc => doc.toJS() as Policy
);
function matches(selector: Selector, labels: Record<string, string>): boolean {
  return (
    Object.entries(selector.matchLabels ?? {}).every(([key, value]) => labels[key] === value) &&
    (selector.matchExpressions ?? []).every(
      expr => expr.operator === 'In' && expr.values.includes(labels[expr.key]!)
    )
  );
}
function accepts(source: string, namespace: string, target: string, port: number): boolean {
  return policies
    .filter(p => matches(p.spec.podSelector, { app: target }))
    .some(p =>
      p.spec.ingress?.some(
        rule =>
          rule.ports?.some(p => p.port === port && p.protocol === 'TCP') &&
          rule.from?.some(
            peer =>
              (peer.namespaceSelector
                ? matches(peer.namespaceSelector, { 'kubernetes.io/metadata.name': namespace })
                : namespace === 'sentinelops') &&
              (!peer.podSelector || matches(peer.podSelector, { app: source }))
          )
      )
    );
}
describe('Kubernetes isolation contract', () => {
  it('hardens every requested workload and provides its writable directories', () => {
    for (const file of ['02-data.yaml', '04-apps.yaml', '05-web-ingress.yaml']) {
      for (const doc of parseAllDocuments(read(`infrastructure/kubernetes/${file}`))) {
        const resource = doc.toJS();
        if (!['Deployment', 'Job'].includes(resource.kind)) continue;
        const pod = resource.spec.template.spec;
        expect(pod.securityContext).toMatchObject({
          runAsNonRoot: true,
          runAsUser: 1001,
          fsGroup: 1001,
          seccompProfile: { type: 'RuntimeDefault' },
        });
        for (const container of pod.containers) {
          expect(container.securityContext).toEqual({
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ['ALL'] },
          });
          expect(container.volumeMounts).toContainEqual({ name: 'tmp', mountPath: '/tmp' });
          if (resource.metadata.name === 'web')
            expect(container.volumeMounts).toContainEqual({
              name: 'next-cache',
              mountPath: '/app/apps/web/.next/cache',
            });
          if (resource.metadata.name === 'postgres')
            expect(container.volumeMounts).toContainEqual({
              name: 'postgres-run',
              mountPath: '/var/run/postgresql',
            });
        }
        expect(pod.volumes).toContainEqual({ name: 'tmp', emptyDir: {} });
      }
    }
  });
  it('keeps the API and web private to ingress while isolating API metrics', () => {
    expect(accepts('controller', 'ingress-nginx', 'api', 4000)).toBe(true);
    expect(accepts('controller', 'ingress-nginx', 'web', 3000)).toBe(true);
    for (const source of ['prometheus', 'web', 'payment-service', 'untrusted']) {
      expect(accepts(source, 'sentinelops', 'api', 4000)).toBe(false);
      expect(accepts(source, 'sentinelops', 'web', 3000)).toBe(false);
    }
    expect(accepts('prometheus', 'sentinelops', 'api', 4001)).toBe(true);
    expect(accepts('prometheus', 'other', 'api', 4001)).toBe(false);
    expect(accepts('controller', 'ingress-nginx', 'api', 4001)).toBe(false);
  });
  it('permits backend traffic and monitoring but denies untrusted and cross-namespace callers', () => {
    for (const [source, target, port] of [
      ['api-gateway', 'order-service', 8082],
      ['order-service', 'payment-service', 8083],
      ['api', 'notification-service', 8084],
      ['migrate', 'postgres', 5432],
      ['ingestor', 'kafka', 9092],
      ['anomaly-engine', 'redis', 6379],
      ['prometheus', 'ingestor', 8095],
      ['prometheus', 'alertmanager', 9093],
      ['grafana', 'prometheus', 9090],
      ['api', 'otel-collector', 4318],
      ['otel-collector', 'jaeger', 4317],
      ['otel-collector', 'loki', 3100],
    ] as const) {
      expect(accepts(source, 'sentinelops', target, port)).toBe(true);
      expect(accepts(source, 'other', target, port)).toBe(false);
      expect(accepts('untrusted', 'sentinelops', target, port)).toBe(false);
    }
    expect(accepts('web', 'sentinelops', 'postgres', 5432)).toBe(false);
    expect(accepts('api', 'sentinelops', 'kafka', 9093)).toBe(false);
  });
  it('renders the policies and preserves DNS and the metrics scrape target', () => {
    expect(parse(read('kustomization.yaml')).resources).toContain(
      'infrastructure/kubernetes/07-networkpolicies.yaml'
    );
    expect(policies).toContainEqual(
      expect.objectContaining({ spec: { podSelector: {}, policyTypes: ['Ingress'] } })
    );
    expect(
      policies.some(p =>
        p.spec.egress?.some(
          rule =>
            rule.ports?.some(p => p.port === 53 && p.protocol === 'UDP') &&
            rule.ports?.some(p => p.port === 53 && p.protocol === 'TCP') &&
            rule.to?.some(
              peer =>
                peer.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'] ===
                'kube-system'
            )
        )
      )
    ).toBe(true);
    const config = parse(read('monitoring/prometheus/prometheus.yml'));
    expect(config.scrape_configs).toContainEqual(
      expect.objectContaining({
        job_name: 'sentinelops-api',
        static_configs: [{ targets: ['api:4001'] }],
      })
    );
  });
});
