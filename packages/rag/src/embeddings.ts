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
  if (env.EMBEDDINGS_PROVIDER === 'openai-compatible') {
    if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL)
      throw new Error('embedding provider requires API key and base URL');
    return new OpenAiEmbedder(env.EMBEDDINGS_DIM, env.OPENAI_API_KEY, env.OPENAI_BASE_URL);
  }
  return new MockEmbedder(env.EMBEDDINGS_DIM);
}

export class OpenAiEmbedder implements Embedder {
  constructor(
    readonly dim: number,
    private key: string,
    private baseUrl: string
  ) {}
  async embed(text: string): Promise<number[]> {
    return (await this.embedBatch([text]))[0]!;
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', dimensions: this.dim, input: texts }),
    });
    if (!res.ok) throw new Error(`embedding provider ${res.status}`);
    const data = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    const ordered = data.data.sort((a, b) => a.index - b.index);
    if (ordered.length !== texts.length) throw new Error('incomplete embeddings');
    if (ordered.some((item, index) => item.index !== index))
      throw new Error('invalid embedding indexes');
    return ordered.map(({ embedding }) => {
      if (embedding.length !== this.dim || embedding.some(x => !Number.isFinite(x)))
        throw new Error('invalid embedding dimensions/values');
      const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
      if (!norm) throw new Error('zero embedding');
      return embedding.map(x => x / norm);
    });
  }
}
