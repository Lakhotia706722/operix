const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient;
let subscriberClient;
let publisherClient;

const createClient = () => {
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) return null; // stop retrying after 3 attempts
      return Math.min(times * 100, 1000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on('connect', () => logger.info('Redis client connected'));
  client.on('error', (err) => logger.warn(`Redis not available: ${err.message}`));

  return client;
};

const connectRedis = async () => {
  try {
    redisClient = createClient();
    subscriberClient = createClient();
    publisherClient = createClient();

    await Promise.race([
      Promise.all([
        redisClient.connect(),
        subscriberClient.connect(),
        publisherClient.connect(),
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 3000))
    ]);
    
    logger.info('✅ Redis connected');
  } catch (err) {
    logger.warn('⚠️  Redis not available - using in-memory fallback for caching and rate limiting');
    if (redisClient) redisClient.disconnect();
    if (subscriberClient) subscriberClient.disconnect();
    if (publisherClient) publisherClient.disconnect();
    redisClient = null;
    subscriberClient = null;
    publisherClient = null;
  }
};

const getRedis = () => redisClient;
const getSubscriber = () => subscriberClient;
const getPublisher = () => publisherClient;

module.exports = { connectRedis, getRedis, getSubscriber, getPublisher };
