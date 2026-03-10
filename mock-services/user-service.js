/**
 * Mock User Service
 * Simple backend service for testing the API Gateway
 * 
 * Run with: node mock-services/user-service.js PORT
 * Example: node mock-services/user-service.js 3001
 */

const express = require('express');
const app = express();

// Get port from command line or use 3001
const PORT = process.argv[2] || 3001;
const SERVICE_NAME = `user-service-${PORT}`;

app.use(express.json());

// Mock user data
const users = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@example.com' }
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString()
  });
});

// Get all users
app.get('/users', (req, res) => {
  // Simulate processing time
  setTimeout(() => {
    res.json({
      service: SERVICE_NAME,
      data: users,
      timestamp: new Date().toISOString()
    });
  }, Math.random() * 100); // Random 0-100ms delay
});

// Get user by ID
app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  
  setTimeout(() => {
    if (user) {
      res.json({
        service: SERVICE_NAME,
        data: user,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        service: SERVICE_NAME,
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
  }, Math.random() * 100);
});

// Create user
app.post('/users', (req, res) => {
  const newUser = {
    id: users.length + 1,
    name: req.body.name,
    email: req.body.email
  };
  
  users.push(newUser);
  
  res.status(201).json({
    service: SERVICE_NAME,
    data: newUser,
    timestamp: new Date().toISOString()
  });
});

// Update user
app.put('/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  
  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    
    res.json({
      service: SERVICE_NAME,
      data: user,
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(404).json({
      service: SERVICE_NAME,
      error: 'User not found'
    });
  }
});

// Delete user
app.delete('/users/:id', (req, res) => {
  const index = users.findIndex(u => u.id === parseInt(req.params.id));
  
  if (index !== -1) {
    const deleted = users.splice(index, 1);
    res.json({
      service: SERVICE_NAME,
      data: deleted[0],
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(404).json({
      service: SERVICE_NAME,
      error: 'User not found'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║  🔧 Mock User Service Started            ║
║                                           ║
║  Service: ${SERVICE_NAME}            ║
║  Port:    ${PORT}                         ║
║  Health:  http://localhost:${PORT}/health  ║
║  Users:   http://localhost:${PORT}/users   ║
╚═══════════════════════════════════════════╝
  `);
});
