# Website handoff

State as of 22 September 2026. The site is live at
<https://marvl-research-lab.github.io/robotx2026/>, served by GitHub Pages from `main`
at the repository root.

**The design documentation deadline is 23 September 2026.** Everything below that is
marked "open" is content the team has to supply, not engineering work.

---

## 1. Where things stand

| Item | State |
| --- | --- |
| Pages written | 13, all linked from the header or the footer |
| GitHub Pages | Enabled, serving from `main` at `/` |
| Simulator on the live site | Working, both the mission view and the readiness rehearsal |
| Search | Working, 64 indexed sections, overlay and standalone page |
| Accessibility | axe-core clean on all 13 pages at serious and critical level |
| Link check | `tools/check-links.py` reports 0 problems |
| Media | 16 videos (53 MB), 41 images (4.2 MB) |
| Repository size | 66 MB working tree, 126 MB with history |
| Open content items | 4, each marked in the page with an "Editor note" block |

Verified on the live site: `/`, `/sim/`, `/sim/readiness.html`, `/sim/api/course.json`,
`/assets/search-index.json`, video delivery, `/readiness.html`, `/404.html`, and a search
query returning correct results.

## 2. What is on each page

| Page | Carries |
| --- | --- |
| `index.html` | Hero with a looping simulator clip, the four tasks, the three vehicles, the console, evidence links, sponsors |
| `team.html` | Lab and university, team structure, roster scaffold, sponsors, contact |
| `vehicles.html` | Comparison table and the reasoning behind the three platform choices |
| `usv.html` | BlueBoat: platform, safety table against handbook 5.2, driving, perception, the autonomous run video |
| `uuv.html` | BlueROV2: the no-position design decision, the two command paths, survey and repair, safety, rehearsal video |
| `uav.html` | Quadrotor: airframe, batteries, control links, failsafe table, payload, six flight videos |
| `autonomy.html` | Architecture diagram, three state machines, checkpointing, health, console layout, RoboCommand, design decisions |
| `simulation.html` | The embedded simulator, four simulation layers, software in the loop, the course model, validation, what is real |
| `testing.html` | Software suite by area, simulated missions, hardware sessions, what testing changed, what is planned |
| `readiness.html` | The four handbook 3.1 packages, evidence, the eight step run start walkthrough, the embedded rehearsal |
| `log.html` | Six dated build log entries taken from the ground station repository history |
| `search.html`, `404.html` | Search results page and a not found page that lists the site |

## 3. How it is built

No build step and no dependencies. Pages are hand-written HTML sharing one stylesheet
and one script. The header, navigation and footer are repeated in every page, so a
navigation change touches all 13 files.

Three scripts in `tools/`:

```bash
python3 tools/build-search-index.py    # rebuild assets/search-index.json after any text edit
python3 tools/check-links.py           # every local href, src and anchor resolves
tools/export-sim.sh ../robotx          # re-export the course simulator into sim/
```

Serve locally with `python3 -m http.server 8000`.

### The simulator in `sim/`

`sim/` is a static export of the Babylon scene from the ground station repository at
`../robotx`. The export copies `src/robotx/viz/static/`, writes the two API responses to
`sim/api/course.json` and `sim/api/readiness.json`, rewrites the three paths that pointed
at the Python server, and replaces the server-rendered checklist download with a browser
side version. Re-run `tools/export-sim.sh` after any change to the scene, the course
layout or the readiness data. It needs `uv` and the ground station checkout.

### Media

Video is H.264 in MP4 scaled to 1280 wide, each with a poster frame so nothing downloads
until a visitor presses play. The recipe is in `README.md`. Field footage comes from
`../robotx/helpful/por_uploads/`; the simulator clips were recorded from the scene itself.

`assets/video/sim-por-comms.mp4` is recorded and unused. It shows the communications run
start drawn as a message ladder and could go on `readiness.html` beside the eight step
table if that section needs more weight.

## 4. Open content items

In priority order. Each one is marked in the page with a visible "Editor note" block that
has to be deleted once the content is in.

1. **Roster, `team.html`.** Eight role cards with "Add name" in place of members. The
   rubric names a list of team members under the 20 percent team information weight.
2. **Contact address, `team.html`.** The page currently shows `marvl-robotx@sutd.edu.sg`,
   which was a placeholder, not a confirmed mailbox. It is the only address on the site.
3. **Field session hours, `testing.html`.** The hardware table carries objectives, results
   and evidence but not dates or hours. The rubric asks for time in the field by name
   (water time, air time), so this is worth an hour of somebody's evening.
4. **Underwater vehicle media, `uuv.html` and `readiness.html`.** No photographs of the
   ROV exist in either repository. Both pages currently lean on simulator renders. The
   submitted 3.1.3 run video and the safety photographs should go in.
5. **Sponsor marks, `assets/img/logo-*.svg`.** Typographic placeholders set in the site's
   own type. Replace with the official files from SUTD, MARVL and Blue Robotics, keeping
   the same filenames and roughly the same aspect.

## 5. Claims on the site that a person should confirm

Most content is sourced from the ground station repository, the handbook or the readiness
paperwork. These specific statements were written from indirect evidence and should be
read by somebody who was there:

- `usv.html` safety table: the wireless stop acting within two seconds, and the mast light
  being readable at 100 m. Both are handbook requirements that the readiness package
  answers; the wording on the site asserts compliance.
- `usv.html`: the BlueBoat described as a 1.2 m catamaran, taken from the visualizer's
  vehicle model rather than from a measurement.
- `uuv.html` safety list: tether length, the 80 m status light and the beacon mounting,
  written from the handbook requirements and the hardware notes.
- `readiness.html`: all four packages shown as submitted. The repository holds the USV,
  UAV and communications uploads; the UUV folder is empty, and the submitted state comes
  from what you told me on 21 September.
- `index.html` and `testing.html`: the Advanced tier target. The declaration sent on the
  day has to match what the team actually attempts, so this wording may need softening if
  the plan changes.

## 6. Known rough edges

- `assets/video/uav-manual-flight.mp4` is 17 MB for 2 minutes 15 seconds, the heaviest
  file on the site. It only downloads when a visitor presses play. Re-encoding at a
  higher constant rate factor would roughly halve it.
- The git history now holds 60 MB of media objects. Replacing a video later adds its full
  size again. If that becomes a problem, Git LFS or a fresh orphan branch are the options.
- The sounding rule page index is hidden below 950 px, so on a phone long pages are read
  by scrolling. This was deliberate, and worth revisiting only if it comes up in feedback.

## 7. Before each push

```bash
python3 tools/build-search-index.py
python3 tools/check-links.py
python3 -m http.server 8000   # then read the pages you changed
git add -A && git commit && git push
```

Pages redeploys within a minute or two of a push. Hard refresh, because the video and
image files are cached aggressively.

## 8. Two upstream defects found while building this

Both live in the ground station repository at `../robotx`, not in the website, and both
are referenced honestly on `testing.html`:

1. `src/robotx/orchestrator/orchestrator.py:562` and the moving object handler below it
   call `t4_sm.advance_step("STEP", "NEXT", 20.0)`, but
   `TaskStateMachine.advance_step(self, step, next_hint=None)` accepts two arguments.
   Task 4 Advanced and Disruptive both raise a `TypeError` at the first step. Core works
   because it passes `next_hint` as a keyword.
2. `robotx validate` scored 24 of 25 on the run of 21 September 2026. The failure is
   `usv_navigation_waypoints`, a guided waypoint that does not report arrival inside its
   window after the vehicle has been through an interruption. The mission still completes.

## 9. If there is time after the content is in

- A team introduction video is a separate 120 point deliverable with the same deadline. If
  one gets made, `index.html` and `team.html` both have an obvious place for it, and
  hosting it on the site satisfies the hosting rule in 2.3.
- The technical design report, once submitted, could be linked from `readiness.html` or
  the footer as a PDF.
- A short caption pass over the simulator clips, naming what a judge is looking at second
  by second, would make them easier to read without sound.
