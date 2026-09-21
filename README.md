# MARVL at Maritime RobotX 2026

The team website for MARVL, the Multi-Agent Robotics Vision and Learning Lab at the
Singapore University of Technology and Design, for the 2026 Maritime RobotX Challenge.
It is the submission for handbook section 2.2, and it is a plain static site: no build
step, no framework, no dependencies to install.

Live at <https://marvl-research-lab.github.io/robotx2026/>.

## Layout

```
index.html          home
team.html           team, structure, roster, sponsors, contact
vehicles.html       the three platforms side by side
usv.html            BlueBoat
uuv.html            BlueROV2
uav.html            the lab-built quadrotor
autonomy.html       the ground station: state machines, checkpoints, RoboCommand
simulation.html     software in the loop, the HaLow emulator, the course model
testing.html        software, simulated and hardware test record
readiness.html      the handbook 3.1 submissions and their evidence
log.html            build log
search.html         search results page
404.html            not found

assets/css          one stylesheet
assets/js           navigation, search, the embedded simulator
assets/img          photographs, diagrams, video posters, sponsor marks
assets/video        field footage and simulator clips, H.264 for the web
assets/search-index.json   generated, see below

sim/                the course simulator, exported from the ground station repository
tools/              the three maintenance scripts
```

## Working on it

Serve the directory and open it. Any static server will do:

```bash
python3 -m http.server 8000
```

Pages are hand-written HTML. The header, navigation and footer are repeated in each
page, so a navigation change touches every file. That is the cost of having no build
step, and it is deliberate: the site keeps working whoever picks it up.

After editing any page, rebuild the search index and check the links:

```bash
python3 tools/build-search-index.py    # writes assets/search-index.json
python3 tools/check-links.py           # every local href and src resolves
```

## The embedded simulator

`sim/` is a static export of the course visualizer from the ground station repository.
The visualizer normally runs behind `robotx viz`, which serves the course layout and the
readiness configuration from Python. The export writes those two responses to disk as
JSON and rewrites the paths that pointed at the server, so the scene runs from any static
host, including this one.

Re-export it after a change to the scene, the course or the readiness data:

```bash
tools/export-sim.sh /path/to/robotx     # defaults to ../robotx
```

The export needs `uv` and the ground station repository, because it runs the course and
readiness modules to produce `sim/api/course.json` and `sim/api/readiness.json`.

## Media

Video is H.264 in MP4, scaled to 1280 wide, with a poster frame for each clip so nothing
downloads until a visitor presses play. Source footage lives in the ground station
repository under `helpful/por_uploads/`. To add a clip:

```bash
ffmpeg -i source.mp4 -vf "scale='min(1280,iw)':-2" -c:v libx264 -crf 28 -preset slow \
  -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart assets/video/name.mp4
ffmpeg -ss 1 -i assets/video/name.mp4 -frames:v 1 -vf scale=960:-2 -q:v 4 \
  assets/img/name-poster.jpg
```

## Deployment

GitHub Pages, from the default branch at the repository root. In the repository settings,
under Pages, set the source to "Deploy from a branch", branch `main`, folder `/ (root)`.
`.nojekyll` is present so that the site is served as it is rather than through Jekyll.

## Before the submission deadline

Four things are marked in the pages themselves with an editor note:

1. `team.html` roster: replace the role cards with member names, programmes and years.
2. `team.html` contact: confirm the team mailbox.
3. `testing.html` field sessions: add dates and hours in the water and in the air, which
   the website rubric asks for by name.
4. `readiness.html` and `uuv.html`: add the underwater vehicle's own photographs and its
   submitted run video.

Sponsor marks in `assets/img/logo-*.svg` are typographic placeholders. Replace them with
the official files.
