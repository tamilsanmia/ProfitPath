# Backend (Python + Docker SDK)

This backend is built with FastAPI and uses:

- Docker SDK for Python
- PostgreSQL as primary database
- Redis as cache layer

## Endpoints

- `GET /health` - backend health
- `GET /db/health` - PostgreSQL + Redis health
- `GET /users` - list users (Redis cached)
- `POST /users` - create user in PostgreSQL
- `GET /docker/health` - Docker daemon connectivity check
- `GET /docker/info` - Docker daemon info
- `GET /docker/containers?all=false` - list containers

## Run With Docker

```bash
cd /root/ProfitPath/backend
docker compose up --build
```

Backend URL: `http://localhost:8000`

PostgreSQL URL: `postgresql://postgres:postgres@localhost:5432/profitpath`

Redis URL: `redis://localhost:6379/0`

## Notes

- The backend mounts `/var/run/docker.sock` to access Docker from inside the container.
- Treat Docker socket access as privileged.
