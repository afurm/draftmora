# Contributing to Draftmora

Thanks for helping improve Draftmora. Keep changes focused, evidence-backed,
and easy to review.

## Priorities

1. Bug fixes and data-loss prevention.
2. Security hardening around credentials, local files, memory, and API access.
3. Cross-platform reliability for macOS, Linux, and WSL2.
4. Small product improvements that preserve the local-first workflow.
5. Documentation and developer experience.

## First Contribution

Start with a small, testable issue from
[`good first issue`](https://github.com/afurm/draftmora/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
or
[`help wanted`](https://github.com/afurm/draftmora/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22help%20wanted%22).
If the issue is open and unassigned, leave a short comment saying what you plan
to change before you start.

Use this local loop:

1. Fork or clone the repository and create a focused branch.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:5173`.
4. Make one logical change tied to the issue.
5. Run the relevant checks from the PR checklist below.
6. Open a PR that links the issue and describes the verification you performed.

Keep local state out of the branch. Do not commit `.env`, SQLite databases,
`USER.md`, `MEMORY.md`, build output, dependency folders, logs, or personal
demo data. For UI changes, attach a screenshot or short recording so reviewers
can see the behavior without reproducing every step.

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
