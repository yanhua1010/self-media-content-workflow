# Self-media workbench

A local operations workbench for the skill suite: radar, topics, content review, scheduling, publishing and analytics in one place. The agent does the thinking work through the skills; the workbench holds the state and the human approval gate.

Status: backend only (D1). The web UI comes next.

## Channels

| Channel | Platforms | What it does |
|---|---|---|
| AIsa Social API (`/apis/v1/social`) | YouTube today; X, TikTok, Instagram, LinkedIn, Threads and more once connected | connect accounts, upload media, draft, schedule, publish, account health |
| AIsa read APIs | X, YouTube, TikTok, Instagram, Xiaohongshu, WeChat articles | radar: public posts with link, publish time and engagement |
| WeChat Official Account API | 公众号 | draft box only, through `self-media-wechat-publisher`; mass-send stays manual |

## Rules

- `AISA_API_KEY` is read from the environment by the Node process only. It is never sent to the browser, written to the database or logged.
- Nothing reaches a platform unless the content is `approved`. Approval is a human action (UI button or `content:review --approve`).
- YouTube posts require an explicit `madeForKids` choice and a visibility. One active post per content and platform.
- Every paid call carries `X-AISA-Max-Price-USD`; every AIsa call is logged in the `spend` table.
- Radar is read-only, quoted first, and runs under a budget cap. Raw responses are kept under `data/radar/<time>/`.

## Run

Requires Node 22.13 or later. No dependencies.

```bash
npm run cli -- help
npm run cli -- accounts
npm run cli -- radar:quote --en "AI agent social media" --zh "AI 自媒体 工作流"
npm start          # http://127.0.0.1:4318
npm test
```

Local data lives in `data/` (git-ignored).
