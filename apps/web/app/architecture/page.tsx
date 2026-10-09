'use client';
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Shell } from '@/components/Shell';
import { useApi } from '@/lib/useApi';

interface Graph {
  nodes: { id: string; label: string; tier: string; health: string; activeIncidents: number }[];
  edges: { source: string; target: string }[];
}

const TIER_X: Record<string, number> = { edge: 0, application: 260, data: 560, control: 820 };
const HEALTH_COLOR: Record<string, string> = {
  HEALTHY: '#3fb950',
  DEGRADED: '#d29922',
  UNHEALTHY: '#f85149',
  UNKNOWN: '#8b95a7',
};

export default function ArchitecturePage() {
  const { data } = useApi<Graph>('/api/dependencies', 4000);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const tierCounts: Record<string, number> = {};
    const nodes: Node[] = data.nodes.map(n => {
      const y = (tierCounts[n.tier] = (tierCounts[n.tier] ?? 0) + 1);
      return {
        id: n.id,
        position: { x: TIER_X[n.tier] ?? 0, y: y * 90 },
        data: { label: `${n.label}${n.activeIncidents ? ` ⚠${n.activeIncidents}` : ''}` },
        style: {
          background: '#12161f',
          color: '#e6e9ef',
          border: `2px solid ${HEALTH_COLOR[n.health] ?? '#8b95a7'}`,
          borderRadius: 8,
          fontSize: 12,
          width: 170,
          padding: 6,
        },
      };
    });
    const edges: Edge[] = data.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: '#232936' },
    }));
    return { nodes, edges };
  }, [data]);

  return (
    <Shell>
      <h1 className="text-xl font-semibold mb-1">Service Dependency Graph</h1>
      <p className="text-muted text-sm mb-4">Node border = health. Edges follow call direction.</p>
      <div className="card p-0" style={{ height: '70vh' }}>
        <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
          <Background color="#232936" gap={20} />
          <Controls />
        </ReactFlow>
      </div>
    </Shell>
  );
}
