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
    this.useMemoryStore = false;
    this.memoryStore = new Map();
    this.memoryExpiry = new Map();
    this.redisOptional = process.env.REDIS_OPTIONAL !== 'false';
  }

  /**
   * Connect to Redis
   */
  async connect() {
    if (this.useMemoryStore) {
      return null;
    }

    if (this.isConnected) {
      return this.client;
    }

    const config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 2000,
      retryStrategy: this.redisOptional
        ? () => null
        : (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: this.redisOptional ? 1 : 3
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

        if (this.redisOptional) {
          this.enableMemoryFallback('connection closed');
        }
      });

      await this.client.connect();
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

      if (this.redisOptional) {
        this.enableMemoryFallback(error.message);
        return null;
      }

      throw error;
    }
  }

  /**
   * Get value by key
   */
  async get(key) {
    if (this.useMemoryStore) {
      return this.getFromMemory(key);
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      return this.handleRuntimeError('GET', error, { key }, () => this.getFromMemory(key));
    }
  }

  /**
   * Set value with optional expiration
   */
  async set(key, value, expirationSeconds = null) {
    if (this.useMemoryStore) {
      return this.setInMemory(key, value, expirationSeconds);
    }

    try {
      if (expirationSeconds) {
        return await this.client.setex(key, expirationSeconds, value);
      }
      return await this.client.set(key, value);
    } catch (error) {
      return this.handleRuntimeError('SET', error, { key }, () => this.setInMemory(key, value, expirationSeconds));
    }
  }

  /**
   * Increment key by 1
   */
  async increment(key) {
    if (this.useMemoryStore) {
      return this.incrementInMemory(key);
    }

    try {
      return await this.client.incr(key);
    } catch (error) {
      return this.handleRuntimeError('INCR', error, { key }, () => this.incrementInMemory(key));
    }
  }

  /**
   * Get and increment atomically
   */
  async getAndIncrement(key, expirationSeconds = null) {
    if (this.useMemoryStore) {
      const value = await this.incrementInMemory(key);

      if (expirationSeconds) {
        await this.expireInMemory(key, expirationSeconds);
      }

      return value;
    }

    try {
      const multi = this.client.multi();
      multi.incr(key);
      
      if (expirationSeconds) {
        multi.expire(key, expirationSeconds);
      }
      
      const results = await multi.exec();
      return results[0][1]; // Return incremented value
    } catch (error) {
      return this.handleRuntimeError('GET_AND_INCR', error, { key }, async () => {
        const value = await this.incrementInMemory(key);

        if (expirationSeconds) {
          await this.expireInMemory(key, expirationSeconds);
        }

        return value;
      });
    }
  }

  /**
   * Delete key
   */
  async delete(key) {
    if (this.useMemoryStore) {
      return this.deleteFromMemory(key);
    }

    try {
      return await this.client.del(key);
    } catch (error) {
      return this.handleRuntimeError('DEL', error, { key }, () => this.deleteFromMemory(key));
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (this.useMemoryStore) {
      return this.existsInMemory(key);
    }

    try {
      return await this.client.exists(key) === 1;
    } catch (error) {
      return this.handleRuntimeError('EXISTS', error, { key }, () => this.existsInMemory(key));
    }
  }

  /**
   * Set expiration on key
   */
  async expire(key, seconds) {
    if (this.useMemoryStore) {
      return this.expireInMemory(key, seconds);
    }

    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      return this.handleRuntimeError('EXPIRE', error, { key }, () => this.expireInMemory(key, seconds));
    }
  }

  /**
   * Get remaining TTL
   */
  async ttl(key) {
    if (this.useMemoryStore) {
      return this.ttlInMemory(key);
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      return this.handleRuntimeError('TTL', error, { key }, () => this.ttlInMemory(key));
    }
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern) {
    if (this.useMemoryStore) {
      return this.keysInMemory(pattern);
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      return this.handleRuntimeError('KEYS', error, { pattern }, () => this.keysInMemory(pattern));
    }
  }

  /**
   * Flush all data (use carefully!)
   */
  async flushAll() {
    if (this.useMemoryStore) {
      this.memoryStore.clear();
      this.memoryExpiry.clear();
      return 'OK';
    }

    try {
      logger.warn('Flushing all Redis data');
      return await this.client.flushall();
    } catch (error) {
      return this.handleRuntimeError('FLUSHALL', error, {}, () => {
        this.memoryStore.clear();
        this.memoryExpiry.clear();
        return 'OK';
      });
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
      mode: this.useMemoryStore ? 'memory' : 'redis',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      db: parseInt(process.env.REDIS_DB) || 0
    };
  }

  enableMemoryFallback(reason) {
    if (this.useMemoryStore) {
      return;
    }

    this.useMemoryStore = true;
    this.isConnected = false;

    if (this.client) {
      this.client.disconnect(false);
      this.client = null;
    }

    logger.warn('Redis unavailable, using in-memory store instead', {
      reason,
      note: 'Rate limiting remains functional, but state is local to this container.'
    });
  }

  handleRuntimeError(operation, error, metadata, fallback) {
    logger.error(`Redis ${operation} error`, {
      ...metadata,
      error: error.message
    });

    if (this.redisOptional) {
      this.enableMemoryFallback(error.message);
      return fallback();
    }

    return null;
  }

  isExpired(key) {
    const expiry = this.memoryExpiry.get(key);

    if (!expiry) {
      return false;
    }

    if (Date.now() >= expiry) {
      this.memoryStore.delete(key);
      this.memoryExpiry.delete(key);
      return true;
    }

    return false;
  }

  getFromMemory(key) {
    this.isExpired(key);
    return this.memoryStore.has(key) ? this.memoryStore.get(key) : null;
  }

  setInMemory(key, value, expirationSeconds = null) {
    this.memoryStore.set(key, value);

    if (expirationSeconds) {
      this.memoryExpiry.set(key, Date.now() + (expirationSeconds * 1000));
    } else {
      this.memoryExpiry.delete(key);
    }

    return 'OK';
  }

  incrementInMemory(key) {
    this.isExpired(key);
    const currentValue = parseInt(this.memoryStore.get(key) || '0', 10);
    const nextValue = currentValue + 1;
    this.memoryStore.set(key, String(nextValue));
    return nextValue;
  }

  deleteFromMemory(key) {
    this.memoryExpiry.delete(key);
    return this.memoryStore.delete(key) ? 1 : 0;
  }

  existsInMemory(key) {
    this.isExpired(key);
    return this.memoryStore.has(key);
  }

  expireInMemory(key, seconds) {
    if (!this.memoryStore.has(key)) {
      return 0;
    }

    this.memoryExpiry.set(key, Date.now() + (seconds * 1000));
    return 1;
  }

  ttlInMemory(key) {
    if (!this.memoryStore.has(key)) {
      return -2;
    }

    if (this.isExpired(key)) {
      return -2;
    }

    const expiry = this.memoryExpiry.get(key);

    if (!expiry) {
      return -1;
    }

    return Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
  }

  keysInMemory(pattern) {
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')}$`
    );

    return Array.from(this.memoryStore.keys()).filter((key) => {
      this.isExpired(key);
      return this.memoryStore.has(key) && regex.test(key);
    });
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
