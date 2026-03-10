/**
 * Load Balancer Factory
 * Creates appropriate load balancer based on configuration
 */

const RoundRobinLoadBalancer = require('./roundRobin');
const LeastConnectionsLoadBalancer = require('./leastConnections');
const WeightedRoundRobinLoadBalancer = require('./weighted');
const logger = require('../utils/logger');

class LoadBalancerFactory {
  constructor() {
    this.loadBalancers = new Map();
  }

  /**
   * Get or create load balancer for backend
   */
  getLoadBalancer(backend) {
    const algorithm = backend.loadBalancing?.algorithm || 'round-robin';
    const key = `${backend.name}-${algorithm}`;

    if (!this.loadBalancers.has(key)) {
      const loadBalancer = this.createLoadBalancer(algorithm, backend.name);
      this.loadBalancers.set(key, loadBalancer);
    }

    return this.loadBalancers.get(key);
  }

  /**
   * Create load balancer instance
   */
  createLoadBalancer(algorithm, backendName) {
    let loadBalancer;

    switch (algorithm.toLowerCase()) {
      case 'least-connections':
      case 'least_connections':
        loadBalancer = new LeastConnectionsLoadBalancer();
        break;

      case 'weighted':
      case 'weighted-round-robin':
      case 'weighted_round_robin':
        loadBalancer = new WeightedRoundRobinLoadBalancer();
        break;

      case 'round-robin':
      case 'round_robin':
      default:
        loadBalancer = new RoundRobinLoadBalancer();
        break;
    }

    logger.info('Load balancer created', {
      backend: backendName,
      algorithm
    });

    return loadBalancer;
  }

  /**
   * Select instance from backend
   */
  selectInstance(backend) {
    const loadBalancer = this.getLoadBalancer(backend);
    return loadBalancer.selectInstance(backend);
  }

  /**
   * Release connection
   */
  releaseConnection(backend, instance) {
    const loadBalancer = this.getLoadBalancer(backend);
    if (loadBalancer.releaseConnection) {
      loadBalancer.releaseConnection(instance);
    }
  }

  /**
   * Get statistics for backend
   */
  getStats(backend) {
    const loadBalancer = this.getLoadBalancer(backend);
    if (loadBalancer.getStats) {
      return loadBalancer.getStats(backend);
    }
    return null;
  }
}

// Singleton instance
const loadBalancerFactory = new LoadBalancerFactory();

module.exports = loadBalancerFactory;
