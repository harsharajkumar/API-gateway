/**
 * Least Connections Load Balancer
 * Routes to instance with fewest active connections
 * Good for long-lived connections
 */

const logger = require('../utils/logger');

class LeastConnectionsLoadBalancer {
  constructor() {
    // No state needed - uses instance.activeConnections
  }

  /**
   * Select instance with least active connections
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

    // Find instance with minimum active connections
    let selectedInstance = healthyInstances[0];
    let minConnections = selectedInstance.activeConnections || 0;

    for (const instance of healthyInstances) {
      const connections = instance.activeConnections || 0;
      if (connections < minConnections) {
        selectedInstance = instance;
        minConnections = connections;
      }
    }

    logger.debug('Backend instance selected', {
      backend: backend.name,
      instance: selectedInstance.url,
      algorithm: 'least-connections',
      activeConnections: minConnections,
      healthyCount: healthyInstances.length
    });

    // Increment connection counter
    selectedInstance.activeConnections = (selectedInstance.activeConnections || 0) + 1;
    selectedInstance.totalRequests = (selectedInstance.totalRequests || 0) + 1;

    return selectedInstance;
  }

  /**
   * Release connection
   */
  releaseConnection(instance) {
    if (instance && instance.activeConnections > 0) {
      instance.activeConnections--;
    }
  }

  /**
   * Get statistics
   */
  getStats(backend) {
    if (!backend || !backend.instances) {
      return null;
    }

    return {
      backend: backend.name,
      algorithm: 'least-connections',
      totalInstances: backend.instances.length,
      healthyInstances: backend.instances.filter(i => i.healthy !== false).length,
      instances: backend.instances.map(instance => ({
        url: instance.url,
        healthy: instance.healthy !== false,
        activeConnections: instance.activeConnections || 0,
        totalRequests: instance.totalRequests || 0
      }))
    };
  }
}

module.exports = LeastConnectionsLoadBalancer;
