# social-auto-upload（SAU）适配器

本适配器按 SAU 仓库 `dreammis/social-auto-upload` 的主线源码与文档核对，网页所示 HEAD 为 `0012d2c355f88f683cc38dde2a2db209e14091bc`（2026-09-02）。本环境无法完成指定的本地克隆，因此该哈希来自 [GitHub 提交页](https://github.com/dreammis/social-auto-upload/commit/0012d2c355f88f683cc38dde2a2db209e14091bc)，未能用本地 `git rev-parse HEAD` 复核。参数依据 [sau_cli.py](https://github.com/dreammis/social-auto-upload/blob/0012d2c355f88f683cc38dde2a2db209e14091bc/sau_cli.py)、[安装说明](https://github.com/dreammis/social-auto-upload/blob/0012d2c355f88f683cc38dde2a2db209e14091bc/docs/install.md) 和 [pyproject.toml](https://github.com/dreammis/social-auto-upload/blob/0012d2c355f88f683cc38dde2a2db209e14091bc/pyproject.toml)。

## macOS 安装与一次性登录

SAU 要求 Python `>=3.10,<3.13`；官方安装说明推荐 `uv`、虚拟环境、可编辑安装和 Patchright Chromium。目标安装目录为 `/Users/xiademacbookpro/tools/social-auto-upload`，在有网络及该目录写权限的本机终端执行：

```bash
git clone https://github.com/dreammis/social-auto-upload /Users/xiademacbookpro/tools/social-auto-upload
cd /Users/xiademacbookpro/tools/social-auto-upload
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e .
PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright" patchright install chromium
cp conf.example.py conf.py
sau --help
```

首次登录由用户本人在本机操作；`default` 是本适配器默认的自定义账号名，同一平台可改为其他名称，并在脚本中传 `--account <名称>`。抖音、视频号、小红书通常需要扫码；YouTube 需在浏览器完成 Google 登录，不是扫码。不要把二维码、Cookie 或登录输出贴进发布包。

```bash
sau douyin login --account default --headed
sau tencent login --account default --headed
sau xiaohongshu login --account default --headed
sau youtube login --account default --headed
```

SAU 的 `resolve_account_file()` 使用 `BASE_DIR/cookies/<platform>_<account>.json`，视频号的平台名是 `tencent`。登录态只留在 SAU 本机目录；本适配器不读写这些文件。`sau <platform> check --account default` 可由用户自行核对登录态。

## 已核对的 CLI 契约

四个平台均为 `sau <platform> login|check|upload-video --account <自定义名>`，上传必填 `--file` 与 `--title`，可用 `--desc` 和逗号分隔的 `--tags`。有 `--schedule` 的平台采用本地时间 `YYYY-MM-DD HH:mm`。`--headed` / `--headless` 是运行参数，默认无头。脚本逐平台读取 `self-media/` 中的 Markdown 发布包，并以参数数组调用 SAU，不使用 shell 拼接。

| 平台 / SAU 名 | AI 声明 | 合集或播放列表 | 封面 | 定时 | 草稿或私密 |
|---|---|---|---|---|---|
| 抖音 / `douyin` | `--declaration "内容由AI生成"` | `--collection`，已有合集 | `--thumbnail`（竖版）；另有 `--thumbnail-landscape`、`--thumbnail-portrait` | `--schedule` | 无 `--draft`、无私密参数 |
| 视频号 / `tencent` | 无声明参数，须手动核对 | `--collection`，已有合集 | `--thumbnail`（竖版）；另有横竖版参数 | `--schedule` | `--draft` |
| 小红书 / `xiaohongshu` | 无声明参数，须在 app 勾选 | 无 `--collection` | `--thumbnail` | `--schedule` | 无 `--draft`、无私密参数 |
| YouTube / `youtube` | 无声明参数，须在 Studio 勾选 | `--playlist` | `--thumbnail` | 无 `--schedule` | `--visibility private` 或 `unlisted`；SAU 默认 `public` |

SAU 小红书视频标签最多 10 个。视频号还提供 `--short-title`。抖音 `--declaration` 接受页面选项原文；源码的选项是「内容由AI生成」。其他三个平台的 `upload-video` 参数中没有 AI 声明开关。

## 脚本命令与人工确认

从仓库根目录运行：

```bash
node skills/self-media-video-publisher/scripts/publish.mjs --episode /path/to/episode --platforms douyin,weixin,xhs,youtube --dry-run
node skills/self-media-video-publisher/scripts/publish.mjs --episode /path/to/episode --platforms weixin,youtube --mode draft --sau /Users/xiademacbookpro/tools/social-auto-upload/.venv/bin/sau
```

脚本对每个平台分别显示计划并询问 `确认执行？(y/N)`；`--yes` 表示用户已对所列每个平台及该视频授权。成功后只回填 SAU 返回成功，不把它当作平台后台核验通过。

脚本生成的关键参数如下；`<...>` 由发布包字段填入：

```text
sau douyin upload-video --account default --file <视频> --title <标题> --desc <正文> --tags <标签> --thumbnail <封面> --declaration "内容由AI生成" --collection <已有合集> --schedule "YYYY-MM-DD HH:mm"
sau tencent upload-video --account default --file <视频> --title <短标题> --desc <正文> --tags <标签> --thumbnail <封面> --short-title <短标题> --draft --collection <已有合集>
sau xiaohongshu upload-video --account default --file <视频> --title <标题> --desc <正文> --tags <最多10个标签> --thumbnail <封面> --schedule "YYYY-MM-DD HH:mm"
sau youtube upload-video --account default --file <视频> --title <标题> --desc <正文> --tags <标签> --thumbnail <封面> --visibility private --playlist <已有播放列表>
```

`--mode draft` 下，抖音和小红书没有 SAU 草稿命令，脚本拒绝真实执行；dry-run 会明确显示此缺口。`--mode schedule --at "YYYY-MM-DD HH:mm"` 对这两个平台走工作流的 L3 定时发布：到点自动公开，所以脚本会逐平台要求人工确认（`--yes` 对它们无效），确认后才执行；发布前可以在 app 里撤回或修改定时作品。视频号始终用草稿，YouTube 始终用私密；不会调用 SAU 的默认公开值。

## 风险与收尾

- SAU 是非官方浏览器自动化，可能触及平台服务条款或风控；网页改版会使选择器失效。验证码、登录失效和风控出现时停止，交由用户处理。
- 抖音源码的合集选择失败可能跳过合集继续发布，执行后必须在平台后台核对合集和 AI 声明。小红书、视频号、YouTube 的 AI 声明须在相应 app 或 Studio 手动核对；小红书尤其要勾选 AI 开关。
- 能用草稿或私密的平台（视频号、YouTube）始终先草稿/私密，由人类在 app 中确认并发布。抖音、小红书没有这条路径，只提供 L3 定时发布：用户明确给出时间并逐平台确认后执行，到点自动公开；定时不能视作草稿，发布前请在 app 里复核。
