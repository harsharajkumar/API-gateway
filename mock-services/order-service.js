/**
 * Mock Order Service
 * Simple backend service for testing the API Gateway
 *
 * Run with: node mock-services/order-service.js PORT
 * Example: node mock-services/order-service.js 4001
 */

const express = require('express');
const app = express();

const PORT = process.argv[2] || 4001;
const SERVICE_NAME = `order-service-${PORT}`;

app.use(express.json());

// Mock order data
const orders = [
  { id: 1, userId: 1, product: 'Laptop', quantity: 1, price: 1299.99, status: 'delivered' },
  { id: 2, userId: 2, product: 'Headphones', quantity: 2, price: 199.99, status: 'shipped' },
  { id: 3, userId: 1, product: 'Keyboard', quantity: 1, price: 89.99, status: 'processing' }
];

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString()
  });
});

// Get all orders
app.get('/orders', (req, res) => {
  setTimeout(() => {
    res.json({
      service: SERVICE_NAME,
      data: orders,
      timestamp: new Date().toISOString()
    });
  }, Math.random() * 100);
});

// Get order by ID
app.get('/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === parseInt(req.params.id));

  setTimeout(() => {
    if (order) {
      res.json({ service: SERVICE_NAME, data: order, timestamp: new Date().toISOString() });
    } else {
      res.status(404).json({ service: SERVICE_NAME, error: 'Order not found', timestamp: new Date().toISOString() });
    }
  }, Math.random() * 100);
});

// Create order
app.post('/orders', (req, res) => {
  const newOrder = {
    id: orders.length + 1,
    userId: req.body.userId,
    product: req.body.product,
    quantity: req.body.quantity || 1,
    price: req.body.price,
    status: 'processing'
  };

  orders.push(newOrder);

  res.status(201).json({
    service: SERVICE_NAME,
    data: newOrder,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║  Mock Order Service Started               ║
║                                            ║
║  Service: ${SERVICE_NAME}           ║
║  Port:    ${PORT}                          ║
║  Health:  http://localhost:${PORT}/health   ║
║  Orders:  http://localhost:${PORT}/orders   ║
╚════════════════════════════════════════════╝
  `);
});
