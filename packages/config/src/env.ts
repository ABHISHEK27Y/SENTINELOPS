import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env once, from the repo root or process cwd. Never throw if missing —
// containers inject env directly.
loadDotenv();

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z
    .string()
    .default('postgresql://sentinel:sentinel_dev_pw@localhost:5432/sentinelops'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('sentinelops'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAMESPACE: z.string().default('sentinelops'),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1),

  PROMETHEUS_URL: z.string().default('http://localhost:9090'),

  JWT_SECRET: z.string().default('change_me_in_production_dev_only_secret'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  LLM_PROVIDER: z
    .enum(['mock', 'anthropic', 'openai-compatible'])
    .default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-5'),
  EMBEDDINGS_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
  EMBEDDINGS_DIM: z.coerce.number().int().positive().default(384),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse + validate process.env once. Fails fast on invalid config. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Parse a Postgres URL into discrete parts for libraries that need them. */
export function parseDatabaseUrl(url = getEnv().DATABASE_URL) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

export function kafkaBrokers(env = getEnv()): string[] {
  return env.KAFKA_BROKERS.split(',').map((s) => s.trim()).filter(Boolean);
}
