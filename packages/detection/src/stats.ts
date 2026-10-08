/**
 * Streaming statistics used by the anomaly detectors. Pure and deterministic so
 * they are trivially unit-testable — no randomness, no time dependence.
 */

/** Fixed-capacity rolling window with O(1) mean/variance via running sums. */
export class RollingWindow {
  private buf: number[] = [];
  private sum = 0;
  private sumSq = 0;

  constructor(private capacity: number) {
    if (capacity < 2) throw new Error('capacity must be >= 2');
  }

  push(v: number): void {
    this.buf.push(v);
    this.sum += v;
    this.sumSq += v * v;
    if (this.buf.length > this.capacity) {
      const old = this.buf.shift() as number;
      this.sum -= old;
      this.sumSq -= old * old;
    }
  }

  get size(): number {
    return this.buf.length;
  }

  mean(): number {
    return this.buf.length ? this.sum / this.buf.length : 0;
  }

  /** Population standard deviation (guards tiny negatives from FP error). */
  std(): number {
    const n = this.buf.length;
    if (n < 2) return 0;
    const variance = Math.max(0, this.sumSq / n - this.mean() ** 2);
    return Math.sqrt(variance);
  }
}

/** Exponentially-weighted moving average + variance (Welford-style EWMA). */
export class Ewma {
  private mean_ = 0;
  private var_ = 0;
  private initialized = false;

  constructor(private alpha = 0.2) {
    if (alpha <= 0 || alpha >= 1) throw new Error('alpha must be in (0,1)');
  }

  update(x: number): void {
    if (!this.initialized) {
      this.mean_ = x;
      this.var_ = 0;
      this.initialized = true;
      return;
    }
    const diff = x - this.mean_;
    const incr = this.alpha * diff;
    this.mean_ += incr;
    // EWMA of variance (West, 1979)
    this.var_ = (1 - this.alpha) * (this.var_ + diff * incr);
  }

  get mean(): number {
    return this.mean_;
  }

  std(): number {
    return Math.sqrt(Math.max(0, this.var_));
  }
}
