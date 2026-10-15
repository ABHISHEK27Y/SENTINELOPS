import type { Sample } from '@sentinelops/detection';
import { RequestRateSchema, type RequestRate } from '@sentinelops/shared-types';

/** Event-time ordering prevents a delayed telemetry batch from replacing a newer rate. */
export function latestRequestRate(samples: Sample[], previous: unknown): RequestRate | undefined {
  const saved = RequestRateSchema.safeParse(previous);
  let latest = saved.success ? saved.data : undefined;
  for (const sample of samples) {
    if (sample.metric !== 'request_rate') continue;
    const parsed = RequestRateSchema.safeParse({ value: sample.value, ts: sample.ts });
    if (!parsed.success) continue;
    if (!latest || Date.parse(parsed.data.ts) >= Date.parse(latest.ts)) latest = parsed.data;
  }
  return latest;
}
