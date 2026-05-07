# Swish Insamling

A free Swedish web service for creating fundraising pages where contributors pay via the Swish app using deep links. No accounts needed — create a page in seconds, share the link, and let contributors pay directly through their Swish app.

## Project Structure

- **`web/`** — React + Vite + React Router v7 full-stack web application
  - `src/app/` — Pages and API routes (file-based routing)
  - `src/app/api/` — Server-side API route handlers (Hono)
  - `__create/` — Framework infrastructure (Hono server, route builder, auth adapter)
  - `plugins/` — Custom Vite plugins
- **`/home/runner/shared/`** — Shared stub modules (design-mode)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS |
| Backend | Hono server via react-router-hono-server |
| Routing | React Router v7 (file-based, SSR enabled) |
| Database | PostgreSQL (Replit built-in) via `@neondatabase/serverless` |
| Data fetching | @tanstack/react-query |
| Password hashing | argon2 |
| Icons | lucide-react |

## Pages

| Page | URL | Description |
|---|---|---|
| Home | `/` | Create new fundraising collection + recovery |
| Public collection | `/c/[id]` | Contributor view |
| Admin panel | `/c/[id]/admin?token=...` | Admin view with full control |

## API Routes

| Method | Route | Description |
|---|---|---|
| POST | `/api/collections` | Create new collection |
| GET | `/api/collections/:id` | Get collection (+ contributions if admin token provided) |
| PATCH | `/api/collections/:id` | Update status or extend expiry |
| POST | `/api/collections/recover` | Recover admin link via Swish number + PIN |
| POST | `/api/contributions` | Register new contribution |
| PATCH | `/api/contributions/:id` | Update contribution status |
| DELETE | `/api/contributions/:id` | Delete contribution |

## Database Schema

Two tables: `collections` and `contributions`. See README.md for full schema SQL.

## Development

```bash
cd web && npm run dev
```

App runs on port 5000.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)
- `ANYTHING_PROJECT_TOKEN` — Project token for the create.xyz platform

## User Preferences

- Swedish language app — maintain Swedish UI text
- No user accounts — minimal data collection per GDPR principles
