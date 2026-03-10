/**
 * Redis Client
 * Connection management and utility methods for Redis
 */

const Redis = require('ioredis');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Connect to Redis
   */
  async connect() {
    if (this.isConnected) {
      return this.client;
    }

    const config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3
    };

    try {
      this.client = new Redis(config);

      this.client.on('connect', () => {
        logger.info('Redis connected', {
          host: config.host,
          port: config.port,
          db: config.db
        });
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        logger.error('Redis connection error', {
          error: error.message
        });
        this.isConnected = false;
      });

      this.client.on('close', () => {
        logger.warn('Redis connection closed');
        this.isConnected = false;
      });

      // Wait for connection
      await this.client.ping();
      
      return this.client;

    } catch (error) {
      logger.error('Failed to connect to Redis', {
        error: error.message,
        config: {
          host: config.host,
          port: config.port
        }
      });
      throw error;
    }
  }

  /**
   * Get value by key
   */
  async get(key) {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis GET error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Set value with optional expiration
   */
  async set(key, value, expirationSeconds = null) {
    try {
      if (expirationSeconds) {
        return await this.client.setex(key, expirationSeconds, value);
      }
      return await this.client.set(key, value);
    } catch (error) {
      logger.error('Redis SET error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Increment key by 1
   */
  async increment(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error('Redis INCR error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Get and increment atomically
   */
  async getAndIncrement(key, expirationSeconds = null) {
    try {
      const multi = this.client.multi();
      multi.incr(key);
      
      if (expirationSeconds) {
        multi.expire(key, expirationSeconds);
      }
      
      const results = await multi.exec();
      return results[0][1]; // Return incremented value
    } catch (error) {
      logger.error('Redis GET_AND_INCR error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Delete key
   */
  async delete(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error('Redis DEL error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    try {
      return await this.client.exists(key) === 1;
    } catch (error) {
      logger.error('Redis EXISTS error', { key, error: error.message });
      return false;
    }
  }

  /**
   * Set expiration on key
   */
  async expire(key, seconds) {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error('Redis EXPIRE error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Get remaining TTL
   */
  async ttl(key) {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis TTL error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern) {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis KEYS error', { pattern, error: error.message });
      return [];
    }
  }

  /**
   * Flush all data (use carefully!)
   */
  async flushAll() {
    try {
      logger.warn('Flushing all Redis data');
      return await this.client.flushall();
    } catch (error) {
      logger.error('Redis FLUSHALL error', { error: error.message });
      return null;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      db: parseInt(process.env.REDIS_DB) || 0
    };
  }
}

// Singleton instance
const redisClient = new RedisClient();

// Auto-connect on startup
redisClient.connect().catch(error => {
  logger.error('Failed to connect to Redis on startup', {
    error: error.message
  });
});

module.exports = redisClient;
