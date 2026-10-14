import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());
describe('retention configuration', () => {
  it('defaults to 48h metrics, 72h logs and a ten minute interval', async () => {
    vi.resetModules();
    for (const key of ['METRICS_RETENTION_HOURS', 'LOGS_RETENTION_HOURS', 'RETENTION_INTERVAL_MS'])
      vi.stubEnv(key, undefined);
    const { getEnv } = await import('./env.js');
    expect(getEnv()).toMatchObject({
      METRICS_RETENTION_HOURS: 48,
      LOGS_RETENTION_HOURS: 72,
      RETENTION_INTERVAL_MS: 600000,
    });
  });
  it.each([
    ['METRICS_RETENTION_HOURS', '0'],
    ['LOGS_RETENTION_HOURS', '-1'],
    ['METRICS_RETENTION_HOURS', '1.5'],
    ['RETENTION_INTERVAL_MS', '2147483648'],
  ])('rejects invalid %s=%s', async (key, value) => {
    vi.resetModules();
    vi.stubEnv(key, value);
    const { getEnv } = await import('./env.js');
    expect(() => getEnv()).toThrow('Invalid environment');
  });
});
