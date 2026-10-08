/**
 * Idempotency store. Consumers record processed `eventId`s so a redelivered
 * message (at-least-once delivery) is a no-op. The interface is injectable so
 * tests use the in-memory store and production uses Redis.
 */
import { Redis } from 'ioredis';

export interface IdempotencyStore {
  /**
   * Atomically mark an event processed. Returns true if this is the FIRST time
   * (caller should process), false if already seen (caller should skip).
   */
  markIfNew(eventId: string): Promise<boolean>;
  close?(): Promise<void>;
}

/** Redis-backed store. Uses SET NX with a TTL so keys self-expire. */
export class RedisIdempotencyStore implements IdempotencyStore {
  private redis: Redis;
  private ttlSeconds: number;
  private prefix: string;

  constructor(opts: {
    url: string;
    ttlSeconds?: number;
    prefix?: string;
    redis?: Redis;
  }) {
    this.redis = opts.redis ?? new Redis(opts.url, { lazyConnect: false });
    this.ttlSeconds = opts.ttlSeconds ?? 6 * 60 * 60; // 6h
    this.prefix = opts.prefix ?? 'idem';
  }

  async markIfNew(eventId: string): Promise<boolean> {
    const key = `${this.prefix}:${eventId}`;
    // NX = only set if absent; EX = expiry. Returns 'OK' if set, null if existed.
    const res = await this.redis.set(key, '1', 'EX', this.ttlSeconds, 'NX');
    return res === 'OK';
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/** In-memory store for tests and single-process fallbacks. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private seen = new Set<string>();

  async markIfNew(eventId: string): Promise<boolean> {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }
}
