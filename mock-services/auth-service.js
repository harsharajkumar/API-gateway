/**
 * Mock Auth Service
 * Simple backend service for testing the API Gateway
 *
 * Run with: node mock-services/auth-service.js PORT
 * Example: node mock-services/auth-service.js 5001
 */

const express = require('express');
const app = express();

const PORT = process.argv[2] || 5001;
const SERVICE_NAME = `auth-service-${PORT}`;

app.use(express.json());

// Mock user store for auth
const users = {
  'alice@example.com': { id: 1, name: 'Alice Johnson', password: 'password123' },
  'bob@example.com':   { id: 2, name: 'Bob Smith',     password: 'password456' }
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString()
  });
});

// Base path — list available endpoints
app.all('/', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    endpoints: [
      'POST /api/auth/login  — body: { email, password }',
      'POST /api/auth/logout — no body required',
      'POST /api/auth/verify — body: { token }'
    ],
    example: { email: 'alice@example.com', password: 'password123' }
  });
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      service: SERVICE_NAME,
      error: 'Email and password are required',
      timestamp: new Date().toISOString()
    });
  }

  const user = users[email];

  if (!user || user.password !== password) {
    return res.status(401).json({
      service: SERVICE_NAME,
      error: 'Invalid credentials',
      timestamp: new Date().toISOString()
    });
  }

  // Return a mock token
  res.json({
    service: SERVICE_NAME,
    data: {
      token: `mock-jwt-token-${user.id}-${Date.now()}`,
      userId: user.id,
      name: user.name,
      expiresIn: 3600
    },
    timestamp: new Date().toISOString()
  });
});

// Logout
app.post('/logout', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    data: { message: 'Logged out successfully' },
    timestamp: new Date().toISOString()
  });
});

// Verify token
app.post('/verify', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      service: SERVICE_NAME,
      error: 'Token is required',
      timestamp: new Date().toISOString()
    });
  }

  // Mock token verification
  const isValid = token.startsWith('mock-jwt-token-');

  if (isValid) {
    res.json({
      service: SERVICE_NAME,
      data: { valid: true, message: 'Token is valid' },
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(401).json({
      service: SERVICE_NAME,
      error: 'Invalid token',
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║  Mock Auth Service Started                ║
║                                            ║
║  Service: ${SERVICE_NAME}            ║
║  Port:    ${PORT}                          ║
║  Health:  http://localhost:${PORT}/health   ║
║  Login:   POST /login                      ║
║  Verify:  POST /verify                     ║
╚════════════════════════════════════════════╝
  `);
});
