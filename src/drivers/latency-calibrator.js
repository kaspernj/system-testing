// @ts-check

/**
 * Adapts assertion and lookup deadline budgets to the measured responsiveness of the
 * current session, so a runner that is simply slow does not lose a race against a
 * fixed window that a healthy box would satisfy.
 *
 * It records the wall-clock duration of operations that actually waited and then
 * settled successfully. Failed or deadline-expired operations are never recorded: a
 * hang is the failure we are trying to prevent, not evidence of how slow the runner
 * is, and counting it would mask the very timeout it caused.
 *
 * `adaptive(base)` is always at least `base` (never faster than today's healthy
 * default, so a healthy runner sees zero behavior change) and never above a hard
 * ceiling (so a genuinely hung operation still fails in bounded time). Under load the
 * recent operations are slow, so the budget grows proportionally to cover them.
 */
export default class LatencyCalibrator {
  /**
   * @param {{minSamples?: number, windowSize?: number, minSampleMs?: number, safetyFactor?: number, quantile?: number, ceilingMs?: number}} [args]
   */
  constructor(args = {}) {
    this.minSamples = args.minSamples ?? 3
    this.windowSize = args.windowSize ?? 20
    this.minSampleMs = args.minSampleMs ?? 200
    this.safetyFactor = args.safetyFactor ?? 3
    this.quantile = args.quantile ?? 0.9
    this.ceilingMs = args.ceilingMs ?? 60000
    /** @type {number[]} */
    this.samples = []
  }

  /**
   * Records the duration of an operation that waited and then settled successfully.
   * Sub-threshold (instant) operations are ignored so they do not dilute the recent
   * latency estimate.
   * @param {number} elapsedMs Wall-clock duration in milliseconds.
   * @returns {void}
   */
  record(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < this.minSampleMs) return
    this.samples.push(elapsedMs)
    if (this.samples.length > this.windowSize) this.samples.shift()
  }

  /**
   * @returns {number} Recent high-latency estimate: the configured quantile of the
   *   recorded window, or 0 when nothing has been recorded.
   */
  recentHighMs() {
    if (this.samples.length === 0) return 0
    const sorted = [...this.samples].sort((a, b) => a - b)
    const rank = Math.min(sorted.length - 1, Math.floor(this.quantile * sorted.length))
    return sorted[rank]
  }

  /**
   * Scales a base budget to cover recent runner latency. Returns `baseMs` until enough
   * real samples have been recorded, then `min(ceiling, max(base, recentHigh * safety))`.
   * @param {number} baseMs Healthy-box base budget.
   * @returns {number}
   */
  adaptive(baseMs) {
    if (this.samples.length < this.minSamples) return baseMs
    const scaled = Math.round(this.recentHighMs() * this.safetyFactor)
    return Math.min(this.ceilingMs, Math.max(baseMs, scaled))
  }
}
