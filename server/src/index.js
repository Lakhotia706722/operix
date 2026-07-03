require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');
const cron = require('node-cron');
const { Server } = require('socket.io');

const validateEnv = require('./utils/validateEnv');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { connectCloudinary } = require('./config/cloudinary');
const { createTransporter } = require('./config/mailer');
const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');
const { attachRedisStores } = require('./middlewares/rateLimiter');
const notificationService = require('./services/notificationService');
const initSocket = require('./sockets');

// Validate environment before proceeding
if (process.env.NODE_ENV !== 'test') {
  validateEnv();
}

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const boardRoutes = require('./routes/boards');
const taskRoutes = require('./routes/tasks');
const notificationRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');

const app = express();

// ── HTTP + Socket.io server ───────────────────────────────────────────────────
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
});

// Attach io to every request so controllers can emit events
app.use((req, _res, next) => { req.io = io; next(); });


// ── Security middleware ───────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: ["'self'", process.env.CLIENT_URL || 'http://localhost:5173'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    } : false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
  })
);

const allowedOrigins = process.env.CLIENT_URL 
  ? process.env.CLIENT_URL.split(',').map(url => url.trim())
  : ['http://localhost:5173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 600, // 10 minutes
  })
);
app.use(mongoSanitize());   // Prevent NoSQL injection
app.use(xssClean());        // Sanitize user input from XSS

// ── General middleware ────────────────────────────────────────────────────────
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: '1.0.0',
  };

  // Detailed health check for monitoring systems
  if (req.query.detailed === 'true') {
    try {
      // Check MongoDB
      const mongoose = require('mongoose');
      const mongoStatus = mongoose.connection.readyState;
      health.mongodb = mongoStatus === 1 ? 'connected' : 'disconnected';

      // Check Redis
      const { getRedis } = require('./config/redis');
      const redis = getRedis();
      if (redis) {
        await redis.ping();
        health.redis = 'connected';
      } else {
        health.redis = 'not_configured';
      }

      // Memory usage
      const memUsage = process.memoryUsage();
      health.memory = {
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      };

      res.json(health);
    } catch (error) {
      health.status = 'degraded';
      health.error = error.message;
      res.status(503).json(health);
    }
  } else {
    res.json(health);
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/boards/:boardId/tasks', taskRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found.', code: 'NOT_FOUND' } });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// Server and Socket.io instances are initialized above routes to ensure req.io is available.

// ── Startup ───────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await connectDB();
    await connectRedis();
    connectCloudinary();
    if (process.env.NODE_ENV !== 'test') createTransporter();

    // Attach Redis stores to rate limiters (must be after connectRedis)
    attachRedisStores();

    // Init socket with auth + rooms
    initSocket(io);

    // Inject io into notification service for real-time pushes
    notificationService.setIo(io);

    // ── Cron jobs ──────────────────────────────────────────────────────────
    // Daily at 08:00 — send due-date reminders
    cron.schedule('0 8 * * *', async () => {
      logger.info('Running due-date reminder cron...');
      await notificationService.sendDueDateReminders();
    });

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }
};

// Only start if run directly (not imported for tests)
if (require.main === module) start();

module.exports = { app, server, io };
