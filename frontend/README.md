# Frontend (Next.js 15 + TypeScript)

This is the web app for BotPrimeX, built with Next.js App Router, React 19, Tailwind, and shadcn/ui components.

## Prerequisites

- Node.js 22+
- pnpm (Corepack enabled)
- Backend running at `http://localhost:8000` (or another URL via `BACKEND_URL`)

## Local Development

```bash
cd /root/BotPrimeX/frontend
corepack enable
pnpm install --frozen-lockfile
BACKEND_URL=http://localhost:8000 pnpm dev -H 0.0.0.0 -p 3000
```

App URL: `http://localhost:3000`

## Build and Run (Production)

```bash
cd /root/BotPrimeX/frontend
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

## Docker

Development stack (Next.js dev server + nginx + certbot services):

```bash
cd /root/BotPrimeX/frontend
docker compose -f docker-compose.dev.yml up --build -d
```

Production frontend container only:

```bash
cd /root/BotPrimeX/frontend
docker compose -f docker-compose.prod.yml up --build -d
```

## Environment Variables

- `BACKEND_URL`: Backend base URL used by server-side API proxy routes.
  - Default: `http://localhost:8000`
- `NEXT_PUBLIC_APP_URL`: Public app URL used by middleware for canonical redirects.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google sign-in client ID for auth UI.
- `ADMIN_USERNAME`: Username (or email local-part) treated as admin for admin menu and site management settings.

## Important Routes

- Dashboard bots page: `/my-bots`
- Public shared bot page (no login): `/shared/bot-accounts/{shareToken}`
- Frontend proxy to backend bot APIs:
  - Authenticated scope: `/api/bots/*`
  - Public shared scope: `/api/shared/bot-accounts/{shareToken}/*`

## Lint

```bash
cd /root/BotPrimeX/frontend
pnpm lint
```
