---
description: Generates or updates VS Code REST Client (.http) files in the `http/` directory. Trigger this when the user asks to test endpoints, create API requests, or update HTTP calls.
---

## Usage

**Loading the skill (generates/updates the `.http` files):**
* Explicit: run the slash command `/create-rest-calls` in Claude Code.
* Implicit: ask naturally — e.g. "create HTTP requests for the books API", "update the http files for the new review endpoint", "test the shelves endpoints" — Claude Code matches this against the skill's `description` and loads it automatically.
* On load, the skill runs `git diff HEAD` itself (see "Current changes" below) to see what changed, then writes/updates files under `http/`.

**Executing the generated requests (run the actual HTTP calls):**
* Requires the [REST Client extension](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) installed in VS Code.
* Start the app first (`npm run dev`, default `http://localhost:3000`).
* Open the relevant `.http` file under `http/`, and click "Send Request" above each `###`-separated block (or use the `Cmd+Alt+R` / `Ctrl+Alt+R` shortcut with the cursor inside a request).

## Current changes

!`git diff HEAD`

## Instructions

Your task is to create or update HTTP request files in the `http/` directory based on the user's request and the current code changes. You must strictly follow the VS Code REST Client extension syntax.

**1. Analyze the Context:**
* Review the `git diff HEAD` to identify new or modified API routes, HTTP methods, required headers, query parameters, and request body payloads (DTOs/schemas).
* If the diff doesn't cover the endpoints the user is asking about, read the relevant router directly — JSON endpoints live in `src/routes/api.ts`; HTML/HTMX routes live in `src/routes/books.ts`, `shelves.ts`, and `reviews.ts`.

**2. File Management:**
* Place all files inside the `http/` folder, relative to the repo root.
* Before creating a new file, check `http/` for an existing file covering the same domain (e.g., don't create both `book.http` and `books.http`) and update it instead.
* Use the `.http` file extension (e.g., `users.http`, `auth.http`).
* Group related endpoints into the same file based on the domain or controller.

**3. REST Client Syntax Rules:**
* Separate distinct requests within the same file using `###`.
* Define reusable variables at the top of the file (e.g., `@baseUrl = http://localhost:3000`).
* Reference variables using the `{{variableName}}` syntax.
* Always include appropriate headers (e.g., `Content-Type: application/json` or `Authorization: Bearer {{token}}`).
* Leave exactly one blank line between the headers and the request body.
* Never hardcode real credentials, tokens, or secrets pasted by the user — always use a placeholder variable (e.g., `@authToken = your_jwt_token_here`).

**4. Payload Generation:**
* Generate realistic placeholder data for JSON payloads based on the expected variable types in the code.

**Example Format:**
@baseUrl = http://localhost:3000
@authToken = your_jwt_token_here

### Get all items
GET {{baseUrl}}/api/items
Authorization: Bearer {{authToken}}

### Create new item
POST {{baseUrl}}/api/items
Content-Type: application/json
Authorization: Bearer {{authToken}}

{
  "name": "Sample Item",
  "status": "active"
}