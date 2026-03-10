# High-Performance API Gateway (Node.js)

A production-grade API Gateway built with Node.js and Express, featuring distributed request tracing, SLO/error-budget tracking, adaptive rate limiting, chaos engineering, live request flow visualization, and a full admin dashboard UI.

---
<img width="1469" height="798" alt="Screenshot 2026-03-10 at 1 42 44 PM" src="https://github.com/user-attachments/assets/b1b3c64a-e4d9-4b71-9557-3270cd878e55" />


## Features

### Core Gateway
- **Request Routing** — YAML-configured path matching with method filtering and path rewriting
- **Load Balancing** — Round-robin, least-connections, and smooth weighted round-robin
- **Rate Limiting** — Token bucket and sliding window algorithms backed by Redis
- **Circuit Breaking** — CLOSED / OPEN / HALF-OPEN state machine preventing cascade failures
- **Health Monitoring** — Active background health checks; unhealthy instances removed automatically
- **Reverse Proxy** — Transparent HTTP forwarding with timeout and header sanitisation

### Observability (NEW)
- **Distributed Request Tracing** — Every request gets a `X-Trace-ID`; spans recorded for `route_match → adaptive_rl → rate_limit → load_balance → proxy`; waterfall flame graph in the UI
- **SLO / Error Budget Tracking** — Google SRE error budget model; burn-rate alerts at 14.4× and 6× thresholds; multi-window availability table (30m / 1h / 6h / 24h / 7d / 30d)
- **Prometheus Metrics** — Request duration histograms, counters, circuit-breaker gauges, active-connection gauges
- **Structured Logging** — Winston JSON logs to console and rotating files

### Adaptive Rate Limiting (NEW)
- **PID-like Feedback Controller** — EWMA-smoothed P99 latency drives a proportional multiplier
- **Probabilistic Traffic Shedding** — At multiplier M, (1−M)% of requests are shed before reaching the backend — same principle as Google LARD / Uber Ringpop
- **Automatic Recovery** — Multiplier restores +4% per tick once EWMA P99 drops below 75% of target

### Admin Dashboard UI (NEW)
Served at `http://localhost:8080/` — 10 tabs:

| Tab | What it shows |
|---|---|
| **Overview** | Live req/s chart, status-code doughnut, traffic-by-route bar, latency histogram, anomaly detection |
| **Metrics** | Historical time-series, latency buckets, active connections, rate-limit hits |
| **SLO** | Error budget gauge, burn rate, exhaustion countdown, multi-window availability table |
| **Traces** | Recent trace list + clickable waterfall span diagram |
| **Adaptive RL** | Per-backend multiplier, EWMA P99 sparklines, controller change log |
| **Live Flow** | Animated canvas — packets fly through the gateway architecture in real-time |
| **Chaos Lab** | Kill / heal individual backend instances, flood-test routes, watch circuit breakers react |
| **Backends** | Per-instance UP/DOWN health, load-balancing algorithm |
| **Routes** | Full route config table |
| **Try It** | Send live requests to each route from the browser |

---

## Quick Start

### Prerequisites
- Node.js 18+
- Redis 6+ (for rate limiting)

### 1. Install dependencies

```bash
npm install
```

### 2. Start Redis

```bash
docker run -d -p 6379:6379 redis:7-alpine
# or: brew install redis && redis-server
```

### 3. Start mock backend services

```bash
./scripts/start-backends.sh
```

This starts 7 mock services:
- `user-service` on ports 3001–3003 (3 instances, round-robin)
- `order-service` on ports 4001–4002 (2 instances, weighted)
- `auth-service`  on ports 5001–5002 (2 instances, least-connections)

### 4. Start the gateway

```bash
npm run dev       
npm start         
```

### 5. Open the dashboard

```
http://localhost:8080
```

---

## Docker Compose (full stack)

Starts gateway + Redis + all 7 mock services + Prometheus + Grafana:

```bash
cd docker && docker-compose up
```

| Service | URL |
|---|---|
| Gateway + Dashboard | http://localhost:8080 |
| Prometheus metrics  | http://localhost:9090/metrics |
| Prometheus UI       | http://localhost:9091 |
| Grafana             | http://localhost:3000 (admin/admin) |

---

## Project Structure

```
api-gateway-nodejs/
├── src/
│   ├── server.js                     
│   ├── config/
│   │   └── configLoader.js
│   ├── routes/
│   │   └── gateway.js                
│   ├── middleware/
│   │   ├── metrics.js                
│   │   ├── rateLimiter.js           
│   │   ├── tokenBucket.js             
│   │   ├── slidingWindow.js       
│   │   ├── circuitBreaker.js        
│   │   └── adaptiveRateLimiter.js   
│   ├── tracing/
│   │   └── tracer.js                
│   ├── slo/
│   │   └── sloTracker.js            
│   ├── loadbalancer/
│   │   ├── loadBalancerFactory.js
│   │   ├── roundRobin.js
│   │   ├── leastConnections.js
│   │   └── weighted.js
│   ├── proxy/
│   │   └── proxyService.js          
│   ├── router/
│   │   └── routeMatcher.js            
│   ├── healthcheck/
│   │   └── healthMonitor.js         
│   └── utils/
│       ├── logger.js                  
│       └── redisClient.js         
├── public/
│   └── index.html                    
├── config/
│   ├── routes.yml                    
│   └── backends.yml                   
├── mock-services/
│   ├── user-service.js                
│   ├── order-service.js              
│   └── auth-service.js               
├── scripts/
│   ├── start-backends.sh          
│   └── test-gateway.sh            
├── benchmarks/
│   └── run-benchmark.sh              
├── docker/
│   ├── Dockerfile                   
│   ├── docker-compose.yml        
│   └── prometheus.yml               
├── docs/
│   ├── WEEK1.md
│   ├── WEEK2.md
│   └── FINAL.md
├── package.json
├── .env.example
└── .gitignore
```

---

## Admin API Reference

All admin endpoints are on the same port as the gateway (8080).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/_admin/stats` | Routes + backend instances + load-balancer stats |
| GET | `/_admin/circuit-breakers` | Circuit-breaker state per backend |
| GET | `/_admin/traces?limit=N` | Recent distributed traces + P50/P95/P99 stats |
| GET | `/_admin/traces/:traceId` | Single trace with full span waterfall |
| GET | `/_admin/slo` | SLO status, error budget, burn rate, multi-window table |
| GET | `/_admin/adaptive-limits` | Adaptive RL multipliers, EWMA P99, change log |
| GET | `/_admin/metrics/json` | Prometheus metrics as structured JSON |
| POST | `/_admin/chaos/instance` | Toggle a backend instance healthy/unhealthy |
| POST | `/_admin/chaos/flood` | Flood a route with N requests |

### Example responses

```bash
# Health check
curl http://localhost:8080/health

# Distributed traces
curl "http://localhost:8080/_admin/traces?limit=10"

# SLO status
curl http://localhost:8080/_admin/slo

# Kill an instance (chaos)
curl -X POST http://localhost:8080/_admin/chaos/instance \
  -H 'Content-Type: application/json' \
  -d '{"backendName":"user-service","url":"http://localhost:3001","healthy":false}'

# Flood test (triggers rate limiter)
curl -X POST http://localhost:8080/_admin/chaos/flood \
  -H 'Content-Type: application/json' \
  -d '{"path":"/api/users","count":50}'
```

---

## Configuration

### Environment variables (`.env`)

```bash
PORT=8080
METRICS_PORT=9090
REDIS_HOST=localhost
REDIS_PORT=6379
RATE_LIMIT_ALGORITHM=token-bucket   # token-bucket | sliding-window
LOG_LEVEL=info
NODE_ENV=development
```

### Routes (`config/routes.yml`)

```yaml
routes:
  - id: user-service
    path: /api/users
    pathRewrite: true           # strips /api/users prefix before forwarding
    backend: user-service
    methods: [GET, POST, PUT, DELETE]
    rateLimit: 200              # requests per minute
    circuitBreaker: true
    timeout: 30000
```

### Backends (`config/backends.yml`)

```yaml
backends:
  user-service:
    instances:
      - url: http://localhost:3001
        weight: 1
      - url: http://localhost:3002
        weight: 1
    healthCheck:
      enabled: true
      path: /health
      interval: 10000
    loadBalancing:
      algorithm: round-robin    # round-robin | least-connections | weighted
```

---

## How the Novel Features Work

### Distributed Tracing

Every request through the gateway creates a `TraceContext` with a unique `traceId` (hex, 8 bytes). As the request flows through each processing stage, a `Span` is opened and closed with its start offset and duration recorded relative to the trace start time. This is the same conceptual model as OpenTelemetry / Jaeger / Zipkin — without the external infrastructure overhead.

The `X-Trace-ID` header is attached to every response so callers can correlate logs to traces.

### SLO / Error Budget (Google SRE model)

The tracker records cumulative Prometheus counter snapshots every 10 seconds. For each time window it computes delta requests and delta errors. Availability = (total − errors) / total.

**Burn rate** = actual_error_rate / allowed_error_rate. An SLO of 99.9% allows a 0.1% error rate. If you're currently at 1.44%, your burn rate is 14.4× — meaning you'll exhaust your 30-day error budget in ~2 hours. This is the fast-burn alert threshold from the [Google SRE Workbook, Chapter 5](https://sre.google/workbook/alerting-on-slos/).

### Adaptive Rate Limiting

Uses an **EWMA** (Exponentially Weighted Moving Average) with α=0.25 to smooth per-backend P99 latency measurements. A proportional controller then computes:

```
error      = (ewma_p99 - TARGET_P99) / TARGET_P99
multiplier = max(MIN, multiplier - Kp × error)
```

When `multiplier < 1.0`, requests are shed probabilistically: a request is rejected with probability `(1 - multiplier)`. This is the same mechanism used by Google's LARD (Least-Loaded and Replication-Directed) load shedder. Recovery is gradual (+4% per tick) once latency normalises.

---

## Performance

```bash
# Install autocannon
npm install -g autocannon

# Benchmark
autocannon -c 100 -d 30 http://localhost:8080/api/users
```

Target: 25,000+ req/s, P99 < 15ms on local hardware with backends running.

---

## Author

**Harsha Raj Kumar** — MS CS, Vanderbilt University
- Email: harsha.raj.kumar@vanderbilt.edu
- GitHub: [@harsharajkumar](https://github.com/harsharajkumar)

---

## License

MIT
