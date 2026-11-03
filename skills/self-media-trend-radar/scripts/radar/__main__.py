"""CLI for overseas comparison mode: overseas_compare.py {quote,run,replay}"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import tomllib
from pathlib import Path

from .client import AisaClient, AisaError, BudgetExceeded
from .report import render
from .score import topic_gap
from .sources import SOURCES

EXAMPLE_CONFIG = Path(__file__).resolve().parent.parent / "topics.example.toml"


def load_config(path: Path) -> dict:
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    if not cfg.get("topics"):
        sys.exit(f"{path}: no [[topics]] defined")
    return cfg


def plan(cfg: dict, platforms: list[str]):
    """Yield (topic, source, keyword, call) for every request a run will make."""
    for t in cfg["topics"]:
        for p in platforms:
            src = SOURCES[p]
            for kw in t.get(src.lang, []):
                yield t["name"], src, kw, src.build(kw)


def _slug(s: str) -> str:
    return re.sub(r"[^\w一-鿿-]+", "_", s).strip("_")[:40]


def cmd_quote(args, cfg):
    client = AisaClient.from_env(budget_usd=args.budget)
    steps = list(plan(cfg, args.platforms))
    prices = client.quote([c for *_, c in steps])
    for (topic, src, kw, _), price in zip(steps, prices):
        print(f"{topic:24s} {src.platform:12s} {kw:24s} ${price:.4f}")
    total = sum(prices)
    print(f"\n{len(steps)} calls, estimated ${total:.4f} (budget ${args.budget:.2f})")


def build_report(raw: dict[tuple[str, str], list[dict]], cfg: dict, spent: float, date: str) -> str:
    window = cfg.get("window_days", 14)
    gaps = []
    for t in cfg["topics"]:
        items = []
        for (topic, platform), payloads in raw.items():
            if topic == t["name"]:
                for p in payloads:
                    items += SOURCES[platform].parse(p)
        gaps.append(topic_gap(t["name"], items, window))
    return render(gaps, window, spent, date)


def cmd_run(args, cfg):
    client = AisaClient.from_env(budget_usd=args.budget)
    date = time.strftime("%Y-%m-%d")
    raw_dir = Path(args.out) / "raw" / date
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw: dict[tuple[str, str], list[dict]] = {}
    for topic, src, kw, call in plan(cfg, args.platforms):
        try:
            payload = client.run(call)
        except BudgetExceeded as e:
            print(f"stop: {e}", file=sys.stderr)
            break
        except AisaError as e:
            print(f"skip: {e}", file=sys.stderr)
            continue
        raw.setdefault((topic, src.platform), []).append(payload)
        name = f"{_slug(topic)}__{src.platform}__{_slug(kw)}.json"
        (raw_dir / name).write_text(json.dumps(payload, ensure_ascii=False))
        print(f"ok  {topic} / {src.platform} / {kw}  (spent ${client.spent_usd:.4f})", file=sys.stderr)
    write_report(build_report(raw, cfg, client.spent_usd, date), Path(args.out), date)


def cmd_replay(args, cfg):
    """Rebuild a report from saved raw responses. Costs nothing."""
    raw_dir = Path(args.raw_dir)
    names = {_slug(t["name"]): t["name"] for t in cfg["topics"]}
    raw: dict[tuple[str, str], list[dict]] = {}
    for f in sorted(raw_dir.glob("*.json")):
        topic_slug, platform, _ = f.stem.split("__", 2)
        if topic_slug in names and platform in SOURCES:
            raw.setdefault((names[topic_slug], platform), []).append(json.loads(f.read_text()))
    write_report(build_report(raw, cfg, 0.0, raw_dir.name), Path(args.out), raw_dir.name)


def write_report(md: str, out_dir: Path, date: str):
    out = out_dir / "reports" / f"{date}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md)
    print(f"report: {out}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="overseas_compare.py",
                                 description="Compare topic heat on X/YouTube/Reddit vs Xiaohongshu/Douyin/Bilibili")
    ap.add_argument("--config", default="topics.toml",
                    help="topics file; falls back to the bundled topics.example.toml if missing")
    ap.add_argument("--out", default="overseas-compare", help="directory for raw responses and reports")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("quote", "run"):
        sp = sub.add_parser(name)
        sp.add_argument("--budget", type=float, default=None, help="USD cap for this run")
        sp.add_argument("--platforms", nargs="+", choices=list(SOURCES), default=list(SOURCES))
    rp = sub.add_parser("replay")
    rp.add_argument("raw_dir")
    args = ap.parse_args(argv)
    config = Path(args.config)
    if not config.exists() and args.config == "topics.toml":
        config = EXAMPLE_CONFIG
    cfg = load_config(config)
    if getattr(args, "budget", None) is None and args.cmd != "replay":
        args.budget = cfg.get("budget_usd", 0.5)
    try:
        {"quote": cmd_quote, "run": cmd_run, "replay": cmd_replay}[args.cmd](args, cfg)
    except AisaError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
