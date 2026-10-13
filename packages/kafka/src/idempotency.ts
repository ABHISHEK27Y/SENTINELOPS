/**
 * Idempotency store. Consumers record processed `eventId`s so a redelivered
 * message (at-least-once delivery) is a no-op. The interface is injectable so
 * tests use the in-memory store and production uses Redis.
 */
import { Redis } from 'ioredis';

export interface IdempotencyStore {
  hasProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
  close?(): Promise<void>;
}

/** Redis-backed store. Uses SET NX with a TTL so keys self-expire. */
export class RedisIdempotencyStore implements IdempotencyStore {
  private redis: Redis;
  private ttlSeconds: number;
  private prefix: string;

  constructor(opts: { url: string; ttlSeconds?: number; prefix?: string; redis?: Redis }) {
    this.redis = opts.redis ?? new Redis(opts.url, { lazyConnect: false });
    this.ttlSeconds = opts.ttlSeconds ?? 6 * 60 * 60; // 6h
    this.prefix = opts.prefix ?? 'idem';
  }

  async hasProcessed(eventId: string): Promise<boolean> {
    return (await this.redis.exists(`${this.prefix}:${eventId}`)) === 1;
  }

  async markProcessed(eventId: string): Promise<void> {
    const key = `${this.prefix}:${eventId}`;
    // NX = only set if absent; EX = expiry. Returns 'OK' if set, null if existed.
    await this.redis.set(key, '1', 'EX', this.ttlSeconds);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/** In-memory store for tests and single-process fallbacks. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private seen = new Map<string, number>();

  async hasProcessed(eventId: string): Promise<boolean> {
    const now = Date.now();
    for (const [id, expiry] of this.seen) if (expiry <= now) this.seen.delete(id);
    return this.seen.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.seen.set(eventId, Date.now() + 6 * 60 * 60 * 1000);
  }
}
