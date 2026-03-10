# Week 1 - Core Gateway Implementation ✅

## What We Built

### New Files Created:
1. **src/router/routeMatcher.js** - Matches incoming requests to configured routes
2. **src/loadbalancer/roundRobin.js** - Round-robin load balancing algorithm
3. **src/proxy/proxyService.js** - Forwards requests to backend instances
4. **src/routes/gateway.js** - UPDATED with real implementation
5. **scripts/start-backends.sh** - Script to start mock services (Mac/Linux)
6. **scripts/start-backends.bat** - Script to start mock services (Windows)
7. **scripts/test-gateway.sh** - Test script to verify everything works

---

## How It Works - Request Flow

```
1. Request arrives at gateway
   ↓
2. RouteMatcher finds matching route (/api/users → user-service)
   ↓
3. RoundRobinLoadBalancer selects backend instance (localhost:3001, 3002, or 3003)
   ↓
4. ProxyService forwards request to selected backend
   ↓
5. Backend processes and responds
   ↓
6. Gateway returns response to client
```

---

## Testing the Gateway

### Step 1: Start Backend Services

**Mac/Linux:**
```bash
cd api-gateway-nodejs

# Make script executable (if not already)
chmod +x scripts/start-backends.sh

# Start backends
./scripts/start-backends.sh
```

**Windows:**
```cmd
cd api-gateway-nodejs
scripts\start-backends.bat
```

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║  🔧 Mock User Service Started                            ║
║  Service: user-service-3001                              ║
║  Port:    3001                                           ║
╚═══════════════════════════════════════════════════════════╝
```

This starts 3 instances:
- http://localhost:3001
- http://localhost:3002
- http://localhost:3003

### Step 2: Start the Gateway

**In a NEW terminal:**
```bash
cd api-gateway-nodejs
npm run dev
```

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║        🚀 API Gateway Started Successfully 🚀             ║
║  Gateway API:     http://localhost:8080                  ║
╚═══════════════════════════════════════════════════════════╝
```

### Step 3: Test It!

**Manual Testing (in another terminal):**

```bash
# Test 1: Health check
curl http://localhost:8080/health

# Test 2: Get all users (will route to backend)
curl http://localhost:8080/api/users

# Test 3: Get specific user
curl http://localhost:8080/api/users/1

# Test 4: See load balancing in action
# Run this 6 times and watch the service name change
curl http://localhost:8080/api/users | jq -r '.service'
```

**Or use the test script (Mac/Linux):**
```bash
chmod +x scripts/test-gateway.sh
./scripts/test-gateway.sh
```

---

## What You Should See

### Request 1:
```json
{
  "service": "user-service-3001",
  "data": [
    { "id": 1, "name": "Alice Johnson", "email": "alice@example.com" },
    ...
  ]
}
```

### Request 2:
```json
{
  "service": "user-service-3002",
  "data": [...]
}
```

### Request 3:
```json
{
  "service": "user-service-3003",
  "data": [...]
}
```

**See how it rotates?** That's round-robin load balancing! 🎯

---

## Check Gateway Logs

In the gateway terminal, you'll see:
```
2026-01-24 14:30:00 [info]: Request received {"method":"GET","path":"/api/users"}
2026-01-24 14:30:00 [debug]: Route matched {"routeId":"user-service","backend":"user-service"}
2026-01-24 14:30:00 [debug]: Backend instance selected {"backend":"User Service","instance":"http://localhost:3001"}
2026-01-24 14:30:00 [info]: Proxying request {"method":"GET","targetUrl":"http://localhost:3001/users"}
2026-01-24 14:30:00 [info]: Backend response received {"statusCode":200,"duration":"0.023s"}
2026-01-24 14:30:00 [info]: Request completed {"statusCode":200,"backend":"http://localhost:3001","duration":"25ms"}
```

**You can see the entire flow!**

---

## View Gateway Statistics

```bash
curl http://localhost:8080/_admin/stats | jq .
```

Response:
```json
{
  "routes": [
    {
      "id": "user-service",
      "path": "/api/users",
      "backend": "user-service"
    }
  ],
  "backends": [
    {
      "backend": "User Service",
      "totalInstances": 3,
      "healthyInstances": 3,
      "instances": [
        {
          "url": "http://localhost:3001",
          "healthy": true,
          "activeConnections": 0,
          "totalRequests": 5
        },
        {
          "url": "http://localhost:3002",
          "healthy": true,
          "activeConnections": 0,
          "totalRequests": 5
        },
        {
          "url": "http://localhost:3003",
          "healthy": true,
          "activeConnections": 0,
          "totalRequests": 4
        }
      ]
    }
  ]
}
```

**See the request counts?** That proves load balancing is working!

---

## Test Different HTTP Methods

```bash
# GET
curl http://localhost:8080/api/users

# POST (create user)
curl -X POST http://localhost:8080/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Dave Wilson","email":"dave@example.com"}'

# PUT (update user)
curl -X PUT http://localhost:8080/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Smith"}'

# DELETE
curl -X DELETE http://localhost:8080/api/users/1
```

All should work!

---

## Custom Headers

The gateway adds custom headers to responses:

```bash
curl -i http://localhost:8080/api/users
```

Look for:
```
X-Gateway-Backend: http://localhost:3001
X-Gateway-Route: user-service
X-Response-Time: 25ms
```

---

## Test Error Handling

### 1. Non-existent route:
```bash
curl http://localhost:8080/api/unknown
```
Response: `404 Not Found`

### 2. Stop a backend (simulate failure):
Kill one of the backend services and make requests. Gateway will route to healthy instances only!

---

## Understanding the Code

### RouteMatcher (src/router/routeMatcher.js)

**Key method:**
```javascript
findRoute(path, method) {
  // Loops through routes
  // Checks if path matches pattern
  // Checks if method is allowed
  // Returns matched route or null
}
```

**Path matching:**
- `/api/users` exactly matches `/api/users`
- `/api/users` also matches `/api/users/123`
- `/api/users/*` matches anything starting with `/api/users/`

### RoundRobinLoadBalancer (src/loadbalancer/roundRobin.js)

**Key method:**
```javascript
selectInstance(backend) {
  // Filter healthy instances
  // Get current index
  // Select instance at index
  // Increment index (wrap around)
  // Return selected instance
}
```

**How round-robin works:**
```
Index 0 → Instance 1 (3001)
Index 1 → Instance 2 (3002)
Index 2 → Instance 3 (3003)
Index 3 → Wraps to 0 → Instance 1 (3001)
...
```

### ProxyService (src/proxy/proxyService.js)

**Key method:**
```javascript
async proxyRequest(instance, path, method, headers, body, timeout) {
  // Make HTTP request to backend
  // Handle response
  // Handle errors (503, 504, 502)
  // Record metrics
}
```

---

## Week 1 Complete! ✅

### What Works:
- ✅ Route matching
- ✅ Backend proxying
- ✅ Round-robin load balancing
- ✅ Error handling
- ✅ Logging
- ✅ Metrics tracking
- ✅ Admin stats endpoint

### What's Next (Week 2):
- Rate limiting (token bucket, sliding window)
- Circuit breaker
- More load balancing algorithms (least connections, weighted)
- Health monitoring

---

## Troubleshooting

**Problem:** Gateway starts but requests fail
- **Solution:** Make sure backend services are running on ports 3001, 3002, 3003

**Problem:** "Cannot find module 'axios'"
- **Solution:** Run `npm install`

**Problem:** Port 8080 already in use
- **Solution:** Change PORT in .env file or kill process on 8080

**Problem:** Backends not responding
- **Solution:** Check if backend services are actually running: `curl http://localhost:3001/health`

---

## Celebrate! 🎉

You now have a **working API Gateway**!

It can:
- Route requests to backends ✓
- Load balance across multiple instances ✓
- Handle errors gracefully ✓
- Track metrics ✓

**This is a real, functioning system!**

Next week we'll add rate limiting and circuit breaking to make it production-ready.
