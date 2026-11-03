import calendar
import unittest

from radar.score import topic_gap
from radar.sources import SOURCES, _relative_to_ts

NOW = 1_800_000_000
DAY = 86400

# Synthetic payloads shaped like the real AIsa responses (fields trimmed).
PAYLOADS = {
    "x": {"tweets": [{"text": "hot take", "url": "https://x.com/a/status/1", "likeCount": 20000,
                      "retweetCount": 900, "replyCount": 900, "viewCount": 2_000_000,
                      "createdAt": "Wed Oct 14 19:01:14 +0000 2026", "author": {"userName": "a"}}]},
    "youtube": {"videos": [{"title": "demo", "link": "https://youtu.be/x", "views": "100000",
                            "published_time": "5d ago", "channel": {"title": "c"}}]},
    "reddit": {"posts": [{"title": "news", "url": "https://reddit.com/r/x/1", "score": 14000,
                          "num_comments": 1600, "created_utc": NOW - 2 * DAY, "subreddit": "technology"}]},
    "xiaohongshu": {"data": {"data": {"items": [{"model_type": "note", "note": {
        "id": "abc", "title": "教程", "liked_count": 300, "collected_count": 200, "shared_count": 10,
        "comments_count": 5, "timestamp": NOW - 1 * DAY, "user": {"nickname": "u"}}}]}}},
    "douyin": {"data": {"items": [{"aweme_info": {"aweme_id": "76", "desc": "教程", "create_time": NOW - DAY,
                                                  "statistics": {"digg_count": 100, "collect_count": 50,
                                                                 "share_count": 5, "comment_count": 3,
                                                                 "play_count": 0}, "author": {"nickname": "d"}}},
                                  {"type": 999}]}},
    "bilibili": {"data": {"data": {"item": [
        {"linktype": "video", "param": "1175", "av": {"title": '<em class="keyword">Claude</em> Code', "play": "1454",
                                                       "ptime": str(NOW - DAY), "author": "b"}},
        {"linktype": "collection_card"}]}}},
}


class ParseTest(unittest.TestCase):
    def test_every_platform_parses_one_item(self):
        for name, payload in PAYLOADS.items():
            items = SOURCES[name].parse(payload)
            self.assertEqual(len(items), 1, name)
            self.assertGreater(items[0].engagement, 0, name)
            self.assertTrue(items[0].url.startswith("https://"), name)

    def test_bilibili_title_tags_stripped(self):
        self.assertEqual(SOURCES["bilibili"].parse(PAYLOADS["bilibili"])[0].title, "Claude Code")

    def test_x_time_is_utc(self):
        self.assertEqual(SOURCES["x"].parse(PAYLOADS["x"])[0].published_at, calendar.timegm((2026, 10, 14, 19, 1, 14)))

    def test_relative_time(self):
        self.assertEqual(_relative_to_ts("5d ago", now=NOW), NOW - 5 * DAY)
        self.assertEqual(_relative_to_ts("3 weeks ago", now=NOW), NOW - 21 * DAY)
        self.assertEqual(_relative_to_ts("7mo ago", now=NOW), NOW - 210 * DAY)
        self.assertEqual(_relative_to_ts("1y ago", now=NOW), NOW - 365 * DAY)
        self.assertEqual(_relative_to_ts("4w ago", now=NOW), NOW - 28 * DAY)
        self.assertIsNone(_relative_to_ts("Streamed live", now=NOW))


class GapTest(unittest.TestCase):
    def items(self, *platforms):
        return [i for p in platforms for i in SOURCES[p].parse(PAYLOADS[p])]

    def test_global_hot_cn_cold(self):
        g = topic_gap("t", self.items("x", "reddit", "xiaohongshu"), window_days=14, now=NOW)
        self.assertGreater(g.gap, 0)
        self.assertGreater(g.global_side.heat, g.cn_side.heat)

    def test_stale_items_drop_out(self):
        g = topic_gap("t", self.items("reddit"), window_days=1, now=NOW)
        self.assertEqual(g.global_side.fresh_count, 0)
        self.assertEqual(g.verdict, "两边都冷")


if __name__ == "__main__":
    unittest.main()
