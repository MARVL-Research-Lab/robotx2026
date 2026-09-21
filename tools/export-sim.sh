#!/usr/bin/env bash
# Export the ground station's Babylon.js scenes as a static site under sim/.
#
# The visualizer normally runs behind `robotx viz`, which serves the course
# layout and the readiness configuration from the Python package. Everything
# else is already static, so the export copies the scene, writes those two
# responses to disk as JSON, and rewrites the three paths that point at the
# server.
#
# Usage: tools/export-sim.sh [path-to-robotx-repo]
set -euo pipefail

SRC="${1:-$(cd "$(dirname "$0")/../../robotx" && pwd)}"
DST="$(cd "$(dirname "$0")/.." && pwd)/sim"
STATIC="$SRC/src/robotx/viz/static"

[ -d "$STATIC" ] || { echo "no visualizer at $STATIC" >&2; exit 1; }

rm -rf "$DST"
mkdir -p "$DST/api"
cp -r "$STATIC/." "$DST/"

( cd "$SRC" && uv run python - "$DST" <<'PY'
import json, sys
from pathlib import Path
from robotx.viz import course, readiness

out = Path(sys.argv[1]) / "api"
layout = course.config()
layout["live"] = {"enabled": False, "source": None}
(out / "course.json").write_text(json.dumps(layout))
(out / "readiness.json").write_text(json.dumps(readiness.config()))
PY
)

# Server paths to relative ones.
find "$DST" -name '*.html' -exec sed -i 's|"/static/|"./|g' {} +
sed -i 's|href="/"|href="./index.html"|' "$DST/readiness.html"
sed -i 's|fetch("/api/course")|fetch("./api/course.json")|' "$DST/js/main.js"
sed -i 's|fetch("/api/readiness")|fetch("./api/readiness.json")|' "$DST/js/por-main.js"

# The checklist download is rendered server side. Rebuild it in the browser
# from the same configuration the page already holds.
python3 - "$DST" <<'PY'
import re, sys
from pathlib import Path

root = Path(sys.argv[1])
js = root / "js" / "por-main.js"
text = js.read_text()
old = re.search(
    r'  async function buildReport\(\) \{.*?\n  \}\n', text, re.S)
if not old:
    raise SystemExit("buildReport not found; export needs updating")
new = '''  async function buildReport() {
    // Static export: the server renders this markdown from the same data, and
    // the page already has the configuration, so build it here instead.
    const rehearsed = r => r.criteria.length > 0 &&
      r.criteria.every(c => (state.results[c] || {}).passed);
    const held = r => !rehearsed(r) && !!evidence[r.id];
    const reqs = cfg.requirements;
    const lines = [
      "# RobotX 2026 Proof of Readiness",
      "",
      "Mandatory window (USV plus one domain): " + cfg.windows.mandatory +
        ". Optional third system: " + cfg.windows.third_system + ".",
      "",
      "Rehearsed items were flown in the RobotX visualizer against the handbook " +
        "3.1 course specifications. They are evidence that the run planned would " +
        "pass, not a substitute for the video.",
      "",
      reqs.filter(r => rehearsed(r) || held(r)).length + " of " + reqs.length +
        " requirements accounted for: " + reqs.filter(rehearsed).length +
        " rehearsed, " + reqs.filter(held).length + " held as evidence.",
      "",
    ];
    for (const domain of cfg.domains) {
      const items = reqs.filter(r => r.domain === domain);
      if (!items.length) continue;
      lines.push("## " + domain, "",
        "| Section | Requirement | Evidence | Status |", "| --- | --- | --- | --- |");
      for (const r of items) {
        const status = rehearsed(r) ? "PASS (rehearsed)"
          : held(r) ? "held" : "to be produced";
        lines.push("| " + r.section + " | " + r.title + " | " + r.kind + " | " + status + " |");
      }
      lines.push("");
    }
    return lines.join("\\n");
  }
'''
js.write_text(text.replace(old.group(0), new))
PY

echo "exported to $DST"
