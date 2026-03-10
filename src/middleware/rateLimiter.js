/**
 * Rate Limiter Middleware
 * Applies rate limiting to requests based on route configuration
 */

const TokenBucketRateLimiter = require('./tokenBucket');
const SlidingWindowRateLimiter = require('./slidingWindow');
const logger = require('../utils/logger');

class RateLimiterMiddleware {
  constructor() {
    this.limiters = new Map();
  }

  /**
   * Create rate limiter for a route
   */
  createLimiter(route, algorithm = 'token-bucket') {
    const key = `${route.id}-${algorithm}`;

    if (!this.limiters.has(key)) {
      const options = {
        maxRequests: route.rateLimit || 100,
        capacity: route.rateLimit || 100,
        refillRate: Math.ceil((route.rateLimit || 100) / 60), // Per second
        windowSeconds: 60
      };

      let limiter;
      if (algorithm === 'sliding-window') {
        limiter = new SlidingWindowRateLimiter(options);
      } else {
        limiter = new TokenBucketRateLimiter(options);
      }

      this.limiters.set(key, limiter);
      
      logger.info('Rate limiter created', {
        routeId: route.id,
        algorithm,
        maxRequests: options.maxRequests || options.capacity
      });
    }

    return this.limiters.get(key);
  }

  /**
   * Apply rate limiting middleware
   */
  middleware(route, algorithm = 'token-bucket') {
    return async (req, res, next) => {
      // Skip if rate limiting disabled for route
      if (!route || route.rateLimit === 0 || route.rateLimit === false) {
        return next();
      }

      try {
        // Get identifier (IP address or user ID from header)
        const identifier = this.getIdentifier(req);

        // Get or create rate limiter for this route
        const limiter = this.createLimiter(route, algorithm);

        // Check rate limit
        const result = await limiter.checkLimit(identifier);

        // Add rate limit headers to response
        res.setHeader('X-RateLimit-Limit', route.rateLimit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', result.resetTime);
        res.setHeader('X-RateLimit-Algorithm', algorithm);

        if (result.allowed) {
          logger.debug('Rate limit check passed', {
            identifier,
            route: route.id,
            remaining: result.remaining,
            algorithm
          });

          return next();
        } else {
          // Rate limit exceeded
          logger.warn('Rate limit exceeded', {
            identifier,
            route: route.id,
            algorithm,
            resetTime: new Date(result.resetTime).toISOString()
          });

          res.setHeader('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000));

          return res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Maximum ${route.rateLimit} requests per minute.`,
            retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
            timestamp: new Date().toISOString()
          });
        }

      } catch (error) {
        logger.error('Rate limiter middleware error', {
          error: error.message,
          route: route?.id
        });

        // On error, allow request (fail open)
        return next();
      }
    };
  }

  /**
   * Get identifier from request
   * Priority: X-API-Key header > X-User-ID header > IP address
   */
  getIdentifier(req) {
    // Check for API key
    const apiKey = req.get('X-API-Key');
    if (apiKey) {
      return `apikey:${apiKey}`;
    }

    // Check for user ID
    const userId = req.get('X-User-ID');
    if (userId) {
      return `user:${userId}`;
    }

    // Fall back to IP address
    const ip = req.ip || req.connection.remoteAddress;
    return `ip:${ip}`;
  }

  /**
   * Reset rate limit for an identifier (admin endpoint)
   */
  async reset(routeId, identifier, algorithm = 'token-bucket') {
    const key = `${routeId}-${algorithm}`;
    const limiter = this.limiters.get(key);

    if (limiter) {
      await limiter.reset(identifier);
      logger.info('Rate limit reset', { routeId, identifier, algorithm });
      return true;
    }

    return false;
  }

  /**
   * Get state for debugging
   */
  async getState(routeId, identifier, algorithm = 'token-bucket') {
    const key = `${routeId}-${algorithm}`;
    const limiter = this.limiters.get(key);

    if (limiter) {
      return await limiter.getState(identifier);
    }

    return null;
  }
}

// Singleton instance
const rateLimiterMiddleware = new RateLimiterMiddleware();

module.exports = rateLimiterMiddleware;
