/**
 * Configuration Loader
 * Loads and parses routes.yml and backends.yml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');

class ConfigLoader {
  constructor() {
    this.configDir = path.join(__dirname, '../../config');
    this.routes = [];
    this.backends = {};
  }

  /**
   * Load all configuration files
   */
  loadConfig() {
    try {
      this.routes = this.loadRoutes();
      this.backends = this.loadBackends();
      
      logger.info('Configuration loaded successfully', {
        routeCount: this.routes.length,
        backendCount: Object.keys(this.backends).length
      });
      
      return {
        routes: this.routes,
        backends: this.backends
      };
    } catch (error) {
      logger.error('Failed to load configuration', { error: error.message });
      throw error;
    }
  }

  /**
   * Load routes from routes.yml
   */
  loadRoutes() {
    const routesPath = path.join(this.configDir, 'routes.yml');
    
    if (!fs.existsSync(routesPath)) {
      throw new Error(`Routes configuration not found: ${routesPath}`);
    }

    const raw = fs.readFileSync(routesPath, 'utf8');
    // Expand ${ENV_VAR} placeholders from process.env
    const fileContents = raw.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] || `\${${k}}`);
    const config = yaml.load(fileContents);
    
    if (!config || !config.routes) {
      throw new Error('Invalid routes configuration');
    }

    // Validate and normalize routes
    return config.routes.map(route => this.validateRoute(route));
  }

  /**
   * Load backends from backends.yml
   */
  loadBackends() {
    const backendsPath = path.join(this.configDir, 'backends.yml');
    
    if (!fs.existsSync(backendsPath)) {
      throw new Error(`Backends configuration not found: ${backendsPath}`);
    }

    const raw = fs.readFileSync(backendsPath, 'utf8');
    const fileContents = raw.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] || `\${${k}}`);
    const config = yaml.load(fileContents);
    
    if (!config || !config.backends) {
      throw new Error('Invalid backends configuration');
    }

    // Validate and normalize backends
    const backends = {};
    for (const [name, backend] of Object.entries(config.backends)) {
      backends[name] = this.validateBackend(name, backend);
    }

    return backends;
  }

  /**
   * Validate route configuration
   */
  validateRoute(route) {
    if (!route.id || !route.path || !route.backend) {
      throw new Error('Route must have id, path, and backend');
    }

    return {
      id: route.id,
      path: route.path,
      pathRewrite: route.pathRewrite === undefined ? true : route.pathRewrite, // string | true | false
      backend: route.backend,
      methods: route.methods || ['GET', 'POST', 'PUT', 'DELETE'],
      rateLimit: route.rateLimit || 100,
      circuitBreaker: route.circuitBreaker !== false,
      timeout: route.timeout || 30000
    };
  }

  /**
   * Validate backend configuration
   */
  validateBackend(name, backend) {
    if (!backend.instances || backend.instances.length === 0) {
      throw new Error(`Backend ${name} must have at least one instance`);
    }

    return {
      name: backend.name || name,
      instances: backend.instances.map(instance => ({
        url: instance.url,
        weight: instance.weight || 1,
        healthy: instance.healthy !== false,
        activeConnections: 0,
        totalRequests: 0
      })),
      healthCheck: {
        enabled: backend.healthCheck?.enabled !== false,
        path: backend.healthCheck?.path || '/health',
        interval: backend.healthCheck?.interval || 10000,
        timeout: backend.healthCheck?.timeout || 3000,
        method: backend.healthCheck?.method || 'GET'
      },
      loadBalancing: {
        algorithm: backend.loadBalancing?.algorithm || 'round-robin'
      }
    };
  }

  /**
   * Reload configuration (hot reload)
   */
  reloadConfig() {
    logger.info('Reloading configuration...');
    return this.loadConfig();
  }
}

// Singleton instance
const configLoader = new ConfigLoader();

module.exports = configLoader;
