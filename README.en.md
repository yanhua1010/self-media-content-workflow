# Self Media Skills

[![CI](https://github.com/yanhua1010/self-media-content-workflow/actions/workflows/validate.yml/badge.svg)](https://github.com/yanhua1010/self-media-content-workflow/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-informational)](CHANGELOG.md)

[简体中文](README.md) | **English**

A modular, tool-agnostic suite of agent skills for social-media content operations: from a vague idea to a confirmed brief, account strategy, trend and competitor research, platform-native copy, short-video packages, optional digital-human and animated-explainer production, multi-platform video publishing (YouTube, Douyin, WeChat Channels, Xiaohongshu), WeChat draft publishing, performance reviews, and verified delivery — the full content loop.

- **Tool-agnostic** — no binding to a specific model, browser, image, video, publishing, or analytics service; capabilities are discovered from the running environment
- **Platform-native** — one topic shares facts and evidence, while titles, openings, structure, and calls to action are designed per platform
- **Human-in-the-loop** — five mandatory approval gates (direction, platforms, title, final copy, publishing); drafts and publishing packages by default, never automatic broadcasting
- **Evidence-first** — every key number needs a source; facts, opinions, inferences, and advice stay separated; no fabricated data, experience, or results
- **Systematic visuals** — eight built-in image-style presets with platform routing; a style is chosen before generation, one style per image set, and account preferences override preset defaults

For digital-human production, the user must personally upload and select likeness and voice assets in the chosen provider after reviewing its current data-processing terms. Task files, registries, and the repository must not store the original portrait or recording, their local paths, temporary links, or provider-private identifiers; they only index paths of deliverables such as generated clips, final videos, and caption files.

## Architecture

```mermaid
graph TD
    W["self-media-content-workflow<br/>Orchestrator: routing · state · approvals"]
    W --> B["content-brief<br/>Creative brief"]
    W --> S["content-strategy<br/>Strategy"]
    W --> R["trend-radar<br/>Trends & competitors"]
    W --> C["platform-copywriting<br/>Platform copy"]
    W --> V["short-video<br/>Short video"]
    W --> A["content-analytics<br/>Analytics"]
    W --> D["content-delivery<br/>Delivery"]
    W --> P["wechat-publisher<br/>WeChat publishing"]
    W --> U["video-publisher<br/>Video publishing"]
```

| Skill | Responsibility |
|---|---|
| [`self-media-content-workflow`](skills/self-media-content-workflow/SKILL.md) | Request routing, state management, approvals, and end-to-end orchestration |
| [`self-media-content-brief`](skills/self-media-content-brief/SKILL.md) | Audience, goal, evidence, angle, tone, and constraints |
| [`self-media-content-strategy`](skills/self-media-content-strategy/SKILL.md) | Positioning, content mix, series, topic pool, and calendar |
| [`self-media-trend-radar`](skills/self-media-trend-radar/SKILL.md) | Trend tracking, keyword research, competitor teardowns, and original topics |
| [`self-media-platform-copywriting`](skills/self-media-platform-copywriting/SKILL.md) | Native copy for X, Xiaohongshu, WeChat, short-video platforms, and YouTube, plus the visual style library |
| [`self-media-short-video`](skills/self-media-short-video/SKILL.md) | Hooks, spoken script, storyboard, captions, shoot plan, optional digital-human and animated-explainer production, and landscape/vertical platform versions |
| [`self-media-content-analytics`](skills/self-media-content-analytics/SKILL.md) | Data quality, comparable baselines, attribution, decisions, and experiments |
| [`self-media-content-delivery`](skills/self-media-content-delivery/SKILL.md) | Milestone files, versions, path verification, and publishing packages |
| [`self-media-wechat-publisher`](skills/self-media-wechat-publisher/SKILL.md) | WeChat formatting, image upload, draft creation, and image-message posts |
| [`self-media-video-publisher`](skills/self-media-video-publisher/SKILL.md) | Per-platform video publish packs; with per-platform authorization, uploads to YouTube, Douyin, WeChat Channels, and Xiaohongshu as private, draft, or scheduled |

## Quick start

### Install

**Claude Code (recommended, no Node.js required)**

Run these two commands inside Claude Code to install all 10 skills at once:

```text
/plugin marketplace add yanhua1010/self-media-content-workflow
```

```text
/plugin install self-media-suite@self-media
```

**Other agents (Codex, Cursor, and more)**

Use the official [skills CLI](https://github.com/vercel-labs/skills) (requires Node.js):

```bash
# Install all 10 skills into the current project
npx skills add yanhua1010/self-media-content-workflow

# Install into the user-global skill directory
npx skills add yanhua1010/self-media-content-workflow -g
```

Install a subset with `--skill <name>`, and target specific agents with `-a`:

```bash
npx skills add yanhua1010/self-media-content-workflow --skill self-media-content-workflow -a claude-code
```

### First task

Start from the orchestrator; it routes to the modules it needs:

```text
Use $self-media-content-workflow to turn this product-failure story into an X thread and a Xiaohongshu carousel.
```

Modules can also be invoked directly:

```text
Use $self-media-content-strategy to build a topic pool and a one-month calendar for a new account.

Use $self-media-trend-radar to research the most-asked questions about AI coding content in the last month.

Use $self-media-content-analytics to review these 10 posts and identify the single next experiment.
```

> The exact skill-invocation syntax depends on your agent.

## Workflow

```text
Clarify → Direction approval* → Research & evidence → Platform approval* → Preflight
→ Platform-native draft → Title approval* → Assets (live-action / digital human) → Quality gates
→ Final-copy approval* → Publishing authorization* → Draft or publishing package → Review
```

`*` marks a mandatory human approval gate. Final-copy approval is not publishing authorization: skills create drafts or manual publishing packages by default and never broadcast.

Before assets are generated, the workflow recommends 2-3 styles from the [visual style library](skills/self-media-platform-copywriting/references/visual-styles.md) based on content type and platform, or reuses the account's established preference.

## Safety boundaries

- No automated competitor scraping with a creator's primary account session
- No automatic likes, comments, follows, DMs, or publishing
- No cookies, tokens, or secrets in task cards, logs, or the repository
- Digital-human portraits, likenesses, and voices must have confirmed usage rights; the user personally uploads and selects them in the chosen provider after reviewing its current data-processing terms
- No original portraits or recordings, their local paths, temporary links, or digital-human provider-private identifiers in task cards, content registries, or the repository — only index paths of deliverables such as generated clips, final videos, and captions; confirm the required AI/digital-human disclosures per target platform
- Stop immediately on CAPTCHAs, rate limits, or platform risk controls
- Verify recent products, prices, versions, and platform rules against official sources
- Never invent data, experience, revenue, user feedback, or test results

See [SECURITY.md](SECURITY.md) for the full policy.

## Validation

```bash
python3 scripts/validate.py
```

The validator checks skill frontmatter, directory consistency, core-file length, UI metadata, relative links, and unresolved TODOs, with no third-party dependencies. CI runs the structural validation on every push and performs a real installation test with the official skills CLI.

## Repository layout

```text
skills/                   # 10 independently installable skills
├── <skill>/SKILL.md      #   core workflow (≤ 500 lines)
├── <skill>/references/   #   detailed platform guidance
└── <skill>/assets/       #   copyable output templates
scripts/validate.py       # repository validation
.claude-plugin/           # Claude Code plugin and marketplace manifests
.github/workflows/        # structural validation + install test
```

## Design decisions

- One orchestrator owns routing and state; eight modules each own a single responsibility
- Collection and publishing are runtime adapter layers, never vendor-bound
- Platforms share facts and evidence while titles, openings, structure, and actions are rewritten per platform
- Platform limits change; exact values defer to official documentation or the publishing interface

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and run `python3 scripts/validate.py` before submitting. See [CHANGELOG.md](CHANGELOG.md) for release history.

## Disclaimer

This project is a content-creation assistance Skill suite, provided "as is" without warranty of any kind, express or implied. Before using it:

- **Official platform rules prevail.** Platform conventions, publishing flows, and operational advice in this repository reflect experience at the time of writing, and platform rules can change at any time. When an exact value matters, defer to official announcements and the current publishing interface.
- **Account operations are at your own risk.** This project performs real account operations, such as writing WeChat Official Account drafts. The author is not liable for rate limiting, account suspension, content removal, data loss, or any other damages arising from use of this project.
- **You control your own credentials.** This project does not collect, transmit, or store credentials. Secrets such as `WECHAT_APP_ID` and `WECHAT_APP_SECRET` are supplied only through your local environment variables — never write them into any file that could be committed or shared.
- **Content compliance is the publisher's responsibility.** The compliance checklists here are not legal advice. Whether your published content complies with applicable advertising and content laws, and with each platform's community guidelines, is yours to judge and to answer for.
- **No results are guaranteed.** This project makes no promise regarding reach, follower growth, conversion, or revenue.

## License

[MIT](LICENSE)
