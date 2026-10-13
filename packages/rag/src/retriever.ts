import { query, transaction } from '@sentinelops/db';

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
  metadata?: Record<string, unknown> | undefined;
}

export interface Retriever {
  size(): number;
  search(query: string, k?: number): Promise<RetrievalResult[]>;
}

/** Durable vector store, separated by embedding provider to avoid mixed spaces. */
export class PostgresRetriever implements Retriever {
  private indexedSources = new Map<string, number>();
  constructor(
    private embedder: Embedder,
    private provider: string
  ) {
    if (embedder.dim !== 384)
      throw new Error('persistent RAG schema requires 384 embedding dimensions');
  }
  size(): number {
    return [...this.indexedSources.values()].reduce((sum, count) => sum + count, 0);
  }
  async index(
    source: string,
    title: string,
    chunks: Array<{ content: string; metadata: Record<string, unknown> }>
  ): Promise<void> {
    const embeddings = await this.embedder.embedBatch(chunks.map(c => c.content));
    if (embeddings.length !== chunks.length) throw new Error('incomplete embeddings');
    for (const embedding of embeddings) this.validateEmbedding(embedding);
    await transaction(async () => {
      await query('SELECT pg_advisory_xact_lock(7349203)');
      const document = (
        await query<{ id: string }>(
          `INSERT INTO documents(source_path,title,content_md) VALUES($1,$2,$3)
        ON CONFLICT(source_path) DO UPDATE SET title=EXCLUDED.title,content_md=EXCLUDED.content_md RETURNING id`,
          [source, title, chunks.map(c => c.content).join('\n')]
        )
      ).rows[0]!;
      await query('DELETE FROM document_chunks WHERE document_id=$1', [document.id]);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        await query(
          'INSERT INTO document_chunks(document_id,chunk_index,content,embedding,metadata) VALUES($1,$2,$3,$4::vector,$5)',
          [
            document.id,
            i,
            chunk.content,
            JSON.stringify(embeddings[i]),
            JSON.stringify({ ...chunk.metadata, title, provider: this.provider }),
          ]
        );
      }
    });
    this.indexedSources.set(source, chunks.length);
  }
  private validateEmbedding(embedding: number[]): void {
    if (
      embedding.length !== this.embedder.dim ||
      embedding.some(value => !Number.isFinite(value)) ||
      !embedding.some(value => value !== 0)
    )
      throw new Error('invalid persistent embedding');
  }
  async search(text: string, k = 3): Promise<RetrievalResult[]> {
    const embedding = await this.embedder.embed(text);
    this.validateEmbedding(embedding);
    const { rows } = await query<{
      id: string;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }>(
      "SELECT id,content,metadata,1-(embedding <=> $1::vector) AS score FROM document_chunks WHERE metadata->>'provider'=$2 ORDER BY embedding <=> $1::vector LIMIT $3",
      [
        JSON.stringify(embedding),
        this.provider,
        Number.isFinite(k) ? Math.min(Math.max(Math.trunc(k), 1), 20) : 3,
      ]
    );
    return rows;
  }
}

/**
 * In-memory vector retriever. The production path stores/queries these vectors
 * in pgvector (HNSW, cosine), but the ranking logic is identical and unit-
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
      .map(c => ({
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
  raw: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>
): Promise<EmbeddedChunk[]> {
  const embeddings = await embedder.embedBatch(raw.map(r => r.content));
  return raw.map((r, i) => ({ ...r, embedding: embeddings[i]! }));
}
