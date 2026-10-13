import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@sentinelops/db', () => db);
import type { Embedder } from './embeddings.js';
import { PostgresRetriever } from './retriever.js';

const vector = [1, ...Array<number>(383).fill(0)];
function embedder(): Embedder {
  return {
    dim: 384,
    embed: vi.fn().mockResolvedValue(vector),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => texts.map(() => vector)),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (work: () => Promise<unknown>) => work());
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('RETURNING id') ? [{ id: 'doc-a' }] : [],
  }));
});
describe('persistent retrieval boundaries', () => {
  it('replaces a document under a transaction lock and preserves trusted provider metadata', async () => {
    const store = new PostgresRetriever(embedder(), 'mock');
    await store.index('mock:pool.md', 'Pool', [
      { content: 'inspect pool', metadata: { provider: 'other', heading: 'Steps' } },
    ]);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    const insert = db.query.mock.calls.find(call =>
      String(call[0]).includes('INSERT INTO document_chunks')
    );
    expect(insert?.[1].slice(0, 3)).toEqual(['doc-a', 0, 'inspect pool']);
    expect(JSON.parse(insert?.[1][4])).toEqual({
      provider: 'mock',
      title: 'Pool',
      heading: 'Steps',
    });
    await store.index('mock:pool.md', 'Pool', []);
    expect(store.size()).toBe(0);
  });
  it('does not update its count when persistence fails', async () => {
    const store = new PostgresRetriever(embedder(), 'mock');
    db.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      store.index('mock:pool.md', 'Pool', [{ content: 'pool', metadata: {} }])
    ).rejects.toThrow('unavailable');
    expect(store.size()).toBe(0);
  });
  it('rejects malformed embeddings before replacing persisted chunks', async () => {
    for (const vectors of [[], [[1]], [Array(384).fill(NaN)], [Array(384).fill(0)]]) {
      const provider = embedder();
      vi.mocked(provider.embedBatch).mockResolvedValue(vectors);
      await expect(
        new PostgresRetriever(provider, 'mock').index('source', 'title', [
          { content: 'pool', metadata: {} },
        ])
      ).rejects.toThrow();
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('scopes cosine search by provider and bounds finite integer result limits', async () => {
    const store = new PostgresRetriever(embedder(), 'configured-provider');
    for (const [input, expected] of [
      [100, 20],
      [0, 1],
      [2.9, 2],
      [NaN, 3],
    ]) {
      await store.search('pool', input);
      const call = db.query.mock.calls.at(-1)!;
      expect(call[0]).toContain("metadata->>'provider'=$2");
      expect(call[1]).toEqual([JSON.stringify(vector), 'configured-provider', expected]);
    }
  });
  it('rejects incompatible schema dimensions and invalid query vectors', async () => {
    expect(() => new PostgresRetriever({ ...embedder(), dim: 128 }, 'mock')).toThrow('384');
    const provider = embedder();
    vi.mocked(provider.embed).mockResolvedValue([Infinity]);
    await expect(new PostgresRetriever(provider, 'mock').search('pool')).rejects.toThrow(
      'invalid persistent'
    );
    expect(db.query).not.toHaveBeenCalled();
  });
});
