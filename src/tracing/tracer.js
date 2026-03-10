/**
 * Distributed Request Tracer
 *
 * Lightweight in-process implementation of distributed tracing concepts
 * (inspired by OpenTelemetry / Jaeger / Zipkin).
 *
 * Each request gets a TraceContext with a unique traceId.
 * Within a trace, named Spans record start/end times for each processing stage:
 *   route_match → rate_limit → adaptive_rl → load_balance → proxy → response
 *
 * Completed traces are kept in a fixed-size circular buffer (last 500).
 */

const { randomBytes } = require('crypto');

function genId() {
  return randomBytes(8).toString('hex');
}

// ── Span ──────────────────────────────────────────────
class Span {
  constructor(name, traceStartTime, meta = {}) {
    this.spanId       = genId();
    this.name         = name;
    this.startTime    = Date.now();
    this.relativeStart = this.startTime - traceStartTime; // offset from trace start (ms)
    this.endTime      = null;
    this.duration     = null;
    this.status       = 'running';
    this.meta         = meta;
  }

  finish(status = 'ok', meta = {}) {
    this.endTime  = Date.now();
    this.duration = this.endTime - this.startTime;
    this.status   = status;
    Object.assign(this.meta, meta);
  }
}

// ── TraceContext (one per request) ──────────────────────
class TraceContext {
  constructor(traceData, store) {
    this.traceId    = traceData.traceId;
    this._data      = traceData;
    this._store     = store;
    this._openSpans = new Map(); // name → Span
  }

  startSpan(name, meta = {}) {
    const span = new Span(name, this._data.startTime, meta);
    this._data.spans.push(span);
    this._openSpans.set(name, span);
    return span.spanId;
  }

  endSpan(name, status = 'ok', meta = {}) {
    const span = this._openSpans.get(name);
    if (!span) return;
    span.finish(status, meta);
    this._openSpans.delete(name);
  }

  finish(statusCode, meta = {}) {
    // Close any spans that didn't get explicitly closed
    for (const [name, span] of this._openSpans) {
      span.finish('interrupted');
    }
    this._openSpans.clear();

    this._data.endTime    = Date.now();
    this._data.duration   = this._data.endTime - this._data.startTime;
    this._data.statusCode = statusCode;
    this._data.status     = statusCode >= 500 ? 'error'
                          : statusCode >= 400 ? 'warning'
                          : 'ok';
    Object.assign(this._data.meta, meta);
    this._store._save(this._data);
    return this._data.traceId;
  }
}

// ── Tracer (singleton store) ────────────────────────────
class Tracer {
  constructor(maxTraces = 500) {
    this.maxTraces = maxTraces;
    this.traces    = [];          // newest first
  }

  /**
   * Start a new trace for an incoming request.
   * Returns a TraceContext that must be `.finish()`-ed when the request ends.
   */
  start(req) {
    const traceId = genId();
    const data = {
      traceId,
      method:    req.method,
      path:      req.path,
      ip:        req.ip || req.connection?.remoteAddress || 'unknown',
      userAgent: req.get('user-agent') || '',
      startTime: Date.now(),
      endTime:   null,
      duration:  null,
      statusCode: null,
      status:    'running',
      spans:     [],
      meta:      {}
    };
    return new TraceContext(data, this);
  }

  _save(trace) {
    this.traces.unshift(trace);
    if (this.traces.length > this.maxTraces) this.traces.pop();
  }

  /** Returns recent completed traces (summary + spans) */
  getRecent(limit = 50) {
    return this.traces.slice(0, limit);
  }

  getById(traceId) {
    return this.traces.find(t => t.traceId === traceId) || null;
  }

  /**
   * Compute P50/P95/P99 latency and error stats from stored traces.
   * Used by the SLO tracker.
   */
  getStats() {
    const recent = this.traces.slice(0, 200);
    if (!recent.length) return { count: 0, p50: 0, p95: 0, p99: 0, errorRate: 0 };

    const durations = recent.map(t => t.duration).filter(d => d != null).sort((a, b) => a - b);
    const n = durations.length;
    const errors = recent.filter(t => t.status === 'error').length;

    return {
      count:     recent.length,
      p50:       durations[Math.floor(n * 0.50)] || 0,
      p95:       durations[Math.floor(n * 0.95)] || 0,
      p99:       durations[Math.floor(n * 0.99)] || 0,
      avgMs:     Math.round(durations.reduce((a, b) => a + b, 0) / n),
      errorRate: recent.length > 0 ? (errors / recent.length) * 100 : 0
    };
  }
}

module.exports = new Tracer();
