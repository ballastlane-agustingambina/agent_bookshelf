# Local LLM Memory Bank Guide

This guide explains how to start and use the memory bank feature in Agent Bookshelf, powered by Qdrant (Vector DB) and Ollama (Local LLMs). The implementation lives in `src/services/memoryBank.ts` (Qdrant client), `src/core/agent.ts` (`chatWithMemory`, built on top of it), and `src/routes/chat.ts` (the HTTP route, mounted at `/api` in `src/server.ts`).

## 1. Prerequisites

Before running the server, ensure you have both Docker and Ollama installed and running on your machine.

You need to pull the required models into Ollama:
```bash
# Pull the embedding model (converts text to vectors)
ollama pull nomic-embed-text

# Pull the chat model (generates responses)
ollama pull qwen3.8:27b
```
> **Check this tag before pulling.** `qwen3.8:27b` (the default in `chatWithMemory`, `src/core/agent.ts`) doesn't match Ollama's usual `<model>:<size>` tag format (e.g. `qwen3:8b`) — verify it resolves with `ollama pull qwen3.8:27b` first. If it 404s, pull the correct tag and update the `model` default parameter in `src/core/agent.ts` accordingly.

## 2. Start the Vector Database

Start Qdrant using the provided `docker-compose.yml` file (repo root). This runs in the background and saves data locally to the `./qdrant_storage` folder.

```bash
docker compose up -d
```

Qdrant listens on `localhost:6333`, matching the URL hardcoded in `src/services/memoryBank.ts`.

## 3. Start the Express Server

```bash
npm run dev
```

This runs `tsx watch src/server.ts` (see `package.json`). Watch the console output. You should see:
> Memory Bank initialized via Qdrant.
> Bookshelf running at http://localhost:3000

If Qdrant or Ollama isn't reachable, `startServer()` in `src/server.ts` catches the error, logs `Failed to initialize Memory Bank: ...`, and the server **still starts** — but `app.locals.memoryBank` will be `undefined`, so anything that reads it (see sections 4–5) will throw. If you see that error, confirm `docker compose ps` shows `qdrant` running and `ollama list` includes both pulled models before retrying.

## 4. Testing the Memory Bank

You can interact with the agent via `POST /api/chat` (`src/routes/chat.ts`). Each request calls `chatWithMemory()`, which recalls related past exchanges from Qdrant, asks Ollama for a reply, then stores this new exchange for future recall — so memory accumulates across requests. Ready-made requests are in `http/memory-bank.http`.

**Test 1: Store a memory**

```bash
curl -X POST http://localhost:3000/api/chat \
-H "Content-Type: application/json" \
-d '{"message": "Hi, my name is Alex and my favorite book on this shelf is Dune."}'
```
*The AI should reply greeting Alex and acknowledging the book.*

**Test 2: Recall the memory**

```bash
curl -X POST http://localhost:3000/api/chat \
-H "Content-Type: application/json" \
-d '{"message": "What did I say my favorite book was?"}'
```
*The AI will query Qdrant, retrieve the previous exchange, and mention Dune in its reply.*

`chat.ts` returns `400` for a missing/empty `message`, `503` if the Memory Bank failed to initialize (see section 3), and `500` if Ollama or Qdrant fails mid-request.

## 5. Using the Memory Bank in other Routes

The initialized `MemoryBank` instance is attached to the Express app locals in `src/server.ts`. You can access it in any router (like `books.ts` or `reviews.ts`) without creating a new connection:

```typescript
// Inside any route handler:
const memoryBank = req.app.locals.memoryBank;

// Save something manually
await memoryBank.remember("User reviewed '1984' with 5 stars.");

// Retrieve context manually
const context = await memoryBank.recall("What did the user think of 1984?");
```

`memoryBank` is `undefined` if initialization failed (see section 3) — guard for that in real route code rather than assuming it's always present.
