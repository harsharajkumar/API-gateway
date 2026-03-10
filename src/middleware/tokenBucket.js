/**
 * Token Bucket Rate Limiter
 * Classic rate limiting algorithm
 * 
 * How it works:
 * - Bucket holds tokens (capacity)
 * - Each request consumes 1 token
 * - Tokens refill at constant rate
 * - If no tokens available -> rate limited
 */

const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { metrics } = require('./metrics');

class TokenBucketRateLimiter {
  constructor(options = {}) {
    this.capacity = options.capacity || 100;      // Max tokens in bucket
    this.refillRate = options.refillRate || 10;   // Tokens per second
    this.windowSeconds = options.windowSeconds || 60;
  }

  /**
   * Check if request should be allowed
   * @param {string} identifier - User ID, IP address, or API key
   * @returns {object} - { allowed: boolean, remaining: number, resetTime: number }
   */
  async checkLimit(identifier) {
    const key = `ratelimit:tokenbucket:${identifier}`;
    const now = Date.now();

    try {
      // Get current bucket state
      const bucketData = await redisClient.get(key);
      
      let tokens, lastRefill;

      if (!bucketData) {
        // First request - initialize bucket
        tokens = this.capacity - 1; // Consume 1 token for this request
        lastRefill = now;
        
        await this.saveBucket(key, tokens, lastRefill);
        
        logger.debug('Token bucket initialized', {
          identifier,
          tokens,
          capacity: this.capacity
        });

        return {
          allowed: true,
          remaining: tokens,
          resetTime: now + (this.windowSeconds * 1000)
        };
      }

      // Parse existing bucket
      const bucket = JSON.parse(bucketData);
      tokens = bucket.tokens;
      lastRefill = bucket.lastRefill;

      // Calculate tokens to add based on time elapsed
      const elapsed = (now - lastRefill) / 1000; // Convert to seconds
      const tokensToAdd = Math.floor(elapsed * this.refillRate);

      // Refill tokens (up to capacity)
      tokens = Math.min(this.capacity, tokens + tokensToAdd);

      // Update last refill time if we added tokens
      if (tokensToAdd > 0) {
        lastRefill = now;
      }

      // Try to consume 1 token
      if (tokens > 0) {
        tokens -= 1;
        
        await this.saveBucket(key, tokens, lastRefill);

        logger.debug('Token bucket - request allowed', {
          identifier,
          tokens,
          tokensToAdd
        });

        return {
          allowed: true,
          remaining: tokens,
          resetTime: now + (this.windowSeconds * 1000)
        };

      } else {
        // No tokens available - rate limited
        logger.warn('Token bucket - rate limit exceeded', {
          identifier,
          tokens
        });

        // Record metric
        metrics.rateLimitExceeded.labels('token-bucket').inc();

        // Calculate when tokens will be available
        const secondsUntilToken = 1 / this.refillRate;
        const resetTime = now + (secondsUntilToken * 1000);

        return {
          allowed: false,
          remaining: 0,
          resetTime: Math.ceil(resetTime)
        };
      }

    } catch (error) {
      logger.error('Token bucket error', {
        identifier,
        error: error.message
      });

      // On error, allow request (fail open)
      return {
        allowed: true,
        remaining: this.capacity,
        resetTime: now + (this.windowSeconds * 1000),
        error: true
      };
    }
  }

  /**
   * Save bucket state to Redis
   */
  async saveBucket(key, tokens, lastRefill) {
    const bucket = {
      tokens,
      lastRefill
    };

    await redisClient.set(
      key,
      JSON.stringify(bucket),
      this.windowSeconds
    );
  }

  /**
   * Reset rate limit for identifier (for testing)
   */
  async reset(identifier) {
    const key = `ratelimit:tokenbucket:${identifier}`;
    await redisClient.delete(key);
    logger.info('Token bucket reset', { identifier });
  }

  /**
   * Get current bucket state (for debugging)
   */
  async getState(identifier) {
    const key = `ratelimit:tokenbucket:${identifier}`;
    const bucketData = await redisClient.get(key);

    if (!bucketData) {
      return {
        tokens: this.capacity,
        lastRefill: null,
        capacity: this.capacity,
        refillRate: this.refillRate
      };
    }

    const bucket = JSON.parse(bucketData);
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = Math.floor(elapsed * this.refillRate);
    const currentTokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);

    return {
      tokens: currentTokens,
      lastRefill: bucket.lastRefill,
      capacity: this.capacity,
      refillRate: this.refillRate,
      elapsed
    };
  }
}

module.exports = TokenBucketRateLimiter;
