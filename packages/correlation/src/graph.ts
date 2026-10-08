/**
 * Service dependency graph. Directed edges (from → to) capture "calls"
 * relationships; correlation treats the graph as undirected reachability so a
 * database problem can be linked to the services that depend on it.
 */
export interface Edge {
  from: string;
  to: string;
}

export class DependencyGraph {
  private adj = new Map<string, Set<string>>();

  constructor(edges: Edge[] = []) {
    for (const e of edges) this.addEdge(e.from, e.to);
  }

  addEdge(from: string, to: string): void {
    this.node(from).add(to);
    this.node(to).add(from); // undirected view for correlation
  }

  private node(id: string): Set<string> {
    let s = this.adj.get(id);
    if (!s) {
      s = new Set();
      this.adj.set(id, s);
    }
    return s;
  }

  neighbors(id: string): string[] {
    return [...(this.adj.get(id) ?? [])];
  }

  has(id: string): boolean {
    return this.adj.has(id);
  }

  /** True if `a` and `b` are the same or reachable within `maxHops`. */
  related(a: string, b: string, maxHops = 2): boolean {
    if (a === b) return true;
    if (!this.adj.has(a) || !this.adj.has(b)) return false;
    const visited = new Set<string>([a]);
    let frontier = [a];
    for (let hop = 0; hop < maxHops; hop++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const nb of this.adj.get(node) ?? []) {
          if (nb === b) return true;
          if (!visited.has(nb)) {
            visited.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return false;
  }
}
