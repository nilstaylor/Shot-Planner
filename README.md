# Shot Planner

Shot Planner is an overhead camera blocking and shot-list planning tool for film directors. It combines a scaled floor plan, draggable performers and set pieces, camera placement, field-of-view guides, screen-direction checks, and a production-ready shot list in one workspace.

**Live app:** https://nilstaylor.github.io/Shot-Planner/

## Features

- One-foot floor-plan grid with pan and zoom
- Integrated Set Designer with point-to-point wall chains, editable vertices, midpoint translation, and midpoint extrusion
- Grid, node, wall-line, and 45° / 90° architectural angle snapping for fast, connected floor plans
- Solid, outlined, or translucent wall treatments that remain readable beneath blocking and FOV guides
- Smart hosted doors, windows, and pass-throughs that cut their aperture automatically, slide along a wall, and stay attached as walls change
- Door swing and hinge controls, resizable openings, and blueprint/location-photo underlays for trace-over workflows
- Draggable, rotatable performers, cameras, and set pieces
- Step-by-step undo with `Cmd+Z` or `Ctrl+Z`
- Per-camera shot color and field-of-view controls
- Cinematography Layer System with Director and Cinematography modes, per-object visibility/lock controls, and ghost or hard-hide staging passes
- Backward-compatible scene migration: legacy JSON projects load their existing objects into the Director layer automatically
- Context-aware stencil palette with camera rigs, lighting, grip, dolly-track, diffusion, and truss assets exposed in Cinematography mode
- Lens, sensor, height, movement, support, subject, and optional user-entered planning-minute controls
- Automatic shot-size and camera-angle descriptions
- Generic male/female performer representations and dimensional set-object proxies
- Optional 180-degree line and crossed-line warnings
- 500+ scaled production stencils
- Scene save/open using JSON
- Shot-list export to CSV
- Printable landscape shot list for PDF export
- Responsive desktop, tablet, and mobile layouts

## Requirements

- Node.js 20.9 or newer
- npm

## Local development

```bash
npm install
npm run dev
```

Open the local address shown in the terminal.

## Production build

Shot Planner is a fully client-side app that builds to a static site:

```bash
npm run build
```

The static site is written to `out/`. Preview it with any static file server, for example:

```bash
npx serve out
```

## Deployment

Every push to `main` is built and published to GitHub Pages by
`.github/workflows/deploy.yml`.

The app is hosted from the `/Shot-Planner/` project subpath, so the build reads
`NEXT_PUBLIC_BASE_PATH` and sets `basePath` accordingly. The workflow supplies
this value automatically from the Pages configuration. A local build with no
`NEXT_PUBLIC_BASE_PATH` set is served from the site root.

## Tests

```bash
npm run build
npm test
```

## Project structure

- `app/BlockingBoard.jsx` — main application and interaction logic
- `app/layerSystem.js` — layer migration, render-policy, and stencil-availability rules
- `app/page.tsx` — application entry page
- `app/layout.tsx` — document shell, fonts, and metadata
- `app/globals.css` — global styles
- `public/stencils/` — scaled production stencil artwork and `manifest.json`
- `tests/` — static-export smoke test
- `.github/workflows/deploy.yml` — GitHub Pages build and deploy

## Tech stack

Next.js 16 App Router (static export), React 19, Tailwind CSS 4, TypeScript.
