/**
 * Weighted Round-Robin Load Balancer
 * Distributes traffic based on instance weights
 * Higher weight = more traffic
 */

const logger = require('../utils/logger');

class WeightedRoundRobinLoadBalancer {
  constructor() {
    this.currentWeights = new Map();
  }

  /**
   * Select instance using weighted round-robin
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

    // Get or initialize current weights
    const backendName = backend.name;
    if (!this.currentWeights.has(backendName)) {
      this.initializeWeights(backendName, healthyInstances);
    }

    const weights = this.currentWeights.get(backendName);

    // Select instance with highest current weight
    let selectedInstance = null;
    let maxWeight = -Infinity;

    for (const instance of healthyInstances) {
      const currentWeight = weights.get(instance.url) || 0;
      if (currentWeight > maxWeight) {
        maxWeight = currentWeight;
        selectedInstance = instance;
      }
    }

    if (!selectedInstance) {
      // Fallback to first instance
      selectedInstance = healthyInstances[0];
    }

    // Update weights using smooth weighted round-robin algorithm
    this.updateWeights(backendName, healthyInstances, selectedInstance);

    logger.debug('Backend instance selected', {
      backend: backendName,
      instance: selectedInstance.url,
      algorithm: 'weighted-round-robin',
      weight: selectedInstance.weight || 1,
      currentWeight: maxWeight.toFixed(2),
      healthyCount: healthyInstances.length
    });

    // Increment counters
    selectedInstance.activeConnections = (selectedInstance.activeConnections || 0) + 1;
    selectedInstance.totalRequests = (selectedInstance.totalRequests || 0) + 1;

    return selectedInstance;
  }

  /**
   * Initialize weights for a backend
   */
  initializeWeights(backendName, instances) {
    const weights = new Map();
    for (const instance of instances) {
      weights.set(instance.url, 0);
    }
    this.currentWeights.set(backendName, weights);
  }

  /**
   * Update weights after selection (smooth weighted round-robin)
   */
  updateWeights(backendName, instances, selectedInstance) {
    const weights = this.currentWeights.get(backendName);

    // Calculate total weight
    const totalWeight = instances.reduce((sum, inst) => sum + (inst.weight || 1), 0);

    // Increase all current weights by their configured weights
    for (const instance of instances) {
      const configuredWeight = instance.weight || 1;
      const currentWeight = weights.get(instance.url) || 0;
      weights.set(instance.url, currentWeight + configuredWeight);
    }

    // Decrease selected instance's current weight by total weight
    const selectedWeight = weights.get(selectedInstance.url) || 0;
    weights.set(selectedInstance.url, selectedWeight - totalWeight);
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
   * Reset weights (for testing)
   */
  reset() {
    this.currentWeights.clear();
    logger.info('Weighted round-robin load balancer reset');
  }

  /**
   * Get statistics
   */
  getStats(backend) {
    if (!backend || !backend.instances) {
      return null;
    }

    const backendName = backend.name;
    const weights = this.currentWeights.get(backendName) || new Map();

    return {
      backend: backendName,
      algorithm: 'weighted-round-robin',
      totalInstances: backend.instances.length,
      healthyInstances: backend.instances.filter(i => i.healthy !== false).length,
      instances: backend.instances.map(instance => ({
        url: instance.url,
        healthy: instance.healthy !== false,
        configuredWeight: instance.weight || 1,
        currentWeight: weights.get(instance.url) || 0,
        activeConnections: instance.activeConnections || 0,
        totalRequests: instance.totalRequests || 0
      }))
    };
  }
}

module.exports = WeightedRoundRobinLoadBalancer;
