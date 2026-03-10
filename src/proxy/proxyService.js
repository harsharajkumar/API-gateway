/**
 * Proxy Service
 * Forwards requests to backend instances
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { metrics } = require('../middleware/metrics');

class ProxyService {
  constructor() {
    // Create axios instance with defaults
    this.client = axios.create({
      timeout: 30000, // 30 second default timeout
      validateStatus: () => true, // Don't throw on any status code
      maxRedirects: 5
    });
  }

  /**
   * Proxy request to backend instance
   * @param {object} instance - Backend instance
   * @param {string} path - Request path
   * @param {string} method - HTTP method
   * @param {object} headers - Request headers
   * @param {object} body - Request body
   * @param {number} timeout - Request timeout in ms
   * @returns {object} - Response from backend
   */
  async proxyRequest(instance, path, method, headers, body, timeout = 30000) {
    const startTime = Date.now();
    const targetUrl = instance.url + path;

    logger.info('Proxying request', {
      method,
      targetUrl,
      instance: instance.url
    });

    try {
      // Make request to backend
      const response = await this.client({
        method,
        url: targetUrl,
        headers: this.cleanHeaders(headers),
        data: body,
        timeout
      });

      const duration = (Date.now() - startTime) / 1000; // Convert to seconds

      // Record metrics
      metrics.backendResponseTime
        .labels(instance.url, response.status)
        .observe(duration);

      logger.info('Backend response received', {
        method,
        targetUrl,
        statusCode: response.status,
        duration: `${duration.toFixed(3)}s`
      });

      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data
      };

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;

      // Record error metrics
      metrics.backendResponseTime
        .labels(instance.url, 'error')
        .observe(duration);

      logger.error('Backend request failed', {
        method,
        targetUrl,
        error: error.message,
        code: error.code,
        duration: `${duration.toFixed(3)}s`
      });

      // Return error response
      if (error.code === 'ECONNREFUSED') {
        return {
          statusCode: 503,
          headers: {},
          body: {
            error: 'Backend service unavailable',
            message: 'Unable to connect to backend service',
            instance: instance.url
          }
        };
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return {
          statusCode: 504,
          headers: {},
          body: {
            error: 'Gateway timeout',
            message: 'Backend service took too long to respond',
            instance: instance.url
          }
        };
      }

      // Generic error
      return {
        statusCode: 502,
        headers: {},
        body: {
          error: 'Bad gateway',
          message: error.message,
          instance: instance.url
        }
      };
    }
  }

  /**
   * Clean request headers before forwarding
   * Remove headers that shouldn't be forwarded
   * @param {object} headers - Original headers
   * @returns {object} - Cleaned headers
   */
  cleanHeaders(headers) {
    const cleaned = { ...headers };

    // Remove hop-by-hop headers
    delete cleaned['host'];
    delete cleaned['connection'];
    delete cleaned['keep-alive'];
    delete cleaned['proxy-authenticate'];
    delete cleaned['proxy-authorization'];
    delete cleaned['te'];
    delete cleaned['trailer'];
    delete cleaned['transfer-encoding'];
    delete cleaned['upgrade'];

    // Add X-Forwarded headers
    cleaned['X-Forwarded-For'] = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';
    cleaned['X-Forwarded-Proto'] = headers['x-forwarded-proto'] || 'http';
    cleaned['X-Forwarded-Host'] = headers['host'] || '';

    return cleaned;
  }

  /**
   * Health check a backend instance
   * @param {object} instance - Backend instance
   * @param {string} healthCheckPath - Health check path
   * @param {number} timeout - Timeout in ms
   * @returns {boolean} - true if healthy, false otherwise
   */
  async healthCheck(instance, healthCheckPath = '/health', timeout = 3000) {
    const url = instance.url + healthCheckPath;

    try {
      const response = await this.client.get(url, { timeout });

      const isHealthy = response.status >= 200 && response.status < 300;

      logger.debug('Health check completed', {
        instance: instance.url,
        statusCode: response.status,
        healthy: isHealthy
      });

      return isHealthy;

    } catch (error) {
      logger.debug('Health check failed', {
        instance: instance.url,
        error: error.message
      });
      return false;
    }
  }
}

module.exports = new ProxyService();
