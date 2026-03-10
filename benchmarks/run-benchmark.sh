#!/bin/bash

# Performance Benchmark Script
# Tests gateway performance and measures throughput

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║       API Gateway Performance Benchmark                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

GATEWAY_URL="http://localhost:8080"

# Check if gateway is running
echo "1. Checking if gateway is running..."
if ! curl -s -f "$GATEWAY_URL/health" > /dev/null; then
    echo "❌ Gateway is not running on $GATEWAY_URL"
    echo "   Start it with: npm run dev"
    exit 1
fi
echo "✅ Gateway is running"
echo ""

# Check if autocannon is installed
if ! command -v autocannon &> /dev/null; then
    echo "Installing autocannon (load testing tool)..."
    npm install -g autocannon
fi

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Test 1: Light Load (100 connections, 30 seconds)        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
autocannon -c 100 -d 30 "$GATEWAY_URL/api/users"
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Test 2: Medium Load (500 connections, 30 seconds)       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
autocannon -c 500 -d 30 "$GATEWAY_URL/api/users"
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Test 3: Heavy Load (1000 connections, 30 seconds)       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
autocannon -c 1000 -d 30 "$GATEWAY_URL/api/users"
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Test 4: Peak Performance Test                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo "Finding maximum throughput..."
autocannon -c 2000 -d 60 "$GATEWAY_URL/api/users"
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Benchmark Complete!                                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "Key Metrics to Look For:"
echo "  • Throughput: Should be 15,000-25,000+ req/s"
echo "  • Latency p99: Should be <15ms"
echo "  • Error rate: Should be <1%"
echo ""
echo "View detailed metrics:"
echo "  • Prometheus: http://localhost:9090"
echo "  • Gateway stats: curl $GATEWAY_URL/_admin/stats"
