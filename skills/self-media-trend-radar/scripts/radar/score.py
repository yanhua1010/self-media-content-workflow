"""Heat per side and the cross-language gap for one topic.

Item heat is log10(1 + engagement), so one point means ten times more
engagement. Side heat is the mean of the top-N fresh items: robust to one viral
outlier and comparable across platforms that return different list sizes.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

from .sources import CN, GLOBAL, Item

TOP_N = 5


def item_heat(it: Item) -> float:
    return math.log10(1 + max(it.engagement, 0))


@dataclass
class SideStats:
    heat: float = 0.0
    fresh_count: int = 0
    first_seen: int | None = None  # earliest publish time among fresh items
    top: list[Item] = field(default_factory=list)


@dataclass
class TopicGap:
    topic: str
    global_side: SideStats
    cn_side: SideStats
    gap: float  # global heat minus CN heat, in orders of magnitude
    # first-seen dates within one window are mostly the window edge; a real lag needs daily history (v0.2)
    lag_days: float | None
    verdict: str


def side_stats(items: list[Item], window_days: int, now: float) -> SideStats:
    cutoff = now - window_days * 86400
    # items without a timestamp still count: they came from a recency-sorted search
    fresh = [i for i in items if i.published_at is None or i.published_at >= cutoff]
    fresh.sort(key=item_heat, reverse=True)
    top = fresh[:TOP_N]
    stamps = [i.published_at for i in fresh if i.published_at]
    return SideStats(
        heat=round(sum(map(item_heat, top)) / TOP_N, 2) if top else 0.0,
        fresh_count=len(fresh),
        first_seen=min(stamps) if stamps else None,
        top=top,
    )


def verdict(gap: float, g: SideStats, c: SideStats) -> str:
    if g.fresh_count == 0 and c.fresh_count == 0:
        return "两边都冷"
    if gap >= 1:
        return "海外热、国内冷：搬到国内的机会"
    if gap <= -1:
        return "国内热、海外冷：出海的机会"
    return "两边热度接近"


def topic_gap(topic: str, items: list[Item], window_days: int = 14, now: float | None = None) -> TopicGap:
    now = now if now is not None else time.time()
    g = side_stats([i for i in items if i.side == GLOBAL], window_days, now)
    c = side_stats([i for i in items if i.side == CN], window_days, now)
    gap = round(g.heat - c.heat, 2)
    lag = None
    if g.first_seen and c.first_seen:
        lag = round((c.first_seen - g.first_seen) / 86400, 1)
    return TopicGap(topic, g, c, gap, lag, verdict(gap, g, c))
