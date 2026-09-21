#!/usr/bin/env python3
"""Build assets/search-index.json from the site's own HTML.

One entry per section, so a search result points at the part of the page that
answers it rather than at the top of a long page. Run this after editing any
page:  python3 tools/build-search-index.py
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_TAGS = {"script", "style", "svg", "noscript"}
SKIP_CLASSES = {"soundings", "masthead", "site-foot", "search-dialog", "skip", "crumb", "video-meta"}
SKIP_FILES = {"404.html", "search.html"}


class Reader(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth_skip = 0
        self.skip_stack: list[str] = []
        self.in_main = False
        self.sections: list[dict] = []
        self.current = {"anchor": "", "heading": "", "text": []}
        self.in_heading = False
        self.page_title = ""
        self.in_h1 = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "main":
            self.in_main = True
        if tag in SKIP_TAGS:
            self.depth_skip += 1
            return
        classes = set((attrs.get("class") or "").split())
        if self.skip_stack:
            self.skip_stack.append(tag)
            return
        if classes & SKIP_CLASSES or attrs.get("id") in {"site-nav", "search-dialog"}:
            self.skip_stack.append(tag)
            return
        if self.depth_skip or not self.in_main:
            return
        if attrs.get("id") and tag in {"section", "div", "article"}:
            self.flush()
            self.current = {"anchor": attrs["id"], "heading": "", "text": []}
        if tag in {"h2", "h3"}:
            self.in_heading = True
        if tag == "h1":
            self.in_h1 = True

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self.depth_skip = max(0, self.depth_skip - 1)
            return
        if self.skip_stack:
            self.skip_stack.pop()
            return
        if tag in {"h2", "h3"}:
            self.in_heading = False
        if tag == "h1":
            self.in_h1 = False

    def handle_data(self, data):
        if self.depth_skip or self.skip_stack or not self.in_main:
            return
        text = data.strip()
        if not text:
            return
        if self.in_h1 and not self.page_title:
            self.page_title = text
        if self.in_heading and not self.current["heading"]:
            self.current["heading"] = text
        self.current["text"].append(text)

    def flush(self) -> None:
        body = " ".join(self.current["text"]).strip()
        if len(body) > 40:
            self.sections.append({
                "anchor": self.current["anchor"],
                "heading": self.current["heading"],
                "text": re.sub(r"\s+", " ", body),
            })
        self.current = {"anchor": "", "heading": "", "text": []}


def main() -> None:
    entries = []
    for path in sorted(ROOT.glob("*.html")):
        if path.name in SKIP_FILES:
            continue
        reader = Reader()
        reader.feed(path.read_text())
        reader.flush()
        title = reader.page_title or path.stem
        for section in reader.sections:
            entries.append({
                "t": section["heading"] or title,
                "s": title,
                "u": path.name + (f"#{section['anchor']}" if section["anchor"] else ""),
                "x": section["text"][:1800],
            })
    out = ROOT / "assets" / "search-index.json"
    out.write_text(json.dumps(entries, separators=(",", ":")))
    print(f"{len(entries)} sections indexed into {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
