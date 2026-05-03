# VIBE Banking Sample

Small sample showing transactional transfers with MongoDB multi-document transactions, idempotency, audit logs, JWT refresh rotation, outbox publishing, and an optimistic frontend.

## Run Locally

Install dependencies from the project root:

```bash
npm install
```

Start MongoDB, backend, frontend, and the outbox worker with Docker Compose:

```bash
docker compose up --build
```

If you run MongoDB manually, use a replica set because transactions require it:

```bash
export MONGO_URI="mongodb://localhost:27017/vibe?replicaSet=rs0"
npm start
```

Run the frontend separately during development:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies requests to `http://localhost:3000` by default.

## Tests

Run the backend test suite:

```bash
```

## Debugging

Debug the backend with Node’s inspector:

```bash
node --inspect-brk src/index.js
```

Then attach from VS Code using the built-in Node.js debugger on port `9229`.

Useful entry points:
- `src/index.js` starts the API server.
- `src/workers/outboxPublisher.js` runs the outbox worker.
- `frontend/src/App.jsx` contains the optimistic transfer UI.

## MongoDB Replica Set Troubleshooting

If you run MongoDB manually and see `MongoServerError: This node was not started with replication enabled`, follow these steps:

1. Kill any running `mongod` process:
   ```bash
   pkill mongod
   ```

2. Start `mongod` with the replica set flag (required for transactions):
   ```bash
   mongod --replSet rs0 --bind_ip_all --port 27017
   ```

3. In a separate terminal, initialize the replica set:
   ```bash
   mongosh --eval "rs.initiate({_id:'rs0', members:[{_id:0, host:'localhost:27017'}]})"
   ```

4. Wait 10–15 seconds for primary election, then verify:
   ```bash
   mongosh --eval "rs.status()"
   ```
   You should see `"stateStr" : "PRIMARY"` in the output.

5. Start the backend:
   ```bash
   npm start
   ```

**Recommended**: Use `docker compose up --build` instead to skip manual MongoDB setup.

## Notes

- Copy `.env.example` to `.env` and set `MONGO_URI`, `MONGO_DB_NAME`, and `JWT_SECRET`.
- `src/config/database.js` centralizes the MongoDB connection.
- `src/routes/auth.js` shows the cookie-based login, refresh, and logout flow.
- `src/models/auditLog.js` is append-only and hash-chained.
- `src/utils/redisLock.js` contains a minimal Redis lock helper.

