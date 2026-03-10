/**
 * Sliding Window Rate Limiter
 * More accurate than fixed window, prevents burst attacks
 * 
 * How it works:
 * - Counts requests in last N seconds
 * - Uses weighted calculation between current and previous window
 * - Smoother rate limiting than token bucket
 */

const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { metrics } = require('./metrics');

class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 100;
    this.windowSeconds = options.windowSeconds || 60;
  }

  /**
   * Check if request should be allowed
   * @param {string} identifier - User ID, IP address, or API key
   * @returns {object} - { allowed: boolean, remaining: number, resetTime: number }
   */
  async checkLimit(identifier) {
    const now = Date.now();
    const windowMs = this.windowSeconds * 1000;

    // Keys for current and previous window
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const previousWindowStart = currentWindowStart - windowMs;

    const currentKey = `ratelimit:sliding:${identifier}:${currentWindowStart}`;
    const previousKey = `ratelimit:sliding:${identifier}:${previousWindowStart}`;

    try {
      // Get counts from both windows
      const currentCount = parseInt(await redisClient.get(currentKey)) || 0;
      const previousCount = parseInt(await redisClient.get(previousKey)) || 0;

      // Calculate weighted count using sliding window algorithm
      // Weight = percentage of current window elapsed
      const percentageElapsed = (now - currentWindowStart) / windowMs;
      const weightedCount = 
        (previousCount * (1 - percentageElapsed)) + currentCount;

      logger.debug('Sliding window calculation', {
        identifier,
        currentCount,
        previousCount,
        weightedCount: weightedCount.toFixed(2),
        percentageElapsed: (percentageElapsed * 100).toFixed(2) + '%'
      });

      // Check if under limit
      if (weightedCount < this.maxRequests) {
        // Increment current window count
        await this.incrementWindow(currentKey);

        const remaining = Math.max(0, this.maxRequests - Math.ceil(weightedCount) - 1);
        const resetTime = currentWindowStart + windowMs;

        logger.debug('Sliding window - request allowed', {
          identifier,
          remaining,
          weightedCount: weightedCount.toFixed(2)
        });

        return {
          allowed: true,
          remaining,
          resetTime,
          currentCount: currentCount + 1,
          weightedCount: Math.ceil(weightedCount)
        };

      } else {
        // Rate limit exceeded
        logger.warn('Sliding window - rate limit exceeded', {
          identifier,
          weightedCount: weightedCount.toFixed(2),
          maxRequests: this.maxRequests
        });

        // Record metric
        metrics.rateLimitExceeded.labels('sliding-window').inc();

        const resetTime = currentWindowStart + windowMs;

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          currentCount,
          weightedCount: Math.ceil(weightedCount)
        };
      }

    } catch (error) {
      logger.error('Sliding window error', {
        identifier,
        error: error.message
      });

      // On error, allow request (fail open)
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetTime: now + windowMs,
        error: true
      };
    }
  }

  /**
   * Increment window counter
   */
  async incrementWindow(key) {
    const count = await redisClient.increment(key);
    
    // Set expiration (2x window to keep previous window)
    if (count === 1) {
      await redisClient.expire(key, this.windowSeconds * 2);
    }

    return count;
  }

  /**
   * Reset rate limit for identifier (for testing)
   */
  async reset(identifier) {
    const pattern = `ratelimit:sliding:${identifier}:*`;
    const keys = await redisClient.keys(pattern);

    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisClient.delete(key)));
      logger.info('Sliding window reset', { identifier, keysDeleted: keys.length });
    }
  }

  /**
   * Get current state (for debugging)
   */
  async getState(identifier) {
    const now = Date.now();
    const windowMs = this.windowSeconds * 1000;
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const previousWindowStart = currentWindowStart - windowMs;

    const currentKey = `ratelimit:sliding:${identifier}:${currentWindowStart}`;
    const previousKey = `ratelimit:sliding:${identifier}:${previousWindowStart}`;

    const currentCount = parseInt(await redisClient.get(currentKey)) || 0;
    const previousCount = parseInt(await redisClient.get(previousKey)) || 0;

    const percentageElapsed = (now - currentWindowStart) / windowMs;
    const weightedCount = 
      (previousCount * (1 - percentageElapsed)) + currentCount;

    return {
      currentWindow: {
        start: new Date(currentWindowStart).toISOString(),
        count: currentCount
      },
      previousWindow: {
        start: new Date(previousWindowStart).toISOString(),
        count: previousCount
      },
      percentageElapsed: (percentageElapsed * 100).toFixed(2) + '%',
      weightedCount: weightedCount.toFixed(2),
      maxRequests: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - Math.ceil(weightedCount))
    };
  }
}

module.exports = SlidingWindowRateLimiter;
