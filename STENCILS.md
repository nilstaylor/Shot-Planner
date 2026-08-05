# Stencil folder

Blocking Board ships with a library of **514 stencils**. Unzip
`stencil-library.zip` into `public/` and every user gets the whole set, manifest
included. It comes from two sources:

| Source | Count | Tint |
| --- | --- | --- |
| Uploaded professional symbol set | 468 | `none`, full colour artwork |
| Drawn line art (furniture, architecture, fixtures, vehicles, exterior) | 46 | `light`, inverts on the dark plan |

Categories: Cameras, LED / HMI / Fluorescent / Tungsten fixtures, Rags, Frames &
Boards, Rolls & Cards, Support & Rigging, Rooms & Spaces, Labels, Misc, plus
Furniture, Architecture, Fixtures, Vehicles and Exterior.

Two scripts build it, and both are included so the library can be regenerated
or extended:

- `make-stencils.py` draws simple line art from a declarative catalog. Add an
  entry to `CATALOG` and rerun.
- `prep-stencils.py` prepares existing illustrated artwork: works out a real
  footprint, renames to the size convention, crops to the artwork, downsamples
  to 512 px, and writes the manifest with tint disabled.

```bash
python3 prep-stencils.py "Individual PNGs" public/stencils
```

Footprints come from the filename first ("18x24 White Silk", "4x4 Foam Core"),
then from a per category nominal size, then from a table of specific overrides
for items well off their category default (Briese heads, Molebeams, spacelights,
practicals). Whichever dimension is known becomes the longer side, and the
shorter side is scaled from the image's own aspect, so nothing is ever stretched.

The rest of this file covers adding your own artwork alongside the bundled set.

## Where files go

```
public/
  stencils/
    manifest.json          generated, do not edit by hand
    furniture/
      dining-table_6x3.png
      armchair_2.5x2.5.png
      sofa_7x3.png
    architecture/
      door-swing_3x3.png
      window_4x0.7.png
    lighting/
      1k-fresnel_1.5x1.5.png
      4x4-floppy_4x0.5.png
    vehicles/
      sedan_6x15.png
```

The subfolder name becomes the category heading in the picker. Add a folder, get a
new category. Nothing in the app needs editing.

## Filename convention

```
descriptive-name_WIDTHxDEPTH.png
```

`WIDTH` and `DEPTH` are the real world footprint in feet, measured as the object
sits on the floor seen from above. `sofa_7x3.png` places seven feet of sofa on the
plan, which is the whole point: if the footprint is honest, the shot sizes the app
computes are honest too.

Underscores and hyphens in the name become spaces, and the result is title cased,
so `dining-table_6x3.png` shows up as "Dining table".

A file with no size suffix still works. It lands at three by three feet and can be
resized on the plan. The build script lists these so you can spot them.

## Building the manifest

A browser cannot read a directory listing, so the folder has to be indexed once:

```bash
node build-stencils.mjs public/stencils
```

Run it after adding or renaming files. If your source drawings are metric:

```bash
node build-stencils.mjs public/stencils --units=m
```

That converts the suffixes to feet in the manifest and leaves your filenames alone.

If you are on Vite and would rather skip the script, replace the fetch in the app
with a glob and the manifest becomes unnecessary:

```js
const files = import.meta.glob("/public/stencils/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
```

You still need the filename convention, since that is where the footprint lives.

## Artwork guidelines

- **Top down, orthographic.** No perspective. The plan is a plan.
- **Black line art on transparency.** The app inverts it to white for the dark
  canvas. If a stencil is already colored, select it and switch Artwork to
  "Leave as drawn".
- **Fill the canvas.** Crop tight to the object's footprint, with no padding, or
  the object will read smaller on the plan than its stated dimensions.
- **Match the image aspect to the footprint.** The app stretches artwork to fill
  the declared footprint, so a 6 by 15 car should be rendered tall, not square,
  or it will look squashed. The bundled generator does this automatically: it
  sizes each canvas to 512 px on the long edge and scales the short edge to the
  footprint ratio.
- **Line weight around 5 px on the long edge of 512 px.** Thin lines vanish when a scene is zoomed
  out to fit a whole set.

SVG and WebP work too. The build script picks up `.png`, `.webp`, and `.svg`.

## Session imports

Students without access to your published folder can hit **Import PNGs** in the
Stencils tab and use their own files immediately. Those are held in the browser
session and embedded as data in any scene they save, so their scene files stay
openable but get larger. Anything from the published folder is stored as a path
instead, which keeps scene files small. That is the tradeoff to be aware of if you
ever collect scenes as homework: published stencils are the better default.
