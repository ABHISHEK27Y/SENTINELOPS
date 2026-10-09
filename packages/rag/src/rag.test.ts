import { describe, expect, it } from 'vitest';

import { chunkMarkdown } from './chunker.js';
import { MockEmbedder, cosineSimilarity } from './embeddings.js';
import { InMemoryRetriever, embedChunks } from './retriever.js';

describe('MockEmbedder', () => {
  it('is deterministic and unit-normalized', async () => {
    const e = new MockEmbedder(128);
    const a = await e.embed('database connection pool exhausted');
    const b = await e.embed('database connection pool exhausted');
    expect(a).toEqual(b);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('scores related text higher than unrelated', async () => {
    const e = new MockEmbedder(256);
    const q = await e.embed('postgres connection pool exhausted timeout');
    const related = await e.embed(
      'When the postgres connection pool is exhausted, increase pool size or fix leaks'
    );
    const unrelated = await e.embed('The marketing team scheduled a picnic for Friday afternoon');
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });
});

describe('chunkMarkdown', () => {
  it('splits by heading and preserves the heading as context', () => {
    const md = `# Runbook\n\n## Database\nCheck the pool.\n\n## Redis\nCheck latency.`;
    const chunks = chunkMarkdown(md);
    const headings = chunks.map(c => c.heading);
    expect(headings).toContain('Database');
    expect(headings).toContain('Redis');
    const db = chunks.find(c => c.heading === 'Database')!;
    expect(db.content).toMatch(/pool/);
  });
});

describe('InMemoryRetriever', () => {
  it('retrieves the most relevant runbook chunk for an incident query', async () => {
    const embedder = new MockEmbedder(512);
    const raw = [
      {
        id: 'db',
        content:
          'Payment DB troubleshooting: connection pool exhaustion, increase pool size, inspect slow queries.',
      },
      {
        id: 'redis',
        content: 'Redis failures: connection refused, restart cache, check memory eviction policy.',
      },
      {
        id: 'deploy',
        content: 'Deployment guide: rolling updates, health checks, rollback procedure.',
      },
    ];
    const retriever = new InMemoryRetriever(embedder);
    retriever.add(await embedChunks(embedder, raw));

    const results = await retriever.search(
      'payment service database connection pool exhausted, high latency',
      2
    );
    expect(results[0]!.id).toBe('db');
    expect(results.length).toBe(2);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });
});
