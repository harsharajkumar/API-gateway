#!/bin/bash

# Test script to verify API Gateway is working

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          Testing API Gateway                              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

GATEWAY_URL="http://localhost:8080"

# Test 1: Health check
echo "Test 1: Health Check"
echo "-------------------"
curl -s $GATEWAY_URL/health | jq .
echo ""
echo ""

# Test 2: Route to backend
echo "Test 2: GET /api/users (should route to backend)"
echo "------------------------------------------------"
curl -s $GATEWAY_URL/api/users | jq .
echo ""
echo ""

# Test 3: Get specific user
echo "Test 3: GET /api/users/1 (should get specific user)"
echo "---------------------------------------------------"
curl -s $GATEWAY_URL/api/users/1 | jq .
echo ""
echo ""

# Test 4: Load balancing - make 6 requests
echo "Test 4: Load Balancing (6 requests to see round-robin)"
echo "------------------------------------------------------"
for i in {1..6}; do
  echo "Request $i:"
  curl -s $GATEWAY_URL/api/users | jq -r '.service'
done
echo ""
echo ""

# Test 5: View stats
echo "Test 5: Gateway Statistics"
echo "-------------------------"
curl -s $GATEWAY_URL/_admin/stats | jq .
echo ""
echo ""

echo "✅ All tests completed!"
echo ""
echo "What you should see:"
echo "  - Health check shows UP"
echo "  - User requests return data"
echo "  - Service names rotate (3001 → 3002 → 3003 → 3001...)"
echo "  - Stats show request counts per instance"
