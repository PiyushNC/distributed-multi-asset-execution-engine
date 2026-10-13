# Distributed Multi-Asset Execution Engine

Monorepo skeleton for a trading platform backend and frontend.

## Prerequisites

- Node.js 20+
- MongoDB running as a replica set
- Redis running locally or reachable through the configured URL

## Setup

```bash
npm install
Copy-Item backend/.env.example backend/.env
npm run build
```

## Step 8: Real-Time Trading Dashboard

The Vite/React frontend now provides a dark trading terminal at the root route. It is organized as:

- `frontend/src/context/SocketContext.tsx` — singleton Socket.io connection, JWT auth, and connection state
- `frontend/src/components/OrderBook.tsx` — live bid/ask depth with volume bars
- `frontend/src/components/MarketTrades.tsx` — scrolling execution tape
- `frontend/src/components/OrderForm.tsx` — authenticated limit order submission and live balance updates
- `frontend/src/components/AccountSection.tsx` — account popover with identity, expiry, balances, and logout
- `frontend/src/components/UserOrders.tsx` — REST-hydrated and Socket.io-updated personal orders
- `frontend/src/dashboard.tsx` — responsive dashboard layout and chart surface
- `frontend/src/styles.css` — responsive dark terminal design system

This repository uses Vite rather than Next.js, so the equivalent public environment variables use the `VITE_` prefix. Copy `frontend/.env.example` to `frontend/.env` if you need to change the default API or WebSocket URL.

### Run the full UI flow

From the repository root, start Docker services and both workspaces:

```powershell
docker compose up -d
npm run dev
```

Open the Vite URL shown in the terminal. Use `Sign in` to register or log in directly inside the dashboard. The dashboard joins `market:BTC-USD`; queued orders, order-book changes, executions, order updates, and balance updates stream through Socket.io.

### Simulated market traffic

The market-maker script at `scripts/simulateMarket.ts` registers and funds simulated users, creates resting bids and asks every 50-200ms, creates aggressive crossing orders every 1-3 seconds, and cancels stale orders after 25 seconds. It uses the real REST order endpoint, so traffic passes through BullMQ, matching, settlement, and Socket.io.

Run it from the repository root while Docker and the backend are running:

```powershell
npm install
npm run simulate:market
```

The requested command is:

```powershell
npx ts-node scripts/simulateMarket.ts
```

However, this repository uses native ES modules with Node.js 22, and the installed `ts-node` 10 runner fails with `ERR_UNKNOWN_FILE_EXTENSION`. The verified working command is `npm run simulate:market`, which uses `tsx`.

Optional configuration:

```powershell
$env:SIM_API_URL="http://localhost:4000"
$env:MONGODB_URI="mongodb://localhost:27017/execution_engine?replicaSet=rs0"
npm run simulate:market
```

Open the frontend in another terminal and watch `BTC-USD` depth and executions update live. Stop the simulator with `Ctrl+C`.

### Admin engine visualizer

Set an email as an admin before registering that account:

```env
ADMIN_EMAILS=admin@example.com
Email: admin@arc.io

Password: Admin123!
```

Restart the backend, register or log in as `admin@example.com`, and open the `Admin visualizer` button in the navbar. Only JWTs with `role: "ADMIN"` can join `admin:telemetry`; regular users can still receive public market events but never receive queue, heap, or transaction telemetry.

The visualizer includes a forced rollback test button, which emits a `ROLLED_BACK` telemetry record to the admin room without changing trading balances.

Update `backend/.env` with the local MongoDB replica set, Redis host/port, and JWT secrets, then start both applications:

```bash
npm run dev
```

The backend health endpoint is available at `http://localhost:4000/health`.

## Step 2: Database Schema & Authentication Architecture

The backend now includes the core schema and authentication layer:

- Models: `User`, `Account`, `Order`, and `Trade` are defined under `backend/src/models/`
- Auth routes: `POST /auth/register`, `POST /auth/login`, and `POST /auth/refresh` live under `backend/src/routes/`
- Protected user route: `GET /api/me` is guarded by `requireAuth` in `backend/src/middleware/`
- Controllers: request handling lives in `backend/src/controllers/`
- Security tokens: JWT signing/verification is managed in `backend/src/services/`

### Route behavior

- Access token: short-lived JWT in the JSON response body, approx. 15 minutes
- Refresh token: 7-day HTTP-only cookie, stored in Redis for immediate invalidation
- Protected routes require the Authorization header: `Bearer <accessToken>`

### Example flow

1. Register or log in using `/auth/register` or `/auth/login`
2. Receive `accessToken` in the JSON body
3. Receive `refreshToken` cookie set by the server
4. Call `GET /api/me` with `Authorization: Bearer <accessToken>`
5. Refresh expired access tokens using `POST /auth/refresh`

### Monorepo layout

- `backend/src/models/` — Mongoose schemas and exported TypeScript interfaces
- `backend/src/controllers/` — auth and user request handlers
- `backend/src/middleware/` — auth enforcement middleware
- `backend/src/routes/` — route registration
- `backend/src/services/` — JWT and Redis token logic
- `backend/src/types/` — Express request augmentation for `req.user`

## Step 5: Atomic Settlement & Order Placement

The order flow is now available under `/api/orders`:

- `backend/src/matching/MatchingEngine.ts` — in-memory price-time matching and heap removal
- `backend/src/services/settlementService.ts` — MongoDB session transaction for balance transfers, order fills, and trades
- `backend/src/controllers/orderController.ts` — authenticated order validation and placement/list/cancel handlers
- `backend/src/routes/orderRoutes.ts` — protected `/api/orders` route definitions

### Order endpoints

- `POST /api/orders` — validates balances, creates a limit order, matches it, and settles any trades
- `GET /api/orders` — lists the authenticated user's orders
- `DELETE /api/orders/:id` — removes an active order from the in-memory book and marks it `CANCELLED`

Settlement splits a pair such as `BTC-USD` into base asset `BTC` and quote currency `USD`. Every matched trade transfers the quote amount from buyer to seller and the base quantity from seller to buyer inside one MongoDB transaction. If any account, order, or trade write fails, the transaction is aborted.

### Manual Postman or Bruno test

1. Register two users with `POST http://localhost:4000/auth/register`. Registration creates test balances of `1 BTC`, `10 ETH`, and `100000 USD`.
2. Log in each user with `POST http://localhost:4000/auth/login` and copy each access token.
3. Create a sell order for the seller:

```json
{
	"pair": "BTC-USD",
	"side": "SELL",
	"price": 100,
	"quantity": 0.25
}
```

	 Send it to `POST http://localhost:4000/api/orders` with `Authorization: Bearer <seller-access-token>`.
4. Create a crossing buy order for the buyer:

```json
{
	"pair": "BTC-USD",
	"side": "BUY",
	"price": 105,
	"quantity": 0.25
}
```

	 Send it with the buyer token. It executes at the resting sell price of `100` and returns the trade in `trades`.
5. Use `GET http://localhost:4000/api/orders` with either token to inspect that user's orders.
6. Create a non-crossing order, copy its returned order id, then call `DELETE http://localhost:4000/api/orders/<id>` with the same user's token.

Use `Content-Type: application/json` for POST requests. Keep the backend running with `npm run dev -w backend` and MongoDB/Redis running through Docker Compose.

## Step 3: BullMQ Order Processing

The asynchronous order path is organized as follows:

- `backend/src/config/redis.ts` — shared ioredis client and Redis connection options from `REDIS_HOST` and `REDIS_PORT`
- `backend/src/queues/orderQueue.ts` — BullMQ `order-queue` definition and retry defaults
- `backend/src/workers/orderWorker.ts` — worker that loads `PENDING` orders, matches, settles, and persists results
- `backend/src/server.ts` — starts the worker after MongoDB and Redis connect, then stops it during shutdown

`POST /api/orders` now returns `202 Accepted` immediately with a `PENDING` order. The worker later changes it to `OPEN`, `PARTIALLY_FILLED`, or `FILLED`.

### Verify queue processing

1. Start Docker services and the backend:

```powershell
docker compose up -d
npm run dev -w backend
```

2. Submit an authenticated order through Postman or Bruno.
3. Confirm the immediate response is `202` and the order status is `PENDING`.
4. Watch the backend terminal for `Processed order ...` and `Order job ... completed.`
5. Call `GET /api/orders` again to see the worker-updated status.

You can inspect Redis directly with:

```powershell
docker exec local_redis redis-cli KEYS "bull:order-queue:*"
docker exec local_redis redis-cli LLEN "bull:order-queue:wait"
```

Completed jobs are removed after the configured retention threshold, while failed jobs are retained for inspection. Database errors are retried with exponential backoff up to five attempts.

## Step 6: Real-Time Socket.io Streaming

Socket.io is attached to the HTTP server in `backend/src/server.ts` through `backend/src/config/socket.ts`.

- `market:join` joins a public room such as `market:BTC-USD`
- `market:leave` leaves a public market room
- authenticated sockets automatically join `user:<userId>`
- access tokens are supplied through the Socket.io `auth.token` field or an Authorization header

The server emits:

- `orderbook:update` to `market:<pair>` after orders are added, filled, or cancelled
- `trade:executed` to `market:<pair>` after settlement commits
- `order:updated` to the affected user room
- `balance:updated` to the affected user room

### Socket.io client test

Run this in a browser page or Node.js script after installing `socket.io-client`:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
	auth: { token: '<ACCESS_TOKEN>' },
});

socket.on('connect', () => {
	console.log('connected', socket.id);
	socket.emit('market:join', 'BTC-USD');
});

socket.on('orderbook:update', (update) => console.log('order book', update));
socket.on('trade:executed', (trade) => console.log('trade', trade));
socket.on('order:updated', (order) => console.log('private order', order));
socket.on('balance:updated', (balance) => console.log('private balance', balance));
socket.on('connect_error', (error) => console.error('socket error', error.message));
```

Submit an order through `POST /api/orders` after connecting. The HTTP response is still `202 PENDING`; the worker then produces the Socket.io updates.

## Step 7: End-to-End Integration Testing

The live execution-flow test is located at `backend/tests/integration/executionFlow.test.ts`. It uses Supertest against the real Express app, the real MongoDB replica set, the real Redis-backed BullMQ queue, the worker, the matching engine, and the settlement transaction.

The test uses these isolated resources:

- MongoDB database: `execution_engine_test`
- BullMQ queue: `order-queue-test`
- Redis: the local Docker Redis instance on `127.0.0.1:6379`

Start the infrastructure first:

```powershell
docker compose up -d
```

Then run the complete end-to-end verification from the repository root:

```powershell
npm run test:integration
```

The test registers Trader A and Trader B, seeds Trader A with `$100,000` USD and Trader B with `2 BTC`, submits the `$50,000` sell and buy orders, verifies the `PENDING` response and Redis job payload, waits for the sell order to rest in the ask book, and asserts final account balances, filled orders, and the created trade. The `$100,000` seed is necessary because the requested `$50,000` order cannot be funded from only `$10,000`.

The root scripts are:

- `npm run dev` — starts backend/worker and frontend concurrently
- `npm run test:integration` — runs the isolated live execution-flow test
- `npm run build` — builds both workspaces
- `npm run lint` — lints both workspaces

For a full local check:

```powershell
docker compose up -d
npm run lint
npm test -w backend
npm run test:integration
npm run build
```
