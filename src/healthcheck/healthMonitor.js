/**
 * Health Monitor
 * Actively checks backend health and marks instances as healthy/unhealthy
 */

const proxyService = require('../proxy/proxyService');
const logger = require('../utils/logger');

class HealthMonitor {
  constructor() {
    this.intervals = new Map();
    this.healthCheckResults = new Map();
  }

  /**
   * Start monitoring a backend
   */
  startMonitoring(backendName, backend) {
    if (!backend.healthCheck || !backend.healthCheck.enabled) {
      logger.debug('Health checks disabled', { backend: backendName });
      return;
    }

    // Stop existing monitor if any
    this.stopMonitoring(backendName);

    const interval = setInterval(async () => {
      await this.checkBackendHealth(backendName, backend);
    }, backend.healthCheck.interval);

    this.intervals.set(backendName, interval);

    logger.info('Health monitoring started', {
      backend: backendName,
      interval: backend.healthCheck.interval,
      instances: backend.instances.length
    });

    // Run initial check immediately
    this.checkBackendHealth(backendName, backend);
  }

  /**
   * Stop monitoring a backend
   */
  stopMonitoring(backendName) {
    const interval = this.intervals.get(backendName);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(backendName);
      logger.info('Health monitoring stopped', { backend: backendName });
    }
  }

  /**
   * Check health of all instances in a backend
   */
  async checkBackendHealth(backendName, backend) {
    const results = await Promise.all(
      backend.instances.map(instance => 
        this.checkInstanceHealth(instance, backend.healthCheck)
      )
    );

    // Store results
    this.healthCheckResults.set(backendName, {
      timestamp: new Date().toISOString(),
      results
    });

    // Log summary
    const healthyCount = results.filter(r => r.healthy).length;
    logger.debug('Health check completed', {
      backend: backendName,
      healthy: healthyCount,
      total: results.length
    });
  }

  /**
   * Check health of single instance
   */
  async checkInstanceHealth(instance, healthCheckConfig) {
    const startTime = Date.now();

    try {
      const isHealthy = await proxyService.healthCheck(
        instance,
        healthCheckConfig.path,
        healthCheckConfig.timeout
      );

      const duration = Date.now() - startTime;

      if (isHealthy) {
        // Mark as healthy
        instance.healthy = true;
        instance.consecutiveFailures = 0;
        instance.consecutiveSuccesses = (instance.consecutiveSuccesses || 0) + 1;

        logger.debug('Health check passed', {
          instance: instance.url,
          duration: `${duration}ms`
        });
      } else {
        // Mark as unhealthy
        instance.consecutiveFailures = (instance.consecutiveFailures || 0) + 1;
        instance.consecutiveSuccesses = 0;

        if (instance.consecutiveFailures >= 3) {
          instance.healthy = false;
          logger.warn('Instance marked unhealthy', {
            instance: instance.url,
            consecutiveFailures: instance.consecutiveFailures
          });
        }
      }

      return {
        url: instance.url,
        healthy: instance.healthy,
        duration,
        consecutiveFailures: instance.consecutiveFailures || 0,
        consecutiveSuccesses: instance.consecutiveSuccesses || 0
      };

    } catch (error) {
      instance.healthy = false;
      instance.consecutiveFailures = (instance.consecutiveFailures || 0) + 1;

      logger.error('Health check failed', {
        instance: instance.url,
        error: error.message
      });

      return {
        url: instance.url,
        healthy: false,
        error: error.message,
        consecutiveFailures: instance.consecutiveFailures
      };
    }
  }

  /**
   * Get health status for a backend
   */
  getHealthStatus(backendName) {
    return this.healthCheckResults.get(backendName) || null;
  }

  /**
   * Get health status for all backends
   */
  getAllHealthStatus() {
    const status = {};
    for (const [backendName, results] of this.healthCheckResults) {
      status[backendName] = results;
    }
    return status;
  }

  /**
   * Stop all monitoring
   */
  stopAll() {
    for (const backendName of this.intervals.keys()) {
      this.stopMonitoring(backendName);
    }
    logger.info('All health monitoring stopped');
  }
}

// Singleton instance
const healthMonitor = new HealthMonitor();

module.exports = healthMonitor;
