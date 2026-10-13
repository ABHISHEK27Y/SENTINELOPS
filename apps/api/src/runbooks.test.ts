import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const corpus = vi.hoisted(() => ({
  exists: vi.fn(),
  files: vi.fn(),
  read: vi.fn(),
  index: vi.fn(),
  sources: [] as string[],
}));
vi.mock('node:fs', () => ({
  existsSync: corpus.exists,
  readdirSync: corpus.files,
  readFileSync: corpus.read,
}));
vi.mock('@sentinelops/config', () => ({ getEnv: () => ({ EMBEDDINGS_PROVIDER: 'mock' }) }));
vi.mock('@sentinelops/rag', () => ({
  getEmbedder: () => ({ dimensions: 384 }),
  chunkMarkdown: (content: string) => [{ heading: 'Recovery evidence', content }],
  PostgresRetriever: class {
    index = corpus.index;
    constructor(_embedder: object, provider: string) {
      corpus.sources.push(provider);
    }
  },
}));
import { buildRunbookRetriever } from './runbooks.js';

beforeEach(() => {
  vi.resetAllMocks();
  corpus.sources = [];
  corpus.exists.mockReturnValue(true);
  corpus.files.mockReturnValue(['db-latency.md', 'readme.txt']);
  corpus.read.mockReturnValue('Observe healthy latency');
  corpus.index.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('runbook corpus initialization', () => {
  it('indexes Markdown with readable titles, newline-separated headings and stable provider identities', async () => {
    await buildRunbookRetriever();
    expect(corpus.sources).toEqual(['mock']);
    expect(corpus.index).toHaveBeenCalledWith('mock:db-latency.md', 'db latency', [
      {
        content: 'Recovery evidence\nObserve healthy latency',
        metadata: { file: 'db-latency.md', title: 'db latency', heading: 'Recovery evidence' },
      },
    ]);
    expect(corpus.read).toHaveBeenCalledOnce();
  });
  it('honors an explicit corpus directory without scanning unrelated files', async () => {
    vi.stubEnv('RUNBOOKS_DIR', 'custom-corpus');
    await buildRunbookRetriever();
    expect(corpus.files).toHaveBeenCalledWith('custom-corpus');
  });
  it('allows an absent optional corpus to return an empty retriever', async () => {
    corpus.exists.mockReturnValue(false);
    await expect(buildRunbookRetriever()).resolves.toBeDefined();
    expect(corpus.index).not.toHaveBeenCalled();
    expect(corpus.files).not.toHaveBeenCalled();
  });
  it('propagates persistence failure so startup cannot claim a ready retrieval index', async () => {
    corpus.index.mockRejectedValue(new Error('vector store unavailable'));
    await expect(buildRunbookRetriever()).rejects.toThrow('vector store unavailable');
  });
});
