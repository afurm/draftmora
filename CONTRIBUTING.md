# Contributing to Draftmora

Thanks for helping improve Draftmora. Keep changes focused, evidence-backed,
and easy to review.

## Priorities

1. Bug fixes and data-loss prevention.
2. Security hardening around credentials, local files, memory, and API access.
3. Cross-platform reliability for macOS, Linux, and WSL2.
4. Small product improvements that preserve the local-first workflow.
5. Documentation and developer experience.

## Development Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://127.0.0.1:4141` by
default. Set `WEB_PORT` and `API_PORT` in `.env` to use another pair.

## Before Opening a PR

Run:

```bash
npm audit
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

For UI changes, include a screenshot or short recording. For bug fixes, include
the smallest reliable regression test or explain why existing coverage is
sufficient.

## PR Guidelines

- Keep one logical change per PR.
- Do not mix unrelated cleanup with product or security fixes.
- Explain the problem, the root cause, and the verification performed.
- Call out changes to auth, tokens, local storage, memory files, network calls,
  or command execution surfaces.
- Do not commit `.env`, SQLite databases, build output, dependency folders, or
  personal memory content.
- Use clear conventional commit-style titles when possible, such as
  `fix(settings): preserve OpenAI auth state`.

## Memory Files

Draftmora uses a built-in local memory pattern. `USER.md` and `MEMORY.md`
are plain local context files separated by `§`. Before publishing a branch,
review those files and remove private user or project facts that should not be
public.
