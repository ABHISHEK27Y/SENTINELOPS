import { cosineSimilarity, type Embedder } from './embeddings.js';

export interface EmbeddedChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface RetrievalResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * In-memory vector retriever. The production path stores/queries these vectors
 * in pgvector (ivfflat, cosine), but the ranking logic is identical and unit-
 * testable here without a database.
 */
export class InMemoryRetriever {
  private chunks: EmbeddedChunk[] = [];

  constructor(private embedder: Embedder) {}

  add(chunks: EmbeddedChunk[]): void {
    this.chunks.push(...chunks);
  }

  size(): number {
    return this.chunks.length;
  }

  /** Embed the query and return the top-k chunks by cosine similarity. */
  async search(query: string, k = 3): Promise<RetrievalResult[]> {
    const q = await this.embedder.embed(query);
    return this.chunks
      .map((c) => ({
        id: c.id,
        content: c.content,
        score: cosineSimilarity(q, c.embedding),
        metadata: c.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Embed raw {id, content} chunks in one pass. */
export async function embedChunks(
  embedder: Embedder,
  raw: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>,
): Promise<EmbeddedChunk[]> {
  const embeddings = await embedder.embedBatch(raw.map((r) => r.content));
  return raw.map((r, i) => ({ ...r, embedding: embeddings[i]! }));
}
