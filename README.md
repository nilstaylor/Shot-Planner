# Blocking Board

A top down camera blocking tool for directors. Lay out a scene on a scaled floor
plan, place cameras that stay locked to the actors they cover, and get a slated
shot list that writes itself.

## What it does

- **Scaled floor plan.** Everything is measured in feet against a one foot grid.
  Drag actors and set pieces, rotate them, resize them.
- **Cameras that follow.** Lock a camera to an actor and it travels with that
  actor as the blocking changes, keeping its angle and its coverage.
- **A shot list that computes itself.** Shot size comes out of the geometry
  rather than being typed: frame height equals distance times sensor height
  divided by focal length, measured against the subject's own height. Angle
  comes from the actor's facing, and lens height gives high, eye level, or low.
- **Standard slating.** The first setup carries the bare scene number and each
  new setup takes the next letter, skipping I and O, doubling to AA after Z. A
  second camera on the same setup shares the slate and is marked by camera
  letter. Reordering the list renumbers the setups, because the letter records
  shooting order.
- **180 line.** Toggle it on and it tracks the two actors carrying the
  relationship, reassigning itself if the blocking changes who is playing to
  whom. Cameras on the wrong side are flagged in the list.
- **514 stencils** across cameras, lighting, grip, rags, frames, rooms,
  furniture, architecture, vehicles and exterior.
- **Print or export.** A landscape shot list ready to save as PDF, a CSV, and a
  scene file that saves and reopens.

## Running it

Requires Node 18 or newer.

```bash
npm install
npm run dev
```

Then open the URL Vite prints. To make a production build:

```bash
npm run build
npm run preview
```

## Publishing privately

Create a new **private** repository on github.com, leaving it empty, then:

```bash
git init
git add .
git commit -m "Blocking Board, first working version"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/blocking-board.git
git push -u origin main
```

Note that GitHub Pages serves a repository publicly even when the repository
itself is private, so if the stencil artwork should stay in house, deploy
somewhere access controlled or hand the built `dist/` folder out directly rather
than enabling Pages.

## Stencils

See `STENCILS.md`. In short: `public/stencils/` holds the artwork, one subfolder
per category, with each filename carrying its real footprint in feet
(`sofa_7x3.png`). `manifest.json` indexes it, since a browser cannot read a
directory listing. Add art and regenerate:

```bash
npm run stencils
```

The `tools/` folder holds the three scripts: `make-stencils.py` draws simple line
art from a declarative catalog, `prep-stencils.py` prepares existing illustrated
artwork and works out footprints, and `build-stencils.mjs` indexes a folder into
a manifest.

The professional symbol artwork in this repository is licensed material held for
the owner's own professional and teaching use. It is not for redistribution.

## Layout

```
index.html
src/
  main.jsx            entry point
  BlockingBoard.jsx   the whole app
  index.css           Tailwind entry
public/
  stencils/           artwork plus manifest.json
tools/                stencil build scripts
```

## Not built yet

Undo and redo, importing a production floor plan as a scaled background, and
multiple scenes per file. There is deliberately no animation timeline.
