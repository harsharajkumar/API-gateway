/**
 * Adaptive Rate Limiter Controller
 *
 * A feedback-control system (inspired by TCP congestion control and PID controllers)
 * that dynamically adjusts rate-limiting multipliers based on observed backend latency.
 *
 * Algorithm:
 *   1. Track a per-backend EWMA (Exponentially Weighted Moving Average) of P99 latency.
 *      EWMA smooths out noise: ewma_t = α * sample + (1 - α) * ewma_{t-1}
 *
 *   2. Compare ewma to TARGET_P99_MS to compute a normalised error signal:
 *      error = (ewma - target) / target       (positive = too slow, negative = healthy)
 *
 *   3. Proportional controller adjusts the multiplier:
 *      multiplier_t+1 = multiplier_t - Kp * max(0, error)
 *      Recovery is gradual (+RECOVERY_STEP per tick) when latency is healthy.
 *
 *   4. Probabilistic traffic shedding: when multiplier < 1.0, requests are rejected
 *      with probability (1 - multiplier) before they reach the backend.
 *      This protects overloaded backends from additional load — the same principle
 *      used by Google's LARD and Uber's Ringpop systems.
 *
 * Multiplier clamped to [MIN_MULTIPLIER, 1.0].
 */

const logger = require('../utils/logger');

const TARGET_P99_MS   = 80;   // target P99 — start reducing above this
const WARN_P99_MS     = 150;  // proportional reduction zone
const CRIT_P99_MS     = 300;  // emergency zone — cut aggressively
const MIN_MULTIPLIER  = 0.15; // never shed more than 85% of traffic
const RECOVERY_STEP   = 0.04; // restore 4% per tick when healthy
const Kp              = 0.35; // proportional gain
const ALPHA           = 0.25; // EWMA smoothing factor (lower = more smoothing)

class AdaptiveRateLimiterController {
  constructor() {
    // backendName → { multiplier, ewma, history[] }
    this.state     = new Map();
    this.changeLog = [];       // recent significant changes, newest first
  }

  /**
   * Feed a new P99 latency sample for a backend.
   * Called after each proxied request completes.
   * Returns the new multiplier.
   */
  update(backendName, p99Ms) {
    let s = this.state.get(backendName);
    if (!s) {
      s = { multiplier: 1.0, ewma: p99Ms, history: [] };
      this.state.set(backendName, s);
    }

    // EWMA update
    s.ewma = ALPHA * p99Ms + (1 - ALPHA) * s.ewma;

    const prev = s.multiplier;

    if (s.ewma > CRIT_P99_MS) {
      // Emergency: step-down aggressively
      s.multiplier = Math.max(MIN_MULTIPLIER, s.multiplier - 0.25);
    } else if (s.ewma > WARN_P99_MS) {
      // Proportional reduction
      const normError = (s.ewma - TARGET_P99_MS) / TARGET_P99_MS;
      s.multiplier = Math.max(MIN_MULTIPLIER, s.multiplier - Kp * normError * 0.08);
    } else if (s.ewma < TARGET_P99_MS * 0.75) {
      // Healthy: gradual recovery toward 1.0
      s.multiplier = Math.min(1.0, s.multiplier + RECOVERY_STEP);
    }

    // Round to 2dp to avoid floating-point noise in logs
    s.multiplier = Math.round(s.multiplier * 100) / 100;

    // Record history point
    s.history.push({ ts: Date.now(), p99Ms, ewma: Math.round(s.ewma), multiplier: s.multiplier });
    if (s.history.length > 120) s.history.shift();

    // Log significant changes (≥ 5% shift)
    if (Math.abs(s.multiplier - prev) >= 0.05) {
      const action = s.multiplier < prev ? 'TIGHTEN' : 'RESTORE';
      this.changeLog.unshift({
        ts:         Date.now(),
        backend:    backendName,
        action,
        from:       prev,
        to:         s.multiplier,
        ewmaP99:    Math.round(s.ewma)
      });
      if (this.changeLog.length > 100) this.changeLog.pop();
      logger.warn(`AdaptiveRL [${action}] ${backendName}: ${Math.round(prev*100)}% → ${Math.round(s.multiplier*100)}% (EWMA P99=${Math.round(s.ewma)}ms)`);
    }

    return s.multiplier;
  }

  /**
   * Returns the current multiplier for a backend (1.0 = no shedding).
   * Used by the gateway to decide whether to shed the request.
   */
  getMultiplier(backendName) {
    return this.state.get(backendName)?.multiplier ?? 1.0;
  }

  /**
   * Returns full status for the dashboard endpoint.
   */
  getStatus() {
    const backends = {};
    for (const [name, s] of this.state) {
      backends[name] = {
        multiplier:    s.multiplier,
        pct:           Math.round(s.multiplier * 100),
        ewmaP99:       Math.round(s.ewma),
        status:        s.multiplier < 0.5  ? 'critical'
                     : s.multiplier < 0.85 ? 'warning'
                     : 'ok',
        shedding:      s.multiplier < 1.0,
        history:       s.history.slice(-30)
      };
    }
    return {
      backends,
      changeLog:     this.changeLog.slice(0, 30),
      config: {
        targetP99Ms:   TARGET_P99_MS,
        warnP99Ms:     WARN_P99_MS,
        critP99Ms:     CRIT_P99_MS,
        minMultiplier: MIN_MULTIPLIER,
        Kp,
        alpha:         ALPHA
      }
    };
  }
}

module.exports = new AdaptiveRateLimiterController();
