"""Render the daily brief as Markdown."""

from __future__ import annotations

import time

from .score import SideStats, TopicGap

SIDE_LABEL = {"global": "海外（X / YouTube / Reddit）", "cn": "国内（小红书 / 抖音 / B站）"}


def _date(ts: int | None) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts)) if ts else "—"


def _metrics(m: dict) -> str:
    return " · ".join(f"{k} {v:,}" for k, v in m.items() if v)


def _side(label: str, s: SideStats) -> list[str]:
    lines = [f"**{label}**：热度 {s.heat}，窗口内 {s.fresh_count} 条，最早 {_date(s.first_seen)}", ""]
    for it in s.top:
        title = it.title.replace("\n", " ").replace("|", "/")[:80] or "(无标题)"
        lines.append(f"- [{it.platform}] [{title}]({it.url}) — {it.author}，{_date(it.published_at)}，{_metrics(it.metrics)}")
    if not s.top:
        lines.append("- 窗口内没有结果")
    return lines + [""]


def render(gaps: list[TopicGap], window_days: int, spent_usd: float, date: str) -> str:
    gaps = sorted(gaps, key=lambda g: abs(g.gap), reverse=True)
    out = [
        f"# 海外对照 · {date}",
        "",
        f"窗口：最近 {window_days} 天 · 本次花费 ${spent_usd:.4f}",
        "",
        "热度 = 前 5 条内容互动量的 log10 均值，差 1 分约等于热 10 倍。热度差 = 海外热度 − 国内热度。",
        "",
        "| 话题 | 海外热度 | 国内热度 | 热度差 | 判断 |",
        "|---|---|---|---|---|",
    ]
    for g in gaps:
        out.append(f"| {g.topic} | {g.global_side.heat} | {g.cn_side.heat} | {g.gap:+} | {g.verdict} |")
    out.append("")
    for g in gaps:
        out += [f"## {g.topic}", "", f"{g.verdict}（热度差 {g.gap:+}）", ""]
        out += _side(SIDE_LABEL["global"], g.global_side)
        out += _side(SIDE_LABEL["cn"], g.cn_side)
    return "\n".join(out)
