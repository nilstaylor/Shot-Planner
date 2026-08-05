# Shot Planner

Shot Planner is a top-down camera blocking and shot-planning tool for film directors. It combines a scaled floor plan, draggable performers and set pieces, camera placement, field-of-view guides, screen-direction checks, and a computed shot list in one workspace.

**Live app:** https://nilstaylor.github.io/Shot-Planner/

## Features

- One-foot floor-plan grid with pan and zoom
- Draggable, rotatable performers, cameras, and set pieces
- Step-by-step undo with `Cmd+Z` or `Ctrl+Z`
- Per-camera shot color and field-of-view controls
- Lens, sensor, height, movement, support, subject, and timing controls
- Automatic shot-size and camera-angle descriptions
- Optional 180-degree line and crossed-line warnings
- 500+ scaled production stencils
- Scene save/open using JSON
- Shot-list export to CSV
- Printable landscape shot list
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
- `app/page.tsx` — application entry page
- `app/layout.tsx` — document shell, fonts, and metadata
- `app/globals.css` — global styles
- `public/stencils/` — scaled production stencil artwork and `manifest.json`
- `tests/` — static-export smoke test
- `.github/workflows/deploy.yml` — GitHub Pages build and deploy

## Tech stack

Next.js 16 App Router (static export), React 19, Tailwind CSS 4, TypeScript.
