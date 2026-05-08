# Changelog

All notable changes to Draftmora are tracked here.

## 0.1.2 - 2026-05-08

### Changed

- Redesigned the board workspace for denser task scanning and mobile-friendly
  navigation.
- Reworked the chat workspace with clearer thread controls and responsive
  layout behavior.
- Improved the settings experience for account state, advanced OpenAI controls,
  and focused save flows.
- Refined sidebar navigation, collapsed states, and route-aware labels.

## 0.1.1 - 2026-05-06

### Added

- Task artifacts with local file reveal support.
- Task run cancellation controls.
- Force follow-up request flow for active task runs.
- Automatic durable-memory review after chat turns and task execution.
- Advanced OpenAI request settings for reasoning, verbosity, retries, timeout,
  cache retention, and transport.
- Configurable web and API ports with IPv6-safe Vite proxy handling.

### Changed

- Redesigned the task detail workspace for denser execution and artifact review.
- Improved run log scrolling and current-step status copy.
- Restricted forced follow-ups to the latest queued request.
- Added transient retry handling for OpenAI provider errors.
- Refreshed dependency versions and CI action pins.
- Moved README-only preview art out of runtime public assets.

## 0.1.0 - 2026-05-05

### Added

- First public npm release of Draftmora.
- Local-first task board with SQLite storage.
- Board and chat workflows with task proposals.
- OpenAI account auth with API-key fallback.
- Durable local `USER.md` and `MEMORY.md` memory files.
- GitHub Actions CI and public package validation.
