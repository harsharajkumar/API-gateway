/**
 * Gateway Router
 * Main request routing and proxying logic
 *
 * Instrumented with:
 *  - Distributed tracing (tracer.js)
 *  - Adaptive rate limiting (adaptiveRateLimiter.js)
 *  - SLO / error-budget tracking (sloTracker.js)
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const configLoader     = require('../config/configLoader');
const RouteMatcher     = require('../router/routeMatcher');
const loadBalancerFactory = require('../loadbalancer/loadBalancerFactory');
const proxyService     = require('../proxy/proxyService');
const rateLimiter      = require('../middleware/rateLimiter');
const CircuitBreaker   = require('../middleware/circuitBreaker');

// ── New modules ──────────────────────────────────────────
const tracer         = require('../tracing/tracer');
const sloTracker     = require('../slo/sloTracker');
const adaptiveCtrl   = require('../middleware/adaptiveRateLimiter');
const metricsModule  = require('../middleware/metrics');

// ── Configuration ────────────────────────────────────────
const { routes, backends } = configLoader.loadConfig();
const routeMatcher = new RouteMatcher(routes);

// Create circuit breakers for each backend
const circuitBreakers = new Map();
for (const [name, backend] of Object.entries(backends)) {
  if (backend.circuitBreaker !== false) {
    circuitBreakers.set(name, new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000
    }));
  }
}

// ── Feed SLO tracker every 10 s from Prometheus counters ─
setInterval(async () => {
  try {
    const raw = await metricsModule.register.getMetricsAsJSON();
    const find = (name) => raw.find(m => m.name === name);

    const reqMetric = find('gateway_http_requests_total');
    let totalReqs = 0, errorReqs = 0;
    if (reqMetric) {
      reqMetric.values.forEach(v => {
        totalReqs += v.value;
        if (parseInt(v.labels.status_code, 10) >= 500) errorReqs += v.value;
      });
    }

    // Interpolate P99 / P95 from histogram buckets
    const durationHist = find('gateway_http_request_duration_seconds');
    let p99ms = 0, p95ms = 0;
    if (durationHist) {
      const buckets = durationHist.values
        .filter(v => v.metricName === 'gateway_http_request_duration_seconds_bucket')
        .map(v => ({ le: v.labels.le === '+Inf' ? Infinity : parseFloat(v.labels.le), count: v.value }))
        .sort((a, b) => a.le - b.le);
      p99ms = interpolatePercentile(buckets, 99)  * 1000;
      p95ms = interpolatePercentile(buckets, 95)  * 1000;
    }

    sloTracker.record({ totalReqs, errorReqs, p99ms, p95ms });
  } catch (_) { /* silent */ }
}, 10000);

/**
 * Interpolate a percentile value from a Prometheus histogram.
 * Uses linear interpolation within the containing bucket.
 */
function interpolatePercentile(buckets, pct) {
  if (!buckets.length) return 0;
  const total = buckets.find(b => b.le === Infinity)?.count || 0;
  if (total === 0) return 0;
  const target = (pct / 100) * total;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].count >= target) {
      const prevCount = i > 0 ? buckets[i - 1].count : 0;
      const prevLe    = i > 0 ? buckets[i - 1].le    : 0;
      if (buckets[i].count === prevCount) return prevLe;
      const ratio = (target - prevCount) / (buckets[i].count - prevCount);
      return prevLe + (buckets[i].le - prevLe) * ratio;
    }
  }
  return buckets[buckets.length - 2]?.le || 0;
}

// ════════════════════════════════════════════════════════
// MAIN GATEWAY HANDLER
// ════════════════════════════════════════════════════════
router.all('*', async (req, res, next) => {
  const startTime = Date.now();

  // Pass admin, health, and static paths to their dedicated handlers
  if (req.path.startsWith('/_admin') ||
      req.path === '/health'         ||
      req.path === '/favicon.ico'    ||
      req.path.startsWith('/public')) {
    return next();
  }

  // ── Start trace ──────────────────────────────────────
  const trace = tracer.start(req);
  res.setHeader('X-Trace-ID', trace.traceId);

  try {
    logger.info('Request received', { method: req.method, path: req.path, ip: req.ip });

    // ── SPAN 1: Route matching ────────────────────────
    trace.startSpan('route_match');
    const route = routeMatcher.findRoute(req.path, req.method);
    if (!route) {
      trace.endSpan('route_match', 'error', { reason: 'no_route' });
      trace.finish(404);
      return res.status(404).json({
        error: 'Not Found',
        message: `No route configured for ${req.method} ${req.path}`,
        timestamp: new Date().toISOString()
      });
    }
    trace.endSpan('route_match', 'ok', { routeId: route.id, backend: route.backend });

    // ── SPAN 2: Adaptive rate limiting ────────────────
    trace.startSpan('adaptive_rl');
    const backendMultiplier = adaptiveCtrl.getMultiplier(route.backend);
    if (backendMultiplier < 1.0 && Math.random() > backendMultiplier) {
      trace.endSpan('adaptive_rl', 'shed', { multiplier: backendMultiplier });
      trace.finish(429);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Adaptive rate limiting: backend latency is elevated, shedding load to protect service.',
        adaptiveMultiplier: backendMultiplier,
        timestamp: new Date().toISOString()
      });
    }
    trace.endSpan('adaptive_rl', 'ok', { multiplier: backendMultiplier });

    // ── SPAN 3: Rate limiting ─────────────────────────
    const rateLimitAlgorithm = process.env.RATE_LIMIT_ALGORITHM || 'token-bucket';
    if (route.rateLimit && route.rateLimit > 0) {
      trace.startSpan('rate_limit');
      const identifier = getRateLimitIdentifier(req);
      const limiter    = rateLimiter.createLimiter(route, rateLimitAlgorithm);
      const rlResult   = await limiter.checkLimit(identifier);

      res.setHeader('X-RateLimit-Limit',     route.rateLimit);
      res.setHeader('X-RateLimit-Remaining', rlResult.remaining);
      res.setHeader('X-RateLimit-Reset',     rlResult.resetTime);
      res.setHeader('X-RateLimit-Algorithm', rateLimitAlgorithm);

      if (!rlResult.allowed) {
        trace.endSpan('rate_limit', 'exceeded', { identifier });
        trace.finish(429);
        res.setHeader('Retry-After', Math.ceil((rlResult.resetTime - Date.now()) / 1000));
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Maximum ${route.rateLimit} requests per minute.`,
          retryAfter: Math.ceil((rlResult.resetTime - Date.now()) / 1000),
          timestamp: new Date().toISOString()
        });
      }
      trace.endSpan('rate_limit', 'ok', { remaining: rlResult.remaining });
    }

    // ── SPAN 4: Load balancing ────────────────────────
    trace.startSpan('load_balance');
    const backend  = backends[route.backend];
    if (!backend) {
      trace.endSpan('load_balance', 'error', { reason: 'no_backend' });
      trace.finish(502);
      return res.status(502).json({ error: 'Bad Gateway', timestamp: new Date().toISOString() });
    }

    const instance = loadBalancerFactory.selectInstance(backend);
    if (!instance) {
      trace.endSpan('load_balance', 'error', { reason: 'no_healthy_instance' });
      trace.finish(503);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'All backend instances are unhealthy',
        timestamp: new Date().toISOString()
      });
    }
    trace.endSpan('load_balance', 'ok', { instance: instance.url });

    const targetPath = routeMatcher.transformPath(req.path, route);

    // ── SPAN 5: Proxy / upstream call ─────────────────
    trace.startSpan('proxy', { instance: instance.url, targetPath });
    const proxyStart = Date.now();
    let response;
    const circuitBreaker = circuitBreakers.get(route.backend);

    try {
      if (circuitBreaker && route.circuitBreaker !== false) {
        response = await circuitBreaker.execute(
          () => proxyService.proxyRequest(instance, targetPath, req.method, req.headers, req.body, route.timeout || 30000),
          route.backend
        );
      } else {
        response = await proxyService.proxyRequest(instance, targetPath, req.method, req.headers, req.body, route.timeout || 30000);
      }
    } catch (err) {
      if (err.message === 'Circuit breaker is OPEN') {
        trace.endSpan('proxy', 'circuit_open');
        trace.finish(503);
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Circuit breaker is open for this backend',
          timestamp: new Date().toISOString()
        });
      }
      throw err;
    }

    const backendLatencyMs = Date.now() - proxyStart;

    // Feed backend latency to adaptive controller
    adaptiveCtrl.update(route.backend, backendLatencyMs);

    trace.endSpan('proxy', response.statusCode >= 500 ? 'error' : 'ok', {
      statusCode:    response.statusCode,
      latencyMs:     backendLatencyMs
    });

    // ── SPAN 6: Release + respond ─────────────────────
    loadBalancerFactory.releaseConnection(backend, instance);

    const totalDuration = Date.now() - startTime;
    trace.finish(response.statusCode, { backendLatencyMs, totalDuration });

    logger.info('Request completed', {
      method: req.method, path: req.path,
      statusCode: response.statusCode,
      backend: instance.url,
      duration: `${totalDuration}ms`
    });

    if (response.headers) {
      Object.entries(response.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    res.setHeader('X-Gateway-Backend',  instance.url);
    res.setHeader('X-Gateway-Route',    route.id);
    res.setHeader('X-Response-Time',    `${totalDuration}ms`);

    res.status(response.statusCode).send(response.body);

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Gateway error', { error: error.message, path: req.path, duration: `${duration}ms` });
    trace.finish(500, { error: error.message });
    res.status(500).json({
      error: 'Internal Gateway Error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

function getRateLimitIdentifier(req) {
  const apiKey = req.get('X-API-Key');
  if (apiKey) return `apikey:${apiKey}`;
  const userId = req.get('X-User-ID');
  if (userId) return `user:${userId}`;
  return `ip:${req.ip || req.connection.remoteAddress}`;
}

// ════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════

router.get('/_admin/stats', (req, res) => {
  res.json({
    routes: routes.map(r => ({
      id: r.id, path: r.path, backend: r.backend,
      methods: r.methods, rateLimit: r.rateLimit,
      circuitBreaker: r.circuitBreaker, timeout: r.timeout
    })),
    backends: Object.entries(backends).map(([name, backend]) => ({
      id: name,
      ...loadBalancerFactory.getStats(backend),
      circuitBreaker: circuitBreakers.get(name)?.getState() ?? null
    }))
  });
});

router.get('/_admin/circuit-breakers', (req, res) => {
  const status = {};
  for (const [name, cb] of circuitBreakers) status[name] = cb.getState();
  res.json(status);
});

// ── Distributed Traces ───────────────────────────────────
router.get('/_admin/traces', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit || '50'), 200);
  const traces = tracer.getRecent(limit);
  res.json({ traces, stats: tracer.getStats() });
});

router.get('/_admin/traces/:traceId', (req, res) => {
  const trace = tracer.getById(req.params.traceId);
  if (!trace) return res.status(404).json({ error: 'Trace not found' });
  res.json(trace);
});

// ── SLO / Error Budget ───────────────────────────────────
router.get('/_admin/slo', (req, res) => {
  res.json(sloTracker.getStatus());
});

// ── Adaptive Rate Limiter ────────────────────────────────
router.get('/_admin/adaptive-limits', (req, res) => {
  res.json(adaptiveCtrl.getStatus());
});

// ── Chaos Engineering ────────────────────────────────────
router.post('/_admin/chaos/instance', (req, res) => {
  const { backendName, url, healthy } = req.body;
  const backend = backends[backendName];
  if (!backend) return res.status(404).json({ error: 'Backend not found' });
  const instance = backend.instances.find(i => i.url === url);
  if (!instance) return res.status(404).json({ error: 'Instance not found' });
  instance.healthy = healthy;
  instance.consecutiveFailures  = healthy ? 0 : 10;
  instance.consecutiveSuccesses = healthy ? 1 : 0;
  logger.warn(`Chaos: ${url} → ${healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  res.json({ ok: true, url, healthy });
});

router.post('/_admin/chaos/flood', async (req, res) => {
  const { path: routePath = '/api/users', method = 'GET', count = 30 } = req.body;
  const axios = require('axios');
  const port  = process.env.PORT || 8080;
  const tasks = Array.from({ length: Math.min(count, 100) }, () =>
    axios({ method, url: `http://localhost:${port}${routePath}`, timeout: 5000 })
      .then(r => r.status).catch(e => e.response?.status || 'error')
  );
  const results = await Promise.allSettled(tasks);
  const summary = {};
  results.forEach(r => { const c = String(r.value ?? 'error'); summary[c] = (summary[c] || 0) + 1; });
  logger.warn(`Chaos: flood ${count}× ${routePath}`, { summary });
  res.json({ sent: count, path: routePath, summary });
});

// ── Metrics JSON ─────────────────────────────────────────
router.get('/_admin/metrics/json', async (req, res) => {
  try {
    const raw  = await metricsModule.register.getMetricsAsJSON();
    const find = (name) => raw.find(m => m.name === name);

    const reqTotal  = find('gateway_http_requests_total');
    const byStatus  = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    const byRoute   = {};
    let   grandTotal = 0;

    if (reqTotal) {
      reqTotal.values.forEach(v => {
        const code = parseInt(v.labels.status_code, 10);
        grandTotal += v.value;
        if      (code >= 200 && code < 300) byStatus['2xx'] += v.value;
        else if (code >= 300 && code < 400) byStatus['3xx'] += v.value;
        else if (code >= 400 && code < 500) byStatus['4xx'] += v.value;
        else if (code >= 500)               byStatus['5xx'] += v.value;
        const route = v.labels.route || 'unknown';
        byRoute[route] = (byRoute[route] || 0) + v.value;
      });
    }

    const durationHist = find('gateway_http_request_duration_seconds');
    const latencyBuckets = {};
    if (durationHist) {
      durationHist.values
        .filter(v => v.metricName === 'gateway_http_request_duration_seconds_bucket' && v.labels.le !== '+Inf')
        .forEach(v => { latencyBuckets[v.labels.le] = (latencyBuckets[v.labels.le] || 0) + v.value; });
    }

    const rlMetric = find('gateway_rate_limit_exceeded_total');
    let rateLimitHits = 0;
    const rateLimitByRoute = {};
    if (rlMetric) {
      rlMetric.values.forEach(v => {
        rateLimitHits += v.value;
        rateLimitByRoute[v.labels.route || 'unknown'] = v.value;
      });
    }

    const connMetric = find('gateway_active_connections');
    const activeConns = {};
    if (connMetric) connMetric.values.forEach(v => { activeConns[v.labels.backend || 'unknown'] = v.value; });

    const memBytes = find('process_resident_memory_bytes')?.values?.[0]?.value || 0;

    res.json({
      grandTotal, byStatus, byRoute, latencyBuckets,
      rateLimitHits, rateLimitByRoute, activeConns,
      memoryMB: Math.round(memBytes / 1024 / 1024),
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
