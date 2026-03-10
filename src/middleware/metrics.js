/**
 * Metrics Middleware
 * Prometheus metrics collection
 */

const promClient = require('prom-client');

// Create a Registry
const register = new promClient.Registry();

// Add a default metrics
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'gateway_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const httpRequestTotal = new promClient.Counter({
  name: 'gateway_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const rateLimitExceeded = new promClient.Counter({
  name: 'gateway_rate_limit_exceeded_total',
  help: 'Total number of rate limit exceeded responses',
  labelNames: ['route']
});

const circuitBreakerState = new promClient.Gauge({
  name: 'gateway_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['backend']
});

const backendResponseTime = new promClient.Histogram({
  name: 'gateway_backend_response_duration_seconds',
  help: 'Backend response time in seconds',
  labelNames: ['backend', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const activeConnections = new promClient.Gauge({
  name: 'gateway_active_connections',
  help: 'Number of active connections to backends',
  labelNames: ['backend']
});

// Register all metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(rateLimitExceeded);
register.registerMetric(circuitBreakerState);
register.registerMetric(backendResponseTime);
register.registerMetric(activeConnections);

/**
 * Middleware to track request metrics
 */
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  
  // Track response
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    const route = req.route ? req.route.path : req.path;
    
    // Record request duration
    httpRequestDuration.labels(req.method, route, res.statusCode).observe(duration);
    
    // Increment request counter
    httpRequestTotal.labels(req.method, route, res.statusCode).inc();
  });
  
  next();
}

module.exports = metricsMiddleware;
module.exports.metrics = {
  httpRequestDuration,
  httpRequestTotal,
  rateLimitExceeded,
  circuitBreakerState,
  backendResponseTime,
  activeConnections
};
module.exports.register = register;
