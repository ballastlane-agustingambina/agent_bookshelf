# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Agent Bookshelf is a Goodreads-lite Express/TypeScript app used as a **teaching playground for an AI-agents course**. Students run it locally and use agents to complete homework. Some gaps in the code are deliberate (see "Deliberate gaps" below) — do not "fix" them unless the task explicitly asks for that feature.

## Commands

```bash
npm run dev            # tsx watch src/server.ts — dev server on :3000 (PORT env overrides)
npm run build          # tsc -> dist/ (src only; tests excluded)
npm start              # node dist/server.js (requires build first)
npm test               # vitest watch mode
npm run test:run       # vitest once (use this in agent workflows)

npx vitest run tests/models/book.test.ts          # single file
npx vitest run -t "returns a book by id"          # single test by name
```

`bin/agent-bookshelf.js` (the published `npx agent-bookshelf` entry) shells out to `npx tsx src/server.ts` — it runs TypeScript directly and does **not** use `dist/`.

## Architecture

Request flow: `src/server.ts` (Express app, EJS view engine, static `src/public/`) → routers → model functions → `better-sqlite3`.

**Three layers, strictly separated:**

- `src/db/index.ts` — module-level singleton connection. `initDb(path?)` opens the DB (default `./bookshelf.db`), applies `schema.sql`, and runs `seed.sql` **only when the users table is empty**. `getDb()` throws if `initDb` hasn't run. Everything else calls `getDb()`; nothing else opens a connection.
- `src/models/*.ts` — plain exported functions, **each takes `db` as its first argument** (`getAllBooks(db)`, `createReview(db, userId, bookId, ...)`). No classes, no ORM, raw prepared statements. Interfaces live next to the functions and use snake_case fields matching SQLite columns.
- `src/routes/*.ts` — Express routers that call `getDb()` and pass it down. Two parallel surfaces over the same models:
  - HTML: `books.ts` (mounted at `/`), `shelves.ts` (`/shelves`), `reviews.ts` (`/reviews`) — render EJS, or return **HTML fragments** for HTMX requests.
  - JSON: `api.ts` (`/api`) — REST CRUD for books, users, reviews, shelves.

**Imports must carry the `.js` extension** (`../models/book.js`) even from `.ts` files — the project is ESM (`"type": "module"`, `module: ES2022`).

## Code Style & Conventions

- Pure functions only in `src/models/*.ts`: export standalone functions receiving `db` as the first parameter. Do not introduce classes, repositories, or ORMs.
- Database queries: write raw prepared statements via `better-sqlite3` (`db.prepare(...)`). Never assemble SQL strings via dynamic concatenation or template literals.
- ESM imports: always suffix relative imports with `.js` (e.g., `import { getBookById } from '../models/book.js'`), even inside `.ts` files.
- Naming conventions: SQLite column names and TypeScript database interface properties use `snake_case`. Standard TypeScript variables and function names use `camelCase`.
- EJS & HTMX rendering: HTML routes responding to HTMX requests must render isolated partials without header or footer tags.

### Three "Never-Ever" Rules

1. **NEVER modify `src/db/seed.sql` or alter existing table schemas in `schema.sql`.**
   Test assertions and homework grading rely on exact fixture values (50 books, users Alice/Bob/Carol, ID 1 as "The Pragmatic Programmer"). Changing seeds or schemas breaks baseline tests across the suite.
2. **NEVER touch or "fix" code listed under "Deliberate gaps" unless explicitly instructed.**
   Do not add validation libraries, style overhauls, or missing tests unprompted. In this teaching repo, missing features are homework assignments for students, not bugs to clean up.
3. **NEVER install new npm packages or external client libraries.**
   Solve tasks strictly using the existing dependency tree and standard library. Do not pull in ORMs, query builders, test runners, or CSS frameworks.

### Views / HTMX

EJS templates in `src/views/`. Pages `include('../partials/header')` and `footer` rather than using `layout.ejs` (that file is unused). Interactivity is HTMX (`src/public/htmx.min.js`, vendored, no build step): an `hx-get`/`hx-post` targets a route that returns a partial such as `books/reviews-list.ejs` or `shelves/books-list.ejs`, not a full page. When adding an HTMX endpoint, render a fragment template — do not include header/footer.

### Schema

`src/db/schema.sql`: `books`, `users`, `shelves`, `shelf_books` (join table, composite PK), `reviews`. Constraints that route code relies on: `reviews` has `UNIQUE(user_id, book_id)` and `CHECK(rating BETWEEN 1 AND 5)`, `shelves` has `UNIQUE(user_id, name)`, `books.isbn` is unique. Foreign keys are enforced (`PRAGMA foreign_keys = ON`) with `ON DELETE CASCADE`.

Seed data is fixed and tests assert on it: 50 books, 3 users (alice/bob/carol), 9 shelves, book id 1 = "The Pragmatic Programmer". Changing `seed.sql` breaks `tests/db.test.ts` and `tests/routes/api.test.ts`.

## Testing

Vitest, `globals: true`, node environment, `tests/**/*.test.ts`. Each test file opens its **own** temp DB path under `/tmp` in `beforeEach` (via `initDb`) and unlinks it in `afterEach` — reuse that pattern with a distinct path per file, since the DB connection is a global singleton. API tests import the default-exported `app` from `src/server.ts` and drive it with `supertest` (importing `app` does not start a listener; `startServer()` does).

## Deliberate gaps

Left unimplemented on purpose as homework targets — treat them as the assignment, not as bugs to clean up in passing:

- `GET /books/search` in `src/routes/books.ts` returns a placeholder message. `Book.searchBooks()` already exists in the model, and `views/books/index.ejs` already wires the HTMX search box to it.
- No tests at all for `models/user.ts`, `models/review.ts`, `models/shelf.ts`; `tests/models/book.test.ts` and `tests/routes/api.test.ts` are intentionally partial (see `tests/README.md` for the exact list).
- `src/routes/api.ts` has only ad-hoc `if (!field)` checks — no validation layer.
- `src/public/css/style.css` is intentionally minimal.
