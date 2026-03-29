# Backend (FastAPI + PostgreSQL + Redis)

This backend powers authentication, user/profile data, settings, and Freqtrade bot integrations.

## Tech Stack

- FastAPI + Uvicorn
- PostgreSQL (primary data store)
- Redis (cache)
- Docker SDK (container health/info endpoints)
- Freqtrade API proxy for bot operations

## Prerequisites

- Python 3.12+
- Docker + Docker Compose
- PostgreSQL and Redis (if running without Docker Compose)

## Local Run (without Docker Compose)

```bash
cd /root/BotPrimeX/backend
python -m venv .venv
source .venv/bin/activate
pip install --no-cache-dir -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Run With Docker Compose

```bash
cd /root/BotPrimeX/backend
docker compose up --build -d
```

Services:

- Backend: `http://localhost:8000`
- Postgres: `postgresql://postgres:postgres@localhost:5432/botprimex`
- Redis: `redis://localhost:6379/0`
- Mailpit UI: `http://localhost:8025`

## Environment Variables

Settings use `BACKEND_` prefix (loaded from `.env` by default).

Core variables:

- `BACKEND_POSTGRES_URL`
- `BACKEND_REDIS_URL`
- `BACKEND_FRONTEND_URL`
- `BACKEND_PUBLIC_BASE_URL`

Freqtrade variables:

- `BACKEND_FREQTRADE_URLS`
- `BACKEND_FREQTRADE_USERNAMES`
- `BACKEND_FREQTRADE_PASSWORDS`
- `BACKEND_FREQTRADE_BOT_IDS`
- `BACKEND_FREQTRADE_BOT_NAMES`

## Database Backup & Restore

Backups run automatically every day at **2:00 AM UTC** and are stored in `backups/`.
Each backup is a gzipped SQL dump kept for **30 days**.

### Manual backup

```bash
bash /root/BotPrimeX/backend/backup.sh
```

### Restore a backup

```bash
gunzip -c backups/botprimex_YYYY-MM-DD_HH-MM-SS.sql.gz | docker exec -i botprimex-postgres psql -U postgres botprimex
```

### View backup logs

```bash
cat backups/backup.log
```

---

## Key Endpoints

Health:

- `GET /health`
- `GET /db/health`

Users/Auth (sample):

- `POST /users`
- `POST /auth/signin`
- `POST /auth/google`

Bots:

- `GET /api/bots`
- `GET /api/bots/{bot_id}/stats`
- `GET /api/bots/{bot_id}/status`
- `GET /api/bots/{bot_id}/trades`
- `GET /api/bots/{bot_id}/performance`
- `GET /api/bots/{bot_id}/daily`

Bot control/actions:

- `POST /api/bots/{bot_id}/start`
- `POST /api/bots/{bot_id}/pause`
- `POST /api/bots/{bot_id}/forceexit`
- `POST /api/bots/{bot_id}/forceexit_all`
- `POST /api/bots/{bot_id}/delete_trade`

Share links (DB-backed token URLs):

- `GET /api/bots/{bot_id}/share`
- `POST /api/bots/{bot_id}/share` with `{ "enabled": true|false }`
- `GET /api/bots/shared/{share_token}/stats`
- `GET /api/bots/shared/{share_token}/status`
- `GET /api/bots/shared/{share_token}/trades`
- `GET /api/bots/shared/{share_token}/performance`
- `GET /api/bots/shared/{share_token}/daily`
- `GET /api/bots/shared/{share_token}/trade`

## Notes

- DB schema is initialized on startup via `init_db()`.
- The backend mounts `/var/run/docker.sock` for Docker health/info operations.
- Treat Docker socket access as privileged.
