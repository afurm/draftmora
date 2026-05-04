# Security Policy

Draftmora is a local-first personal task board. It is not designed as a
multi-tenant service and does not provide a hosted security boundary between
untrusted users.

## Reporting Vulnerabilities

Please report security issues privately through GitHub Security Advisories once
the repository is public. Do not open a public issue for vulnerabilities that
could expose credentials, local files, or user data.

Include:

- Affected version or commit SHA.
- Operating system and Node.js version.
- Affected component or file path.
- Steps to reproduce.
- Impact and the trust boundary crossed.
- Suggested remediation, if known.

## Trust Model

- The local operator is trusted.
- The API binds to `127.0.0.1` by default.
- Local SQLite data, `USER.md`, `MEMORY.md`, `.env`, and OAuth/API credentials
  are operator-owned local state.
- Project memory files are prompt context, not a security boundary.
- OpenAI account tokens and API keys must never be committed.
- Do not expose the API or Vite dev server to the public internet without a
  separate auth, firewall, VPN, or reverse-proxy policy.

## Out of Scope

- Reports requiring prior write access to trusted local state such as `.env`,
  `data/*.db`, `USER.md`, or `MEMORY.md`.
- Public internet exposure caused by intentionally changing the default host or
  deploying without separate network protection.
- Prompt-injection-only reports that do not bypass a concrete local trust
  boundary.
- Issues in test-only code that are not reachable from the app runtime.

## Dependency Security

Run this before publishing dependency changes:

```bash
npm audit
npm run typecheck
npm test
npm run build
```
