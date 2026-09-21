#!/usr/bin/env python3
"""Check that every local link, image, video and stylesheet on the site resolves.

Run before pushing:  python3 tools/check-links.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urldefrag

ROOT = Path(__file__).resolve().parent.parent
ATTR = re.compile(r'(?:href|src)="([^"]+)"')
ANCHOR = re.compile(r'id="([^"]+)"')


def main() -> int:
    problems: list[str] = []
    anchors: dict[str, set[str]] = {}
    pages = sorted(ROOT.glob("*.html"))
    for page in pages:
        anchors[page.name] = set(ANCHOR.findall(page.read_text()))

    for page in pages:
        text = page.read_text()
        for raw in ATTR.findall(text):
            if raw.startswith(("http://", "https://", "mailto:", "data:", "#")):
                if raw.startswith("#") and raw[1:] not in anchors[page.name]:
                    problems.append(f"{page.name}: missing anchor {raw}")
                continue
            target, fragment = urldefrag(raw)
            path = (ROOT / target).resolve()
            if target.endswith("/"):
                path = path / "index.html"
            if not path.exists():
                problems.append(f"{page.name}: missing file {target}")
                continue
            if fragment and path.name.endswith(".html") and path.parent == ROOT:
                if fragment not in anchors.get(path.name, set()):
                    problems.append(f"{page.name}: missing anchor {target}#{fragment}")

    for problem in problems:
        print(problem)
    print(f"{len(pages)} pages checked, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
