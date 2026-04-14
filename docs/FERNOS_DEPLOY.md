# Fern OS Deployment

This project can now be deployed as a single Docker service for demo use.

What runs inside the container:
- the API gateway on `PORT` (default `8080`)
- all 7 mock backend instances on ports `3001-3003`, `4001-4002`, and `5001-5002`
- the dashboard UI from `public/`

Redis is optional for deployment:
- if Fern OS gives you a Redis service, set `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`
- if not, leave `REDIS_OPTIONAL=true` and the gateway will fall back to in-memory rate-limit state

## Recommended Fern OS settings

- Build context: repository root
- Dockerfile path: `docker/Dockerfile`
- Public port: `8080`
- Health check path: `/health`
- Start command override: none

## Environment variables

Minimum:

```bash
PORT=8080
LOG_LEVEL=info
REDIS_OPTIONAL=true
```

Optional if Fern OS supports managed Redis:

```bash
REDIS_HOST=<your-redis-host>
REDIS_PORT=6379
REDIS_PASSWORD=<your-redis-password>
REDIS_DB=0
REDIS_OPTIONAL=false
```

Optional if you do not want file logs inside the container:

```bash
LOG_TO_FILES=false
```

## Deploy flow

1. Create a new Docker-based app in Fern OS.
2. Point it at this repository.
3. Set the Dockerfile path to `docker/Dockerfile`.
4. Expose port `8080`.
5. Add the environment variables above.
6. Deploy and wait for `/health` to report `status: "UP"`.

## Smoke checks

After deployment, verify:

```bash
curl https://<your-domain>/health
curl https://<your-domain>/api/users
curl https://<your-domain>/_admin/stats
```

Expected behavior:
- `/health` returns gateway uptime plus backend health
- `/api/users` returns mock user data through the gateway
- `/_admin/stats` returns load balancer and backend state

## Notes

- The external app only needs one public port: `8080`.
- The metrics server still listens on `9090` inside the container for internal use.
- With `REDIS_OPTIONAL=true`, rate-limiter state is local to that container instance.
