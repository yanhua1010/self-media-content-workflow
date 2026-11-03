# Reddit 讨论发现

为产品或内容找到值得参与的子版块和讨论帖，交给 `self-media-platform-copywriting` 的 [Reddit 规范](../../self-media-platform-copywriting/references/reddit.md)起草回复或发帖。只读，不登录、不发帖、不投票。

## 流程

1. **定关键词**：从产品简报中提取 3 到 5 组英文关键词，覆盖用户的问题（如 `repurpose content multiple platforms`）、品类（如 `AI agent social media`）和生态（如 `claude code skills`）。用用户会搜的说法，不用产品名。
2. **搜帖子**：按关键词搜近一个月的帖子，按相关度排序。记录子版块、标题、得分、评论数、发布时间和链接。
3. **筛帖子**：优先选楼主在提问、评论还在增加、发布不超过两周、未锁定和未归档的帖子。评论区已经被同类产品刷屏的帖子降级。
4. **读评论**：打开候选帖，读楼主正文和高赞评论，确认还有没被回答的角度，记录评论区的真实需求和反对意见。
5. **读版规**：对每个候选子版块读取版规，标出是否禁止 AI 生成内容、是否禁止自我推广或链接、自荐比例和项目展示周帖。
6. **出清单**：每个候选给出帖子链接、子版块、版规结论（可回复带链接 / 可回复不带链接 / 不参与）和建议切入角度。

## 用 AIsa 获取数据（可选）

环境变量 `AISA_API_KEY` 已设置时，可通过 [AIsa](https://aisa.one) REST API（`https://api.aisa.one/apis/v1`）获取公开数据，每次请求先加 `X-AISA-Cost-Mode: quote` 报价，告诉用户调用次数和预估费用，同意后再执行：

| 步骤 | 接口 | 主要参数 |
|---|---|---|
| 搜帖子 | `GET /reddit/search` | `query`、`filter=posts`、`sort=relevance`、`timeframe=month`、`trim=true` |
| 读评论 | `GET /reddit/post/comments` | `url`（帖子链接）、`trim=true` |
| 读版规 | `GET /reddit/subreddit/details` | `subreddit`（区分大小写） |

2026-11 实测每次请求约 $0.0019。5 组关键词、6 个帖子、6 个子版块共 17 次请求，约 $0.03。版规在 `rules` 字段，为纯文本。

没有 key 时，在浏览器里用 Reddit 站内搜索和子版块侧栏完成同样的步骤，遵守 [research-safety.md](research-safety.md)。

## 注意

- 结果只说明哪里在讨论，不代表欢迎推广。版规结论优先于热度。
- 不收集评论者的个人信息，清单里只保留帖子链接和公开内容摘要。
