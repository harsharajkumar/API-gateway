/**
 * SLO / Error Budget Tracker
 *
 * Implements the Google SRE error budget model:
 *   - SLO targets: availability 99.9%, P99 latency < 100ms, P95 < 50ms
 *   - Error budget = (1 - SLO_target) * total_requests
 *   - Burn rate = actual_error_rate / allowed_error_rate
 *
 * Burn rate thresholds (from Google SRE book, Chapter 5):
 *   > 14.4x → CRITICAL: 30-day budget exhausted in ~2 hours  → page immediately
 *   > 6x    → WARNING:  30-day budget exhausted in ~5 hours  → ticket
 *   ≤ 1x    → OK:       on track
 *
 * Reference: https://sre.google/workbook/alerting-on-slos/
 */

const SLO_TARGETS = {
  availability:  99.9,   // %  — max allowed error rate: 0.1%
  latency_p99:   100,    // ms — P99 must be < 100ms
  latency_p95:   50,     // ms — P95 must be < 50ms
};

class SloTracker {
  constructor() {
    // Each sample: { ts, totalReqs, errorReqs, p99ms, p95ms }
    this.samples = [];
    this.MAX_SAMPLES = 20000; // ~28 days at 1-sample/2min
  }

  /**
   * Record a data point. Call this every polling interval.
   * totalReqs and errorReqs are CUMULATIVE counters (like Prometheus counters).
   */
  record({ totalReqs, errorReqs, p99ms, p95ms }) {
    this.samples.push({
      ts:        Date.now(),
      totalReqs: totalReqs || 0,
      errorReqs: errorReqs || 0,
      p99ms:     p99ms     || 0,
      p95ms:     p95ms     || 0
    });
    if (this.samples.length > this.MAX_SAMPLES) this.samples.shift();
  }

  // ── private helpers ─────────────────────────────────
  _windowSamples(windowMs) {
    const cutoff = Date.now() - windowMs;
    return this.samples.filter(s => s.ts > cutoff);
  }

  /**
   * Compute delta requests in a sample window.
   * Uses consecutive-pair differences to handle counter resets gracefully.
   */
  _delta(samples) {
    let total = 0, errors = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = Math.max(0, samples[i].totalReqs - samples[i - 1].totalReqs);
      const de = Math.max(0, samples[i].errorReqs - samples[i - 1].errorReqs);
      total  += dt;
      errors += de;
    }
    return { total, errors };
  }

  _latestLatency(samples) {
    if (!samples.length) return { p99: 0, p95: 0 };
    const last = samples[samples.length - 1];
    return { p99: last.p99ms, p95: last.p95ms };
  }

  // ── public API ──────────────────────────────────────
  getStatus() {
    const W30M = 30 * 60 * 1000;
    const W1H  = 60 * 60 * 1000;
    const W6H  = 6  * 60 * 60 * 1000;
    const W24H = 24 * 60 * 60 * 1000;
    const W7D  = 7  * 24 * 60 * 60 * 1000;
    const W30D = 30 * 24 * 60 * 60 * 1000;

    const s30m = this._windowSamples(W30M);
    const s1h  = this._windowSamples(W1H);
    const s6h  = this._windowSamples(W6H);
    const s24h = this._windowSamples(W24H);
    const s7d  = this._windowSamples(W7D);
    const s30d = this._windowSamples(W30D);

    if (s30m.length < 2) {
      return { insufficientData: true, message: 'Collecting data — need at least 2 samples (~10s)' };
    }

    const d30m = this._delta(s30m);
    const d1h  = this._delta(s1h);
    const d6h  = this._delta(s6h);
    const d24h = this._delta(s24h);
    const d7d  = this._delta(s7d);
    const d30d = this._delta(s30d);

    const { p99: latestP99, p95: latestP95 } = this._latestLatency(s30m);

    // ── Availability ──────────────────────────────────
    const avail30m = d30m.total > 0 ? (1 - d30m.errors / d30m.total) * 100 : 100;
    const avail24h = d24h.total > 0 ? (1 - d24h.errors / d24h.total) * 100 : 100;
    const avail7d  = d7d.total  > 0 ? (1 - d7d.errors  / d7d.total)  * 100 : 100;

    // ── Error Budget (30-day window) ──────────────────
    const TARGET_ERROR_RATE = (100 - SLO_TARGETS.availability) / 100; // 0.001
    const budgetAllowed  = d30d.total * TARGET_ERROR_RATE;
    const budgetUsed     = d30d.errors;
    const budgetRemaining = Math.max(0, budgetAllowed - budgetUsed);
    const budgetRemPct   = budgetAllowed > 0
      ? (budgetRemaining / budgetAllowed) * 100
      : 100;

    // ── Burn Rate ─────────────────────────────────────
    // How many times faster than allowed are we consuming the error budget?
    const currentErrRate = d1h.total > 0 ? d1h.errors / d1h.total : 0;
    const burnRate       = TARGET_ERROR_RATE > 0 ? currentErrRate / TARGET_ERROR_RATE : 0;
    const burnAlert      = burnRate > 14.4 ? 'critical'
                         : burnRate > 6    ? 'warning'
                         : 'ok';

    // Time to budget exhaustion at current burn rate
    const hoursToExhaustion = burnRate > 0
      ? (30 * 24) / burnRate   // 30-day budget / burn rate = hours until exhausted
      : Infinity;

    return {
      slos: [
        {
          id:          'availability',
          name:        'Availability',
          description: '99.9% of requests must succeed (non-5xx)',
          target:      SLO_TARGETS.availability,
          unit:        '%',
          current:     avail30m.toFixed(4),
          passing:     avail30m >= SLO_TARGETS.availability,
          windows: {
            '30m': d30m.total > 0 ? avail30m.toFixed(4)  + '%' : 'N/A',
            '24h': d24h.total > 0 ? avail24h.toFixed(4)  + '%' : 'N/A',
            '7d':  d7d.total  > 0 ? avail7d.toFixed(4)   + '%' : 'N/A',
          }
        },
        {
          id:          'latency_p99',
          name:        'P99 Latency',
          description: 'The 99th percentile response time must be < 100ms',
          target:      SLO_TARGETS.latency_p99,
          unit:        'ms',
          current:     latestP99.toFixed(1),
          passing:     latestP99 === 0 || latestP99 < SLO_TARGETS.latency_p99,
        },
        {
          id:          'latency_p95',
          name:        'P95 Latency',
          description: 'The 95th percentile response time must be < 50ms',
          target:      SLO_TARGETS.latency_p95,
          unit:        'ms',
          current:     latestP95.toFixed(1),
          passing:     latestP95 === 0 || latestP95 < SLO_TARGETS.latency_p95,
        }
      ],
      errorBudget: {
        targetErrorRate: (TARGET_ERROR_RATE * 100).toFixed(3) + '%',
        allowed:         Math.round(budgetAllowed),
        used:            budgetUsed,
        remainingPct:    budgetRemPct.toFixed(1),
        status:          budgetRemPct > 50 ? 'ok' : budgetRemPct > 10 ? 'warning' : 'critical'
      },
      burnRate: {
        value:             burnRate.toFixed(2),
        alert:             burnAlert,
        hoursToExhaustion: isFinite(hoursToExhaustion) ? hoursToExhaustion.toFixed(1) : null,
        interpretation:    burnRate > 14.4
          ? `CRITICAL: budget exhausted in ~${hoursToExhaustion.toFixed(1)}h — page now`
          : burnRate > 6
          ? `WARNING: budget exhausted in ~${hoursToExhaustion.toFixed(1)}h — create ticket`
          : 'OK: on track'
      },
      windows: {
        '30m': d30m,
        '1h':  d1h,
        '6h':  d6h,
        '24h': d24h,
        '7d':  d7d,
        '30d': d30d
      },
      sampleCount: this.samples.length,
      oldestSampleAge: this.samples.length
        ? Math.round((Date.now() - this.samples[0].ts) / 1000) + 's'
        : 'N/A'
    };
  }
}

module.exports = new SloTracker();
