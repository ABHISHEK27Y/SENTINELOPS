import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  LLM_PROVIDER: 'mock',
  LLM_MODEL: '',
  ANTHROPIC_API_KEY: '',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: '',
}));
vi.mock('@sentinelops/config', () => ({ getEnv: () => env }));
import { getLlmProvider, OpenAiCompatibleProvider } from './provider.js';
afterEach(() => {
  vi.unstubAllGlobals();
  env.LLM_PROVIDER = 'mock';
  env.LLM_MODEL = '';
});
describe('explicit provider selection', () => {
  it('uses mock only when explicitly selected', () => {
    expect(getLlmProvider().name).toBe('mock');
    env.LLM_PROVIDER = 'anthropic';
    expect(() => getLlmProvider()).toThrow('explicit model');
    env.LLM_PROVIDER = 'openai-compatible';
    expect(() => getLlmProvider()).toThrow('explicit model');
  });
  it('passes remote failures to the grounded investigation fallback', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    const provider = new OpenAiCompatibleProvider(
      'test-key',
      'https://provider.example/',
      'configured-model'
    );
    await expect(provider.complete([{ role: 'user', content: 'select evidence' }])).rejects.toThrow(
      '503'
    );
    expect(fetch.mock.calls[0]?.[0]).toBe('https://provider.example/chat/completions');
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});
