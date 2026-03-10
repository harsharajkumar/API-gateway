/**
 * High-Performance API Gateway
 * Main server entry point
 * 
 * @author Harsha Raj Kumar
 * @version 1.0.0
 */

require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const configLoader = require('./config/configLoader');
const metricsMiddleware = require('./middleware/metrics');
const gatewayRouter = require('./routes/gateway');
const healthMonitor = require('./healthcheck/healthMonitor');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 8080;
const METRICS_PORT = process.env.METRICS_PORT || 9090;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve admin dashboard
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'public')));

// Metrics middleware (Prometheus)
app.use(metricsMiddleware);

// Load configuration
const config = configLoader.loadConfig();
logger.info('Configuration loaded', {
  routes: config.routes.length,
  backends: Object.keys(config.backends).length
});

// Start health monitoring for all backends
for (const [name, backend] of Object.entries(config.backends)) {
  healthMonitor.startMonitoring(name, backend);
}

// Gateway routes
app.use('/', gatewayRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  const backendHealth = healthMonitor.getAllHealthStatus();
  
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    backends: backendHealth
  });
});

// Metrics endpoint (separate port for security)
const metricsApp = express();
const prometheusClient = require('prom-client');
const register = new prometheusClient.Registry();

// Collect default metrics
prometheusClient.collectDefaultMetrics({ register });

metricsApp.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });
  
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

// Start main server
const mainServer = app.listen(PORT, () => {
  logger.info(`API Gateway started`, {
    port: PORT,
    environment: process.env.NODE_ENV,
    nodeVersion: process.version
  });
  console.log(`\nAPI Gateway running at http://localhost:${PORT}\nDashboard:    http://localhost:${PORT}/\nHealth check: http://localhost:${PORT}/health\nMetrics:      http://localhost:${METRICS_PORT}/metrics\n`);
});

mainServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use. Run: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  } else {
    throw err;
  }
});

// Start metrics server
const metricsServer = metricsApp.listen(METRICS_PORT, () => {
  logger.info(`Metrics server started on port ${METRICS_PORT}`);
});

metricsServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.warn(`Metrics port ${METRICS_PORT} already in use — metrics server skipped`);
  } else {
    throw err;
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  healthMonitor.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  healthMonitor.stopAll();
  process.exit(0);
});

module.exports = app;
