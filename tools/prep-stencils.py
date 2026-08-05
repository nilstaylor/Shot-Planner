#!/usr/bin/env python3
"""
prep-stencils.py

Prepares a folder of ready made symbol artwork for Blocking Board.

Unlike make-stencils.py, which draws simple line art from scratch, this takes
existing illustrated PNGs and does four things to them:

  1. Works out a real world footprint for each symbol, in feet.
  2. Renames files into the slug_WIDTHxDEPTH.png convention.
  3. Downsamples anything oversized so the whole library stays web sized.
  4. Writes a manifest with tint set to "none", because full color artwork
     must not be inverted the way black line art is.

Footprints come from three places, in order of trust:

  - The filename, when the symbol names its own size. Grip gear usually does:
    "18x24 White Silk", "4x4 Foam Core", "10_ x 10_ Corner Room".
  - CATEGORY_FEET below, a nominal long edge per category, for fixtures and
    hardware whose names carry no dimension.
  - SPECIFIC_FEET, for individual items whose real size is well off their
    category default.

Whichever dimension is known becomes the longer side of the footprint, and the
shorter side is scaled from the image's own aspect ratio, so nothing is ever
stretched out of proportion on the plan.

    python3 prep-stencils.py SOURCE_DIR OUTPUT_DIR
"""

import json
import os
import re
import sys
import unicodedata
from PIL import Image

LONG_EDGE = 512  # cap on the finished PNG's longer side

# Nominal long edge in feet, by source folder name.
CATEGORY_FEET = {
    "Cameras": 2.2,
    "Fluorescent Fixtures": 4.0,
    "HMI Fixtures": 3.0,
    "LED Fixtures": 2.0,
    "Labels": 1.5,
    "Misc": 3.0,
    "Rags": 6.0,
    "Rolls, Cards & Light Beams": 4.0,
    "Rooms & Spaces": 12.0,
    "Solid Frames & Boards": 4.0,
    "Support & Rigging": 4.0,
    "Tungsten Fixtures & Others": 2.5,
}

# Tidier headings than the raw folder names.
CATEGORY_LABEL = {
    "Rolls, Cards & Light Beams": "Rolls & Cards",
    "Solid Frames & Boards": "Frames & Boards",
    "Tungsten Fixtures & Others": "Tungsten & Practicals",
    "Support & Rigging": "Support & Rigging",
}

# Items whose real footprint is well away from the category default.
# Matched case insensitively against the original filename.
SPECIFIC_FEET = {
    "spacelight": 4.0,
    "molebeam 20k": 4.5,
    "molebeam 10k": 4.0,
    "mole 12k par": 3.5,
    "mole 9k molepar": 3.5,
    "mole 6k molepar": 3.0,
    "mole 9 light molefay": 4.0,
    "mole 6 light molefay": 3.5,
    "mole skypan": 3.0,
    "briese focus 330": 11.0,
    "briese focus 220": 7.2,
    "briese focus 180": 6.0,
    "briese focus 100": 3.3,
    "china ball": 2.0,
    "bare bulb": 0.6,
    "flashlight": 0.8,
    "lamp with shade": 1.6,
    "street light": 1.5,
    "arri 150": 1.0,
    "arri 300": 1.2,
    "arri 650": 1.4,
    "mole baby": 1.6,
    "mole tweenie": 1.2,
    "mole junior": 2.0,
    "large softbox": 4.0,
    "small softbox": 2.0,
    "large pancake": 3.0,
    "medium pancake": 2.0,
    "apple box": 1.7,
    "condor": 8.0,
    "genny": 12.0,
    "generator": 12.0,
    "lunch box": 1.5,
    "distro": 2.0,
    "hedge": 6.0,
    "tree": 12.0,
    "car": 15.0,
    "truck": 20.0,
    "doorway dolly": 5.0,
    "western dolly": 6.0,
    "fisher": 6.0,
    "scissor lift": 8.0,
}

SIZE_PATTERNS = [
    # 18x24, 4x4, 1x1
    re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)(?![\d.])"),
    # 10_ x 10_  (the foot mark survives as an underscore)
    re.compile(r"(\d+(?:\.\d+)?)_\s*[xX]\s*(\d+(?:\.\d+)?)_"),
]
SINGLE_PATTERN = re.compile(r"^(\d+(?:\.\d+)?)_")


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = text.lower().replace("&", "and").replace("+", "plus").replace("_", "")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-") or "stencil"


def declared_feet(stem):
    """Longest dimension the filename admits to, if any."""
    for pat in SIZE_PATTERNS:
        m = pat.search(stem)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            if 0.2 <= max(a, b) <= 40:
                return max(a, b)
    m = SINGLE_PATTERN.match(stem)
    if m and 0.2 <= float(m.group(1)) <= 40:
        return float(m.group(1))
    return None


def override_feet(stem):
    low = stem.lower()
    for key, val in SPECIFIC_FEET.items():
        if key in low:
            return val
    return None


def fmt(n):
    n = round(n, 2)
    return str(int(n)) if float(n) == int(n) else str(n)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, out = sys.argv[1], sys.argv[2]

    entries = []
    guessed = 0
    resized = 0

    for category in sorted(os.listdir(src)):
        cdir = os.path.join(src, category)
        if not os.path.isdir(cdir) or category.startswith("_") or category.startswith("."):
            continue
        default = CATEGORY_FEET.get(category, 3.0)
        label = CATEGORY_LABEL.get(category, category)
        cslug = slugify(category)
        os.makedirs(os.path.join(out, cslug), exist_ok=True)

        for fname in sorted(os.listdir(cdir)):
            if not fname.lower().endswith((".png", ".webp")):
                continue
            stem = os.path.splitext(fname)[0]
            img = Image.open(os.path.join(cdir, fname)).convert("RGBA")

            # Crop to the artwork so the footprint describes the object, not padding
            bbox = img.split()[3].getbbox()
            if bbox:
                img = img.crop(bbox)

            long_ft = declared_feet(stem) or override_feet(stem) or default
            if declared_feet(stem) is None and override_feet(stem) is None:
                guessed += 1

            W, H = img.size
            if W >= H:
                w_ft, d_ft = long_ft, long_ft * H / W
            else:
                d_ft, w_ft = long_ft, long_ft * W / H
            w_ft, d_ft = max(0.3, w_ft), max(0.3, d_ft)

            if max(W, H) > LONG_EDGE:
                k = LONG_EDGE / max(W, H)
                img = img.resize((max(1, int(W * k)), max(1, int(H * k))), Image.LANCZOS)
                resized += 1

            slug = slugify(stem)
            outname = f"{slug}_{fmt(w_ft)}x{fmt(d_ft)}.png"
            img.save(os.path.join(out, cslug, outname), optimize=True)

            entries.append({
                "id": f"{cslug}/{slug}",
                "name": stem.replace("_", "'").strip(),
                "category": label,
                "file": f"{cslug}/{outname}",
                "w": round(w_ft, 2),
                "d": round(d_ft, 2),
                "tint": "none",
            })

    manifest = {"version": 1, "units": "ft", "stencils": entries}
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(f"Prepared {len(entries)} stencils into {out}")
    print(f"  {len(entries) - guessed} sized from filenames or overrides, {guessed} from category defaults")
    print(f"  {resized} downsampled to {LONG_EDGE} px")


if __name__ == "__main__":
    main()
