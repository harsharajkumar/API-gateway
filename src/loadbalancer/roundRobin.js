/**
 * Round-Robin Load Balancer
 * Distributes requests evenly across backend instances
 */

const logger = require('../utils/logger');

class RoundRobinLoadBalancer {
  constructor() {
    // Track current index for each backend
    this.currentIndex = new Map();
  }

  /**
   * Select next backend instance using round-robin
   * @param {object} backend - Backend configuration
   * @returns {object|null} - Selected backend instance or null
   */
  selectInstance(backend) {
    if (!backend || !backend.instances || backend.instances.length === 0) {
      logger.error('No backend instances available', { backend: backend?.name });
      return null;
    }

    // Filter only healthy instances
    const healthyInstances = backend.instances.filter(instance => instance.healthy !== false);

    if (healthyInstances.length === 0) {
      logger.error('No healthy backend instances', {
        backend: backend.name,
        totalInstances: backend.instances.length
      });
      return null;
    }

    // Get current index for this backend
    const backendName = backend.name;
    let currentIdx = this.currentIndex.get(backendName) || 0;

    // Select instance at current index
    const selectedInstance = healthyInstances[currentIdx];

    // Increment and wrap around
    currentIdx = (currentIdx + 1) % healthyInstances.length;
    this.currentIndex.set(backendName, currentIdx);

    logger.debug('Backend instance selected', {
      backend: backendName,
      instance: selectedInstance.url,
      algorithm: 'round-robin',
      healthyCount: healthyInstances.length,
      totalCount: backend.instances.length
    });

    // Increment connection counter
    selectedInstance.activeConnections = (selectedInstance.activeConnections || 0) + 1;
    selectedInstance.totalRequests = (selectedInstance.totalRequests || 0) + 1;

    return selectedInstance;
  }

  /**
   * Release connection (decrement counter)
   * @param {object} instance - Backend instance
   */
  releaseConnection(instance) {
    if (instance && instance.activeConnections > 0) {
      instance.activeConnections--;
    }
  }

  /**
   * Reset counters (useful for testing)
   */
  reset() {
    this.currentIndex.clear();
    logger.info('Round-robin load balancer reset');
  }

  /**
   * Get statistics for a backend
   * @param {object} backend - Backend configuration
   * @returns {object} - Statistics
   */
  getStats(backend) {
    if (!backend || !backend.instances) {
      return null;
    }

    const stats = {
      backend: backend.name,
      totalInstances: backend.instances.length,
      healthyInstances: backend.instances.filter(i => i.healthy !== false).length,
      instances: backend.instances.map(instance => ({
        url: instance.url,
        healthy: instance.healthy !== false,
        activeConnections: instance.activeConnections || 0,
        totalRequests: instance.totalRequests || 0
      }))
    };

    return stats;
  }
}

module.exports = RoundRobinLoadBalancer;
