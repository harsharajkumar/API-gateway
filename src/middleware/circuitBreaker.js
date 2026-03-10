/**
 * Circuit Breaker
 * Prevents cascading failures by failing fast when backend is unhealthy
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, fail fast without calling backend
 * - HALF_OPEN: Testing if backend recovered
 */

const logger = require('../utils/logger');
const { metrics } = require('./metrics');

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;  // Failures before opening
    this.successThreshold = options.successThreshold || 2;   // Successes to close
    this.timeout = options.timeout || 60000;                 // Time before retry (ms)
    this.volumeThreshold = options.volumeThreshold || 10;    // Min requests before checking

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.requestCount = 0;
    this.nextAttempt = Date.now();
    this.lastStateChange = Date.now();
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute(fn, backendName) {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        // Still in timeout period
        logger.warn('Circuit breaker OPEN', {
          backend: backendName,
          failureCount: this.failureCount,
          nextAttempt: new Date(this.nextAttempt).toISOString()
        });

        throw new Error('Circuit breaker is OPEN');
      } else {
        // Timeout expired, try half-open
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info('Circuit breaker transitioning to HALF_OPEN', {
          backend: backendName
        });
      }
    }

    try {
      // Execute the function
      const result = await fn();
      
      // Success
      this.onSuccess(backendName);
      return result;

    } catch (error) {
      // Failure
      this.onFailure(backendName, error);
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  onSuccess(backendName) {
    this.requestCount++;
    this.failureCount = 0;  // Reset failure count

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        // Close the circuit
        this.close(backendName);
      }
    }

    // Update metrics
    metrics.circuitBreakerState.labels(backendName).set(this.getStateValue());
  }

  /**
   * Handle failed request
   */
  onFailure(backendName, error) {
    this.requestCount++;
    this.failureCount++;

    logger.warn('Circuit breaker recorded failure', {
      backend: backendName,
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      state: this.state,
      error: error.message
    });

    // Check if we should open the circuit
    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during testing - reopen immediately
      this.open(backendName);
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we've hit the threshold
      if (this.requestCount >= this.volumeThreshold &&
          this.failureCount >= this.failureThreshold) {
        this.open(backendName);
      }
    }

    // Update metrics
    metrics.circuitBreakerState.labels(backendName).set(this.getStateValue());
  }

  /**
   * Open the circuit (start failing fast)
   */
  open(backendName) {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.timeout;
    this.lastStateChange = Date.now();

    logger.error('Circuit breaker OPENED', {
      backend: backendName,
      failureCount: this.failureCount,
      timeout: this.timeout,
      nextAttempt: new Date(this.nextAttempt).toISOString()
    });

    metrics.circuitBreakerState.labels(backendName).set(1); // OPEN = 1
  }

  /**
   * Close the circuit (normal operation)
   */
  close(backendName) {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.requestCount = 0;
    this.lastStateChange = Date.now();

    logger.info('Circuit breaker CLOSED', {
      backend: backendName
    });

    metrics.circuitBreakerState.labels(backendName).set(0); // CLOSED = 0
  }

  /**
   * Get current state
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      nextAttempt: this.state === CircuitState.OPEN ? 
        new Date(this.nextAttempt).toISOString() : null,
      lastStateChange: new Date(this.lastStateChange).toISOString()
    };
  }

  /**
   * Get numeric state value for metrics
   */
  getStateValue() {
    switch (this.state) {
      case CircuitState.CLOSED: return 0;
      case CircuitState.OPEN: return 1;
      case CircuitState.HALF_OPEN: return 2;
      default: return 0;
    }
  }

  /**
   * Force open (for testing)
   */
  forceOpen(backendName) {
    this.open(backendName);
  }

  /**
   * Force close (for testing)
   */
  forceClose(backendName) {
    this.close(backendName);
  }

  /**
   * Reset circuit breaker
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.requestCount = 0;
    this.nextAttempt = Date.now();
  }
}

module.exports = CircuitBreaker;
module.exports.CircuitState = CircuitState;
