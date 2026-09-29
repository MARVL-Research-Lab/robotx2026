# MARVL at Maritime RobotX 2026

The team website for MARVL, the Multi-Agent Robotics Vision and Learning Lab at the
Singapore University of Technology and Design, for the 2026 Maritime RobotX Challenge.
It is the submission for handbook section 2.2, and it is a plain static site: no build
step, no framework, no dependencies to install.

Live at <https://robotx.marvl.ai/>, with
<https://marvl-research-lab.github.io/robotx2026/> as the GitHub Pages address that
redirects there once the custom domain is set.

## Custom domain

The site is served by GitHub Pages from `main`. To put it on `robotx.marvl.ai`:

1. In the DNS for marvl.ai, add `robotx.marvl.ai. CNAME marvl-research-lab.github.io.`
   If the zone is on Cloudflare, leave the record unproxied until the certificate is
   issued.
2. In the repository settings under Pages, enter `robotx.marvl.ai` as the custom domain
   and save. GitHub commits a `CNAME` file to the root of `main`; keep it, because
   removing it drops the domain on the next deploy. Once the DNS check passes, tick
   "Enforce HTTPS".
3. In the organisation settings under Pages, add `robotx.marvl.ai` as a verified domain
   so nobody else can claim it.

Do not add the `CNAME` file by hand before the DNS record exists. Pages starts
redirecting the github.io address to the custom domain as soon as the file is present,
and until the record resolves that redirect leads nowhere. After the switch the github.io
address keeps working as a redirect for as long as the custom domain stays configured.

Every link and asset path on the site is relative, so nothing else changes. The sitemap
and robots file already carry the new address.

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

The hero on the home page plays `assets/video/hero-field-loop.mp4`, a 33 second muted
loop cut from the field footage: the BlueBoat pool run (`USV/Autonomous_Operations.mp4`,
5 to 17 s, cropped to the pool), then two flights from `UAV/UAV_System_Video.mp4` (380 to
392 s and 427 to 438 s), joined with one second crossfades and encoded at CRF 30 with no
audio. Recut it the same way if better footage arrives; keep it under about 3 MB, because
it downloads on every visit to the home page.

The favicon (`assets/img/favicon.svg`) draws the quadrotor, the BlueBoat and the ROV
with SMIL animation, which Firefox plays directly. Chromium based browsers draw favicons
once, so `assets/js/site.js` fetches the same file, strips the animations and cycles
eight frames as data URIs. Safari ignores SVG favicons, so every page also links
`favicon-32.png` and `apple-touch-icon.png`, both rendered from the SVG with Inkscape
(the touch icon from a copy with square corners, because iOS rounds them itself).
After changing the icon, re-render both PNGs and bump the `?v=` query on the SVG link
in every page so cached copies are refreshed.

The team introduction video is a YouTube embed (`UOy6zErhNPo`) on `index.html` and
`team.html`. It starts muted and loops; the reduced motion guard in `assets/js/site.js`
turns the autoplay off for visitors who ask for less motion.

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
