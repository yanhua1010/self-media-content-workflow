"""Per-platform search calls and parsers that normalize results into Items.

Each platform reports engagement differently, so every parser maps its fields
into the same Item, and `engagement` is a platform-specific weighted sum that
`score.py` puts on a common log scale.
"""

from __future__ import annotations

import calendar
import re
import time
from dataclasses import dataclass, field
from typing import Callable

from .client import Call

GLOBAL = "global"
CN = "cn"


@dataclass
class Item:
    platform: str
    side: str
    title: str
    url: str
    author: str
    published_at: int | None  # unix seconds; None when the platform gives no usable time
    metrics: dict = field(default_factory=dict)
    engagement: float = 0.0


@dataclass
class Source:
    platform: str
    side: str
    lang: str  # which keyword list of a topic this source searches with
    build: Callable[[str], Call]
    parse: Callable[[dict], list[Item]]


def _int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


_TAG = re.compile(r"<[^>]+>")


def _strip_tags(s: str) -> str:
    return _TAG.sub("", s or "").strip()


# YouTube gives "4w ago", "7mo ago", "1y ago", and sometimes the long form "3 weeks ago"
_REL = re.compile(r"(\d+)\s*(mo|month|y|year|w|week|d|day|h|hour|min|minute|m|s|second)s?\s+ago", re.I)
_REL_SECONDS = {"s": 1, "second": 1, "m": 60, "min": 60, "minute": 60, "h": 3600, "hour": 3600,
                "d": 86400, "day": 86400, "w": 7 * 86400, "week": 7 * 86400,
                "mo": 30 * 86400, "month": 30 * 86400, "y": 365 * 86400, "year": 365 * 86400}


def _relative_to_ts(text: str, now: float | None = None) -> int | None:
    """'5d ago' / '7mo ago' / '3 weeks ago' -> unix seconds (approximate)."""
    m = _REL.search(text or "")
    if not m:
        return None
    now = now if now is not None else time.time()
    return int(now - int(m.group(1)) * _REL_SECONDS[m.group(2).lower()])


# --- global side -----------------------------------------------------------

def x_build(kw: str) -> Call:
    return Call("x", "GET", "/twitter/tweet/advanced_search",
                {"query": f'"{kw}" -filter:replies', "queryType": "Top"})


def x_parse(p: dict) -> list[Item]:
    out = []
    for t in p.get("tweets") or []:
        m = {"likes": _int(t.get("likeCount")), "retweets": _int(t.get("retweetCount")),
             "replies": _int(t.get("replyCount")), "views": _int(t.get("viewCount"))}
        ts = None
        if t.get("createdAt"):
            try:
                ts = calendar.timegm(time.strptime(t["createdAt"], "%a %b %d %H:%M:%S +0000 %Y"))
            except ValueError:
                pass
        out.append(Item("x", GLOBAL, (t.get("text") or "")[:140], t.get("url", ""),
                        (t.get("author") or {}).get("userName", ""), ts, m,
                        m["likes"] + 2 * m["retweets"] + m["replies"] + m["views"] / 100))
    return out


def youtube_build(kw: str) -> Call:
    # sp=EgIIBA== is YouTube's "uploaded this month" filter; relevance search otherwise returns year-old hits
    return Call("youtube", "GET", "/youtube/search", {"engine": "youtube", "q": kw, "sp": "EgIIBA=="})


def youtube_parse(p: dict) -> list[Item]:
    out = []
    for v in p.get("videos") or []:
        views = _int(v.get("views"))
        out.append(Item("youtube", GLOBAL, v.get("title", ""), v.get("link", ""),
                        (v.get("channel") or {}).get("title", ""),
                        _relative_to_ts(v.get("published_time", "")), {"views": views}, views / 50))
    return out


def reddit_build(kw: str) -> Call:
    return Call("reddit", "GET", "/reddit/search", {"query": kw, "sort": "top", "timeframe": "month"})


def reddit_parse(p: dict) -> list[Item]:
    out = []
    for r in p.get("posts") or []:
        m = {"score": _int(r.get("score")), "comments": _int(r.get("num_comments"))}
        out.append(Item("reddit", GLOBAL, r.get("title", ""), r.get("url", ""),
                        r.get("subreddit", ""), _int(r.get("created_utc")) or None, m,
                        m["score"] + 2 * m["comments"]))
    return out


# --- China side ------------------------------------------------------------

def xhs_build(kw: str) -> Call:
    return Call("xiaohongshu", "GET", "/tikhub/xiaohongshu/app_v2/search_notes",
                {"keyword": kw, "sort_type": "popularity_descending"})


def xhs_parse(p: dict) -> list[Item]:
    out = []
    for it in ((p.get("data") or {}).get("data") or {}).get("items") or []:
        n = it.get("note")
        if not n:
            continue
        m = {"likes": _int(n.get("liked_count")), "collects": _int(n.get("collected_count")),
             "shares": _int(n.get("shared_count")), "comments": _int(n.get("comments_count"))}
        out.append(Item("xiaohongshu", CN, n.get("title") or (n.get("desc") or "")[:60],
                        f"https://www.xiaohongshu.com/explore/{n.get('id', '')}",
                        (n.get("user") or {}).get("nickname", ""), _int(n.get("timestamp")) or None, m,
                        m["likes"] + m["collects"] + 2 * m["shares"] + m["comments"]))
    return out


def douyin_build(kw: str) -> Call:
    return Call("douyin", "POST", "/tikhub/douyin/search/fetch_video_search_v5", body={"keyword": kw})


def douyin_parse(p: dict) -> list[Item]:
    out = []
    for it in (p.get("data") or {}).get("items") or []:
        a = it.get("aweme_info")
        if not a or not a.get("aweme_id"):
            continue
        s = a.get("statistics") or {}
        # play_count comes back as 0 from this endpoint, so heat uses interactions only
        m = {"likes": _int(s.get("digg_count")), "collects": _int(s.get("collect_count")),
             "shares": _int(s.get("share_count")), "comments": _int(s.get("comment_count"))}
        out.append(Item("douyin", CN, (a.get("desc") or "")[:140],
                        f"https://www.douyin.com/video/{a['aweme_id']}",
                        (a.get("author") or {}).get("nickname", ""), _int(a.get("create_time")) or None, m,
                        m["likes"] + m["collects"] + 2 * m["shares"] + m["comments"]))
    return out


def bilibili_build(kw: str) -> Call:
    return Call("bilibili", "GET", "/tikhub/bilibili/app/fetch_search_all", {"keyword": kw})


def bilibili_parse(p: dict) -> list[Item]:
    out = []
    for it in ((p.get("data") or {}).get("data") or {}).get("item") or []:
        if it.get("linktype") != "video" or not isinstance(it.get("av"), dict):
            continue
        av = it["av"]
        # search results carry plays only, no likes
        plays = _int(av.get("play"))
        out.append(Item("bilibili", CN, _strip_tags(av.get("title", "")),
                        f"https://www.bilibili.com/video/av{it.get('param', '')}",
                        av.get("author", ""), _int(av.get("ptime")) or None, {"plays": plays}, plays / 50))
    return out


SOURCES = {
    "x": Source("x", GLOBAL, "en", x_build, x_parse),
    "youtube": Source("youtube", GLOBAL, "en", youtube_build, youtube_parse),
    "reddit": Source("reddit", GLOBAL, "en", reddit_build, reddit_parse),
    "xiaohongshu": Source("xiaohongshu", CN, "zh", xhs_build, xhs_parse),
    "douyin": Source("douyin", CN, "zh", douyin_build, douyin_parse),
    "bilibili": Source("bilibili", CN, "zh", bilibili_build, bilibili_parse),
}
