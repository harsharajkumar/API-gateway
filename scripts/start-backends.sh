#!/bin/bash

# Script to start multiple mock backend services
# This simulates having 3 user service instances for load balancing

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     Starting Mock Backend Services                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Kill any existing instances on these ports
lsof -ti:3001,3002,3003,4001,4002,5001,5002 | xargs kill -9 2>/dev/null

# Start 3 instances of user service
echo "Starting user-service instances..."
node mock-services/user-service.js 3001 &
node mock-services/user-service.js 3002 &
node mock-services/user-service.js 3003 &

# Start 2 instances of order service
echo "Starting order-service instances..."
node mock-services/order-service.js 4001 &
node mock-services/order-service.js 4002 &

# Start 2 instances of auth service
echo "Starting auth-service instances..."
node mock-services/auth-service.js 5001 &
node mock-services/auth-service.js 5002 &

sleep 1

echo ""
echo "✅ All services started!"
echo ""
echo "Services:"
echo "  - user-service-3001:  http://localhost:3001"
echo "  - user-service-3002:  http://localhost:3002"
echo "  - user-service-3003:  http://localhost:3003"
echo "  - order-service-4001: http://localhost:4001"
echo "  - order-service-4002: http://localhost:4002"
echo "  - auth-service-5001:  http://localhost:5001"
echo "  - auth-service-5002:  http://localhost:5002"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for Ctrl+C
wait
