# OpenWA — Minimal WhatsApp OTP Gateway

A self-hosted, single-container REST API for sending WhatsApp OTPs (and bulk text messages) to multiple phone numbers. Built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and NestJS.

> **Scope** — This is a stripped-down build focused on OTP delivery. It keeps only what you need: multi-session management, QR-code authentication, single-text send, and bulk-text send. No Redis, no S3, no dashboard, no sidecar services — just SQLite and a single Docker container.

---

## Features

| Capability | Detail |
|---|---|
| **Multi-session** | Run multiple WhatsApp numbers on one instance |
| **QR authentication** | Scan from a browser — `/qr/scan` auto-refreshes every 3 s |
| **Text send** | Single message to one recipient |
| **Bulk send** | Up to 100 recipients per batch, variable substitution, configurable delay |
| **Message history** | Queryable log of sent/received messages (SQLite) |
| **API key auth** | OPERATOR / ADMIN roles — set your key in `.env` or let it auto-generate |
| **Rate limiting** | Three-tier (per-second, per-minute, per-hour) |
| **Proxy support** | Per-session HTTP/SOCKS proxy |
| **Plugin hooks** | Intercept and modify events (`message:sending`, `session:ready`, …) |
| **Health checks** | `/api/health`, `/api/health/live`, `/api/health/ready` |
| **Swagger UI** | Interactive docs at `/api/docs` |

---

## Quick Start

### Docker (recommended)

```bash
# 1. Clone
git clone https://github.com/rmyndharis/OpenWA.git
cd OpenWA

# 2. Set your API key (optional — auto-generated if omitted)
echo "API_KEY=your-secret-key" > .env

# 3. Start
docker compose up -d
```

```
API:   http://localhost:2785/api
Docs:  http://localhost:2785/api/docs
```

If you skipped step 2, retrieve the auto-generated key from the logs:

```bash
docker compose logs openwa-api | grep "API Key" -A1
```

### Local development

```bash
cp .env.minimal .env        # edit API_KEY and any other vars
npm install
npm run start:dev
```

---

## API Key

The API key controls access to all protected endpoints. There are two ways to manage it.

### Set a fixed key in `.env`

Add `API_KEY` to your `.env` file (or Docker Compose environment):

```env
API_KEY=your-strong-secret-key
```

On every restart the server reads this value and ensures it is the active default admin key. Changing the value and restarting replaces the old key automatically — no database cleanup needed.

### Auto-generated key (no `API_KEY` set)

On first boot the server generates a random key, prints it in the startup banner, and saves it to `data/.api-key`. Subsequent restarts re-display the saved key. Use this mode for quick local testing; pin it via `API_KEY` for any persistent deployment.

### Creating additional keys via API

```bash
curl -s -X POST http://localhost:2785/api/auth/api-keys \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "backend-service", "role": "operator"}'
```

The raw key is returned once — save it immediately.

| Role | Permissions |
|---|---|
| `admin` | Full access including key management |
| `operator` | Create sessions, send messages |
| `viewer` | Read-only (list sessions, message history) |

---

## Configuration

Copy `.env.minimal` to `.env` and edit what you need. All values have sensible defaults.

```env
# Server
PORT=2785
NODE_ENV=production

# SQLite databases
DATABASE_TYPE=sqlite
DATABASE_NAME=./data/openwa.sqlite

# Chromium / Puppeteer
PUPPETEER_HEADLESS=true
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu

# API key — fixed key for all restarts.
# Remove this line to auto-generate a random key on first boot.
API_KEY=your-strong-secret-key
```

Data is persisted in the `openwa-data` Docker volume (or `./data/` locally).

---

## API Reference

Pass the key as `X-API-Key: <key>` header (or `Authorization: Bearer <key>`).

### Sessions

| Method | Route | Role | Description |
|---|---|---|---|
| `POST` | `/api/sessions` | operator | Create a session |
| `GET` | `/api/sessions` | any | List all sessions |
| `GET` | `/api/sessions/:id` | any | Get session details |
| `DELETE` | `/api/sessions/:id` | operator | Delete a session |
| `POST` | `/api/sessions/:id/start` | operator | Start WhatsApp connection |
| `POST` | `/api/sessions/:id/stop` | operator | Disconnect |
| `GET` | `/api/sessions/:id/qr` | any | QR code as JSON `{ qrCode: "data:image/png;base64,…" }` |
| `GET` | `/api/sessions/:id/qr/image` | any | QR code as raw PNG — open directly in a browser |
| `GET` | `/api/sessions/:id/qr/scan` | any | HTML page — shows QR, auto-refreshes until authenticated |
| `GET` | `/api/sessions/stats/overview` | any | Session counts + memory usage |

### Messages

| Method | Route | Role | Description |
|---|---|---|---|
| `POST` | `/api/sessions/:id/messages/send-text` | operator | Send one text message |
| `POST` | `/api/sessions/:id/messages/send-bulk` | operator | Send to multiple recipients (async) |
| `GET` | `/api/sessions/:id/messages` | any | Message history |
| `GET` | `/api/sessions/:id/messages/batch/:batchId` | any | Bulk send status |
| `POST` | `/api/sessions/:id/messages/batch/:batchId/cancel` | operator | Cancel running batch |

### Auth / API Keys

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/auth/api-keys` | Create a new key (returns raw key once) |
| `GET` | `/api/auth/api-keys` | List all keys |
| `PUT` | `/api/auth/api-keys/:id` | Update name, role, or IP restrictions |
| `DELETE` | `/api/auth/api-keys/:id` | Delete a key |
| `POST` | `/api/auth/api-keys/:id/revoke` | Revoke without deleting |

---

## Usage Examples

```bash
KEY="your-secret-key"   # whatever you set in API_KEY
BASE="http://localhost:2785/api"
```

### 1. Create and authenticate a session

```bash
# Create
curl -s -X POST $BASE/sessions \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "otp-sender"}'

# Start — Puppeteer launches Chromium in the background
SESSION_ID="<id from above response>"
curl -s -X POST $BASE/sessions/$SESSION_ID/start \
  -H "X-API-Key: $KEY"

# Open in browser — scan with WhatsApp → Linked Devices → Link a Device
# The page refreshes automatically; closes with a ✅ once authenticated.
open $BASE/sessions/$SESSION_ID/qr/scan
```

### 2. Send a single OTP

```bash
curl -s -X POST $BASE/sessions/$SESSION_ID/messages/send-text \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "966512345678@c.us",
    "text": "Your OTP is: 482910. Valid for 5 minutes."
  }'
```

```json
{ "messageId": "true_966512345678@c.us_3EB0123456789", "timestamp": 1706868000 }
```

### 3. Bulk send with variable substitution

```bash
curl -s -X POST $BASE/sessions/$SESSION_ID/messages/send-bulk \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "chatId": "966512345678@c.us", "text": "Hi {name}, your OTP is {otp}.", "variables": { "name": "Ahmed", "otp": "482910" } },
      { "chatId": "966598765432@c.us", "text": "Hi {name}, your OTP is {otp}.", "variables": { "name": "Sara",  "otp": "731204" } }
    ],
    "options": { "delayBetweenMessages": 3000, "randomizeDelay": true }
  }'
```

Returns **202 Accepted** immediately — processing is async:

```json
{
  "batchId": "batch_c1b723c0",
  "status": "pending",
  "totalMessages": 2,
  "estimatedCompletionTime": "2026-05-25T13:15:18Z",
  "statusUrl": "/api/sessions/.../messages/batch/batch_c1b723c0"
}
```

### 4. Poll batch status

```bash
curl -s $BASE/sessions/$SESSION_ID/messages/batch/batch_c1b723c0 \
  -H "X-API-Key: $KEY"
```

```json
{
  "batchId": "batch_c1b723c0",
  "status": "completed",
  "progress": { "total": 2, "sent": 2, "failed": 0, "pending": 0, "cancelled": 0 },
  "results": [
    { "chatId": "966512345678@c.us", "status": "sent", "messageId": "…", "sentAt": "…" },
    { "chatId": "966598765432@c.us", "status": "sent", "messageId": "…", "sentAt": "…" }
  ]
}
```

---

## Bulk Send Options

| Option | Type | Default | Description |
|---|---|---|---|
| `delayBetweenMessages` | ms | `3000` | Base delay between sends (min 1000, max 60000) |
| `randomizeDelay` | bool | `true` | Add 0–2 s of random jitter on top of the base delay |
| `stopOnError` | bool | `false` | Abort the entire batch on the first failure |
| `batchId` | string | auto | Custom batch ID for idempotency checks |

Maximum 100 recipients per batch. Use `{variable}` placeholders in `text` and pass matching `variables` per recipient.

---

## Session Lifecycle

```
CREATE  →  start  →  INITIALIZING
                          ↓  (Puppeteer + Chromium ready)
                       QR_READY  ──→  open /qr/scan in browser and scan
                          ↓
                     AUTHENTICATING
                          ↓
                        READY        ←── auto-reconnect on drop
                          ↓
                      stop / delete
                          ↓
                      DISCONNECTED
```

On unexpected disconnect the service retries with exponential back-off (5 attempts, base 5 s by default). Override per session via `config`:

```bash
curl -s -X POST $BASE/sessions \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "otp-sender", "config": {"maxReconnectAttempts": 10, "reconnectBaseDelay": 3000}}'
```

---

## Docker

```bash
# First run (builds image, starts container)
docker compose up -d --build

# View startup logs including API key
docker compose logs -f openwa-api

# Restart with a new API_KEY
echo "API_KEY=new-key" > .env
docker compose up -d --force-recreate

# Stop
docker compose down
```

The container runs as a non-root `openwa` user. All persistent state (SQLite files, session browser profiles) lives in the `openwa-data` volume mounted at `/app/data`.

---

## Project Structure

```
openwa/
├── src/
│   ├── main.ts                        # Bootstrap, Swagger, CORS, validation
│   ├── app.module.ts                  # Root module (TypeORM ×2, throttler)
│   ├── config/configuration.ts        # Typed config from environment variables
│   ├── common/                        # Filters, interceptors, logger, security
│   ├── core/
│   │   ├── hooks/                     # HookManager — event lifecycle hooks
│   │   └── plugins/                   # Plugin loader & storage service
│   ├── database/
│   │   ├── data-source.ts             # TypeORM CLI data source (for migrations)
│   │   └── migrations/                # SQLite & Postgres migration files
│   ├── engine/
│   │   ├── interfaces/                # IWhatsAppEngine, EngineStatus
│   │   ├── adapters/                  # whatsapp-web-js.adapter.ts
│   │   └── types/                     # whatsapp-web.js type shims
│   ├── plugins/engines/whatsapp-web-js/  # Built-in engine plugin
│   └── modules/
│       ├── auth/                      # API key management (ADMIN / OPERATOR / VIEWER)
│       ├── session/                   # Session CRUD, QR flow, auto-reconnect
│       ├── message/                   # send-text, send-bulk, batch tracking
│       └── health/                    # /health, /health/live, /health/ready
├── data/                              # Runtime data — gitignored
│   ├── main.sqlite                    # Auth database (API keys)
│   ├── openwa.sqlite                  # Sessions, messages, batches
│   └── sessions/                      # whatsapp-web.js LocalAuth state per session
├── .env.minimal                       # Configuration reference — copy to .env
├── docker-compose.yml                 # Single-container deployment
└── Dockerfile                         # Multi-stage build (builder + production)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Framework | NestJS 11.x |
| Language | TypeScript 5.x |
| WhatsApp engine | whatsapp-web.js (Puppeteer / LocalAuth) |
| Database | SQLite via TypeORM (Postgres also supported for the data DB) |
| Container | Docker — single image, no sidecars |

---

## License

MIT — free for personal and commercial use.
