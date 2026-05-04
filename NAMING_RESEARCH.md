# Naming Research

Date: 2026-05-02

## Recommendation

Keep the product name as **Draftmora**.

Use a descriptive AI-agent phrase around it:

- Product name: **Draftmora**
- Short descriptor: **local AI agent task board**
- Main tagline: **Messy ideas in. Clear tasks out.**
- Longer tagline: **A local AI agent that turns rough ideas into clear next steps, with you approving every change.**
- GitHub repo slug: `draftmora` if available, otherwise `draftmora-ai-agent`
- Package name: `draftmora`
- GitHub description: `Local-first AI agent task board for turning rough ideas into approved next steps with OpenAI.`

This keeps the name friendly for non-technical users while still giving GitHub,
Google, and the later website the keywords people will search for: AI agent,
task board, OpenAI, local-first, productivity, and planning.

## Why Draftmora Works

- It is more distinctive than generic names built from `task`, `plan`, `agent`,
  or `assistant`.
- It already matches the current product behavior: capture a rough draft, ask AI
  to shape it, then approve the tasks that belong on the board.
- It avoids making the app sound like a developer tool. The app can say "AI
  helper" in the UI and "AI agent" in the website subtitle, README, and GitHub
  topics.
- Initial web search did not surface an obvious active product named Draftmora.
- DNS checks returned no A/CNAME records for `draftmora.com`, `draftmora.ai`,
  `draftmora.app`, `draftmora.dev`, or `draftmora.io`. This is not registrar or
  trademark clearance, but it is a useful first filter.

## Market Notes

The AI-agent category is now understandable enough to use in public positioning.
OpenAI describes ChatGPT agent as software that can think, act, use tools, and
complete complex tasks, while still asking permission for consequential actions.
That maps well to this app's approval-first workflow.

For non-technical users, the stronger pattern is not "agentic workflow platform".
It is clear outcome language:

- Todoist uses "Task Assist" and promises help turning goals into action plans.
- Doable uses "AI planner" and an assistant name, Able, for voice-to-task capture.
- Clearstep AI sells "clear steps" and "zero jargon" rather than agent mechanics.
- Reclaim frames tasks as a bridge between the to-do list and the calendar.
- Taskade uses AI agents, but explains them as smart assistants/team members.

So Draftmora should use:

- In-app language: **AI helper**, **clear next steps**, **approve changes**
- Website/README language: **local AI agent**, **task board**, **OpenAI**
- Technical details: hidden behind disclosures, not primary marketing copy

## Names To Avoid

| Name | Reason |
| --- | --- |
| `local-ai-task-board` | Accurate but too technical and not brandable. |
| `Taskmora` | More obvious, but search found Taskmora Solutions and `taskmora.com` has DNS records. |
| `Planmora` | Active `planmora.com` result already exists. |
| `Agentmora` | More unique, but "agent" in the brand makes the product feel technical. |
| `TaskAide` | Multiple active TaskAide results already exist. |
| `TaskMate` | Very crowded across AI automation and task apps. |
| `PlanMate` | Active AI planning apps already exist. |
| `Doable` | Strong friendly name, but active AI planner products already exist. |
| `Donewise` | Active AI assistant/productivity products already exist. |
| `Daygent` | Active AI consulting/productivity results already exist. |
| `Clearstep` | Strong wording, but active AI simplicity/learning product already exists. |

## Website Copy Seed

Hero:

```text
Draftmora

Messy ideas in. Clear tasks out.

Draftmora is a local AI agent task board that helps you turn rough notes into
next steps you can trust. Connect OpenAI, review every suggestion, and approve
only what belongs on your board.
```

GitHub README opening:

```text
Draftmora is a local-first AI agent workspace for people who want help planning
without giving up control. Capture a rough idea, let OpenAI break it into clear
next steps, then approve what belongs on your task board.
```

Meta title:

```text
Draftmora - Local AI Agent Task Board
```

Meta description:

```text
Draftmora is a local-first AI agent task board that turns rough ideas into
approved next steps with OpenAI.
```

## Public Repo Prep

Use these GitHub topics:

```text
ai-agent
task-board
openai
local-first
productivity
task-management
sqlite
vite
react
typescript
```

Recommended public README positioning:

- Lead with user value before architecture.
- Keep "OpenAI account auth" and "API key mode" visible under setup.
- Keep "local-first" and "approval-first" prominent for trust.
- Avoid saying the app is autonomous. It suggests and works with approval.

## Sources Checked

- OpenAI, ChatGPT agent: https://openai.com/index/introducing-chatgpt-agent/
- OpenAI, governing agentic AI systems: https://openai.com/index/practices-for-governing-agentic-ai-systems/
- Taskade AI agents docs: https://docs.taskade.com/docs/core-features/ai-features/ai-agents-getting-started
- Todoist Task Assist: https://www.todoist.com/integrations/apps/task-assist
- Reclaim getting started: https://help.reclaim.ai/en/articles/5224992-getting-started-with-reclaim
- Doable AI planner: https://getdoable.app/
- Clearstep AI: https://www.clearstepai.org/
- Donewise AI: https://donewiseai.com/
- TaskMate AI: https://www.taskmate-ai.com/
- PlanMate AI: https://www.myplanmate.ai/
