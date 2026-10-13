import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAiEmbedder } from './embeddings.js';

afterEach(() => vi.unstubAllGlobals());
describe('remote embedding validation', () => {
  it('orders provider results and normalizes each vector', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0, 4] },
          { index: 0, embedding: [3, 0] },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new OpenAiEmbedder(2, 'test-key', 'https://provider.example/');
    expect(await provider.embedBatch(['pool', 'cache'])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://provider.example/embeddings');
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({
      dimensions: 2,
      input: ['pool', 'cache'],
    });
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
  it('skips empty batches and propagates provider failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    const provider = new OpenAiEmbedder(2, 'test-key', 'https://provider.example');
    expect(await provider.embedBatch([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    await expect(provider.embed('pool')).rejects.toThrow('503');
  });
  it.each([
    { data: [], error: 'incomplete' },
    { data: [{ index: 1, embedding: [1, 0] }], error: 'indexes' },
    { data: [{ index: 0, embedding: [1] }], error: 'dimensions' },
    { data: [{ index: 0, embedding: [NaN, 1] }], error: 'values' },
    { data: [{ index: 0, embedding: [0, 0] }], error: 'zero' },
  ])('rejects malformed responses: $error', async ({ data, error }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }));
    await expect(
      new OpenAiEmbedder(2, 'key', 'https://provider.example').embed('pool')
    ).rejects.toThrow(error);
  });
});
