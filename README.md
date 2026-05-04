# Draftmora

![Draftmora app preview](https://raw.githubusercontent.com/afurm/draftmora/main/public/draftmora-preview.png)

Messy ideas in. Clear tasks out.

Draftmora is a local-first AI agent board for turning rough work into clear
next steps. Capture a draft, add task context, chat with the agent, and move
work through a focused board without sending project data to a hosted task
service.

The app runs on your machine, stores board data in SQLite, and can use OpenAI
through account auth or a local API key when a task needs execution help. With
account auth, eligible OpenAI accounts can connect from Settings instead of
pasting an API key.

## Features

- Local-first AI agent board with SQLite storage.
- Task status, priority, focus area, tags, and execution history.
- OpenAI account auth through the app settings, with API-key fallback.
- Agent chat with task proposals and explicit memory writes.
- Durable local memory files: USER.md and MEMORY.md.
- React, Vite, TypeScript, Fastify, shadcn/Radix UI, and Vitest.

## Requirements

- Node.js 22.14 or newer.
- npm 11 or newer.
- Optional: an OpenAI account connection for supported account-auth models, or
  `OPENAI_API_KEY` for API-key backed task execution.

## Quick Start

Run without installing:

```bash
npx draftmora
```

Then open `http://127.0.0.1:4141`.

Or run from a local checkout:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The API runs on `http://127.0.0.1:4141` by default. Local board data is stored
in `./data/board.db`.

## Configuration

Copy `.env.example` to `.env` when you need local overrides:

```bash
cp .env.example .env
```

Supported environment variables:

```bash
PORT=4141
BOARD_DB_PATH=./data/board.db
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
```

Open Settings in the app to connect an eligible OpenAI account/subscription or
save an API key locally. API keys, OAuth tokens, SQLite databases, build output,
and dependency folders should not be committed.

## Checks

Run the same validation before opening a PR or pushing release changes:

```bash
npm audit
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## npm Package

Draftmora publishes as a public npm package with a `draftmora` executable. The
package includes the built Fastify server and Vite client assets.

```bash
npm install -g draftmora
draftmora
```

By default the package starts on `http://127.0.0.1:4141` and stores data in
`./data/board.db` from the directory where the command is run. Set
`BOARD_DB_PATH` when you want a fixed database location.

## Security Model

Draftmora is designed as a personal, local-first app. The Fastify API binds to
`127.0.0.1` by default and assumes the local operator is trusted. Do not expose
the API or Vite dev server to the public internet without a separate auth,
firewall, VPN, or reverse-proxy policy.

Project memory is plain text in `USER.md` and `MEMORY.md`. Treat those files as
local operator state and review them before publishing a branch.

## Memory

Draftmora uses a built-in local memory pattern:

- `USER.md` stores durable user preferences and profile facts.
- `MEMORY.md` stores durable agent and project notes.
- Entries are compact plain text separated with `§`.
- There is no Memory page or dated memory log.
- Explicit "remember" requests save directly to the correct file.

## Development Notes

The interface is tuned for a dense SaaS dashboard workflow: left rail
navigation, status-aware board columns, compact task cards, a responsive command
header, and settings for focus areas.
