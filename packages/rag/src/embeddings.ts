import { getEnv } from '@sentinelops/config';

/** Text → vector. Implementations must return unit-normalized vectors. */
export interface Embedder {
  readonly dim: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** FNV-1a 32-bit string hash — deterministic across runs and platforms. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic, dependency-free embedder using the feature-hashing trick with
 * signed buckets. Texts sharing tokens get similar vectors, so cosine similarity
 * reflects keyword/topical overlap — good enough to retrieve the right runbook,
 * and it needs no API key (the default provider). Swap for a real embedding API
 * via EMBEDDINGS_PROVIDER without touching callers.
 */
export class MockEmbedder implements Embedder {
  constructor(readonly dim: number) {}

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) {
      const idx = fnv1a(tok) % this.dim;
      const sign = fnv1a(tok + '#sign') & 1 ? 1 : -1;
      v[idx]! += sign;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / norm);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

/** Cosine similarity. Inputs are expected unit-normalized (so this is a dot). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

/** Factory honoring EMBEDDINGS_PROVIDER; falls back to the mock embedder. */
export function getEmbedder(): Embedder {
  const env = getEnv();
  // 'openai-compatible' would fetch from an embeddings API here; until wired,
  // fall back to the deterministic mock so the system always runs.
  return new MockEmbedder(env.EMBEDDINGS_DIM);
}
