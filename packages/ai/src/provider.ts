import { getEnv } from '@sentinelops/config';

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

/** Minimal LLM abstraction. Implementations must be swappable via env. */
export interface LlmProvider {
  readonly name: string;
  complete(messages: LlmMessage[]): Promise<string>;
}

/**
 * Deterministic, no-network provider used by default (LLM_PROVIDER=mock). It does
 * NOT hallucinate: it echoes a grounded summary assembled from the structured
 * context the caller embeds in the user message (between <context> tags). This
 * lets the whole system run with no API key while keeping every claim tied to
 * provided evidence.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  async complete(messages: LlmMessage[]): Promise<string> {
    const user = messages.find(m => m.role === 'user')?.content ?? '';
    const ctx = /<summary>([\s\S]*?)<\/summary>/.exec(user)?.[1]?.trim();
    return ctx ?? 'No summary context provided.';
  }
}

/** Anthropic Messages API provider (used when ANTHROPIC_API_KEY is set). */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(
    private apiKey: string,
    private model: string
  ) {}
  async complete(messages: LlmMessage[]): Promise<string> {
    const system = messages.find(m => m.role === 'system')?.content;
    const user = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data.content?.map(c => c.text ?? '').join('') ?? '';
  }
}

/** OpenAI-compatible chat completions provider (OPENAI_API_KEY + OPENAI_BASE_URL). */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string
  ) {}
  async complete(messages: LlmMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages }),
    });
    if (!res.ok) throw new Error(`openai-compatible ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/** Select a provider from env; always falls back to the mock. */
export function getLlmProvider(): LlmProvider {
  const env = getEnv();
  if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.LLM_MODEL);
  }
  if (env.LLM_PROVIDER === 'openai-compatible' && env.OPENAI_API_KEY && env.OPENAI_BASE_URL) {
    return new OpenAiCompatibleProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL, env.LLM_MODEL);
  }
  return new MockProvider();
}
