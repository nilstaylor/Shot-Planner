#!/usr/bin/env python3
"""
make-stencils.py

Draws the bundled stencil library as transparent PNGs.

Every symbol is top down and orthographic, black line art on transparency, and
each file is rendered at the aspect ratio of its real footprint so the app can
map it onto the plan without distortion. Filenames carry the footprint in feet,
which is what build-stencils.mjs reads to write the manifest.

    python3 make-stencils.py [output_dir]

Adding your own: append an entry to CATALOG. Coordinates are normalized, so
(0, 0) is the top left of the footprint and (1, 1) the bottom right. Primitives
are rect, frect (filled), ellipse, fellipse, line, arc, poly, fpoly.
"""

import os
import sys
from PIL import Image, ImageDraw

SS = 3           # supersample factor, downsampled at the end for clean edges
LONG_EDGE = 512  # pixels on the longer side of the finished file
STROKE = 5       # finished line weight in pixels

BLACK = (0, 0, 0, 255)


# ----------------------------------------------------------------------
# The catalog. (category, slug, width_ft, depth_ft, [primitives])
# ----------------------------------------------------------------------

def sofa(seats):
    """Back, arms, and a divider between each seat cushion."""
    parts = [
        ("rect", 0.02, 0.14, 0.98, 0.98, 0.04),
        ("rect", 0.02, 0.02, 0.98, 0.22, 0.04),
        ("line", 0.16, 0.22, 0.16, 0.98),
        ("line", 0.84, 0.22, 0.84, 0.98),
    ]
    inner = 0.84 - 0.16
    for i in range(1, seats):
        x = 0.16 + inner * i / seats
        parts.append(("line", x, 0.28, x, 0.92))
    return parts


def chair(back_at_top=True):
    parts = [("rect", 0.12, 0.24, 0.88, 0.96, 0.06)]
    parts.append(("rect", 0.06, 0.04, 0.94, 0.18, 0.05) if back_at_top else ("rect", 0.06, 0.82, 0.94, 0.96, 0.05))
    return parts


def bed(pillows):
    parts = [("rect", 0.04, 0.02, 0.96, 0.98, 0.03), ("line", 0.04, 0.26, 0.96, 0.26)]
    if pillows == 1:
        parts.append(("rect", 0.22, 0.05, 0.78, 0.22, 0.05))
    else:
        parts.append(("rect", 0.08, 0.05, 0.49, 0.22, 0.05))
        parts.append(("rect", 0.51, 0.05, 0.92, 0.22, 0.05))
    return parts


def car(cab_top, cab_bottom, hood_split=False):
    """Body outline with a cabin box, seen from above."""
    parts = [
        ("rect", 0.06, 0.02, 0.94, 0.98, 0.14),
        ("rect", 0.12, cab_top, 0.88, cab_bottom, 0.06),
        ("line", 0.12, cab_top + (cab_bottom - cab_top) * 0.42, 0.88, cab_top + (cab_bottom - cab_top) * 0.42),
    ]
    if hood_split:
        parts.append(("line", 0.06, cab_bottom + 0.06, 0.94, cab_bottom + 0.06))
    return parts


CATALOG = [
    # ---------------- furniture ----------------
    ("furniture", "dining-table", 6, 3, [("rect", 0.02, 0.04, 0.98, 0.96, 0.03)]),
    ("furniture", "round-table", 4, 4, [("ellipse", 0.03, 0.03, 0.97, 0.97)]),
    ("furniture", "cafe-table", 2.5, 2.5, [("ellipse", 0.06, 0.06, 0.94, 0.94), ("ellipse", 0.42, 0.42, 0.58, 0.58)]),
    ("furniture", "coffee-table", 4, 2, [("rect", 0.03, 0.06, 0.97, 0.94, 0.04)]),
    ("furniture", "side-table", 1.5, 1.5, [("rect", 0.08, 0.08, 0.92, 0.92, 0.08)]),
    ("furniture", "desk", 5, 2.5, [("rect", 0.02, 0.05, 0.98, 0.95, 0.03), ("line", 0.02, 0.72, 0.98, 0.72)]),
    ("furniture", "chair", 1.7, 1.7, chair()),
    ("furniture", "stool", 1.2, 1.2, [("ellipse", 0.1, 0.1, 0.9, 0.9)]),
    ("furniture", "armchair", 2.5, 2.5, [
        ("rect", 0.04, 0.16, 0.96, 0.96, 0.1),
        ("rect", 0.04, 0.04, 0.96, 0.26, 0.08),
        ("line", 0.22, 0.26, 0.22, 0.96),
        ("line", 0.78, 0.26, 0.78, 0.96),
    ]),
    ("furniture", "sofa-2seat", 5, 3, sofa(2)),
    ("furniture", "sofa-3seat", 7, 3, sofa(3)),
    ("furniture", "bench", 5, 1.5, [("rect", 0.02, 0.18, 0.98, 0.98, 0.05), ("line", 0.02, 0.14, 0.98, 0.14)]),
    ("furniture", "bed-single", 3.2, 6.5, bed(1)),
    ("furniture", "bed-queen", 5, 6.7, bed(2)),
    ("furniture", "nightstand", 1.5, 1.5, [("rect", 0.08, 0.08, 0.92, 0.92, 0.05), ("line", 0.08, 0.62, 0.92, 0.62)]),
    ("furniture", "dresser", 5, 1.7, [
        ("rect", 0.02, 0.06, 0.98, 0.94, 0.03),
        ("line", 0.35, 0.06, 0.35, 0.94),
        ("line", 0.68, 0.06, 0.68, 0.94),
    ]),
    ("furniture", "bookshelf", 3, 1, [("rect", 0.02, 0.1, 0.98, 0.9, 0.02), ("line", 0.02, 0.5, 0.98, 0.5)]),
    ("furniture", "tv-stand", 4, 1.5, [("rect", 0.02, 0.3, 0.98, 0.95, 0.03), ("line", 0.14, 0.1, 0.86, 0.1)]),
    ("furniture", "piano-upright", 5, 2.2, [
        ("rect", 0.02, 0.05, 0.98, 0.95, 0.03),
        ("line", 0.02, 0.55, 0.98, 0.55),
    ]),
    ("furniture", "rug", 8, 5, [("rect", 0.02, 0.03, 0.98, 0.97, 0.02), ("rect", 0.09, 0.12, 0.91, 0.88, 0.02)]),

    # ---------------- kitchen and bath ----------------
    ("fixtures", "refrigerator", 3, 2.5, [("rect", 0.05, 0.05, 0.95, 0.95, 0.05), ("line", 0.5, 0.05, 0.5, 0.95)]),
    ("fixtures", "stove", 2.5, 2.2, [
        ("rect", 0.04, 0.04, 0.96, 0.96, 0.04),
        ("ellipse", 0.12, 0.12, 0.46, 0.46), ("ellipse", 0.54, 0.12, 0.88, 0.46),
        ("ellipse", 0.12, 0.54, 0.46, 0.88), ("ellipse", 0.54, 0.54, 0.88, 0.88),
    ]),
    ("fixtures", "kitchen-sink", 3, 2, [
        ("rect", 0.03, 0.06, 0.97, 0.94, 0.03),
        ("rect", 0.1, 0.2, 0.48, 0.86, 0.04), ("rect", 0.52, 0.2, 0.9, 0.86, 0.04),
    ]),
    ("fixtures", "kitchen-island", 6, 3, [("rect", 0.02, 0.05, 0.98, 0.95, 0.03), ("rect", 0.1, 0.16, 0.9, 0.84, 0.03)]),
    ("fixtures", "counter", 8, 2, [("rect", 0.01, 0.08, 0.99, 0.92, 0.02)]),
    ("fixtures", "toilet", 1.5, 2.5, [
        ("rect", 0.18, 0.02, 0.82, 0.3, 0.04),
        ("ellipse", 0.1, 0.32, 0.9, 0.96),
    ]),
    ("fixtures", "bathtub", 5, 2.5, [("rect", 0.02, 0.05, 0.98, 0.95, 0.08), ("rect", 0.1, 0.15, 0.9, 0.85, 0.1)]),

    # ---------------- architecture ----------------
    ("architecture", "door-swing", 3, 3, [
        ("line", 0.06, 0.94, 0.06, 0.06),
        ("arc", -0.82, 0.06, 0.94, 1.82, 270, 360),
        ("line", 0.06, 0.94, 0.94, 0.94),
    ]),
    ("architecture", "double-door", 6, 3, [
        ("line", 0.03, 0.94, 0.03, 0.1), ("arc", -0.41, 0.06, 0.47, 0.94 + 0.88, 270, 360),
        ("line", 0.97, 0.94, 0.97, 0.1), ("arc", 0.53, 0.06, 1.41, 0.94 + 0.88, 180, 270),
        ("line", 0.03, 0.94, 0.97, 0.94),
    ]),
    ("architecture", "sliding-door", 5, 0.6, [
        ("frect", 0.0, 0.3, 0.48, 0.7), ("rect", 0.5, 0.15, 1.0, 0.85, 0.0),
    ]),
    ("architecture", "window", 4, 0.7, [
        ("rect", 0.0, 0.1, 1.0, 0.9, 0.0), ("line", 0.0, 0.5, 1.0, 0.5),
    ]),
    ("architecture", "wall", 10, 0.5, [("frect", 0.0, 0.0, 1.0, 1.0)]),
    ("architecture", "column", 1.5, 1.5, [("ellipse", 0.05, 0.05, 0.95, 0.95), ("ellipse", 0.3, 0.3, 0.7, 0.7)]),
    ("architecture", "stairs", 3.5, 10, [
        ("rect", 0.04, 0.02, 0.96, 0.98, 0.0),
        ("line", 0.5, 0.9, 0.5, 0.14), ("poly", [(0.5, 0.06), (0.42, 0.18), (0.58, 0.18)]),
    ] + [("line", 0.04, y / 10.0, 0.96, y / 10.0) for y in range(1, 10)]),

    # ---------------- lighting ----------------
    ("lighting", "fresnel", 1.5, 1.5, [
        ("ellipse", 0.08, 0.08, 0.92, 0.92),
        ("line", 0.22, 0.22, 0.78, 0.78), ("line", 0.78, 0.22, 0.22, 0.78),
    ]),
    ("lighting", "hmi", 2, 2, [
        ("ellipse", 0.04, 0.04, 0.96, 0.96), ("ellipse", 0.2, 0.2, 0.8, 0.8),
        ("line", 0.3, 0.3, 0.7, 0.7), ("line", 0.7, 0.3, 0.3, 0.7),
    ]),
    ("lighting", "softbox", 3, 3, [
        ("rect", 0.06, 0.06, 0.94, 0.94, 0.06),
        ("line", 0.06, 0.06, 0.94, 0.94), ("line", 0.94, 0.06, 0.06, 0.94),
    ]),
    ("lighting", "kino", 2.5, 1, [
        ("rect", 0.02, 0.1, 0.98, 0.9, 0.05),
        ("line", 0.02, 0.5, 0.98, 0.5),
    ]),
    ("lighting", "china-ball", 2, 2, [
        ("ellipse", 0.06, 0.06, 0.94, 0.94), ("line", 0.06, 0.5, 0.94, 0.5), ("line", 0.5, 0.06, 0.5, 0.94),
    ]),
    ("lighting", "practical-lamp", 1.5, 1.5, [
        ("ellipse", 0.12, 0.12, 0.88, 0.88), ("ellipse", 0.4, 0.4, 0.6, 0.6),
    ]),
    ("lighting", "c-stand", 3, 3, [
        ("ellipse", 0.38, 0.38, 0.62, 0.62),
        ("line", 0.5, 0.5, 0.5, 0.04), ("line", 0.5, 0.5, 0.1, 0.78), ("line", 0.5, 0.5, 0.9, 0.78),
    ]),
    ("lighting", "flag-4x4", 4, 0.5, [("frect", 0.0, 0.15, 1.0, 0.85)]),
    ("lighting", "bounce-4x4", 4, 0.5, [
        ("rect", 0.0, 0.1, 1.0, 0.9, 0.0),
        ("line", 0.0, 0.9, 0.16, 0.1), ("line", 0.2, 0.9, 0.36, 0.1), ("line", 0.4, 0.9, 0.56, 0.1),
        ("line", 0.6, 0.9, 0.76, 0.1), ("line", 0.8, 0.9, 0.96, 0.1),
    ]),

    # ---------------- grip and camera ----------------
    ("grip", "dolly-track", 2, 10, [
        ("line", 0.2, 0.0, 0.2, 1.0), ("line", 0.8, 0.0, 0.8, 1.0),
    ] + [("line", 0.2, y / 12.0, 0.8, y / 12.0) for y in range(1, 12)]),
    ("grip", "apple-box", 1.7, 1, [("rect", 0.04, 0.08, 0.96, 0.92, 0.03), ("line", 0.04, 0.5, 0.96, 0.5)]),
    ("grip", "sandbag", 1.2, 0.8, [("rect", 0.06, 0.12, 0.94, 0.88, 0.3)]),
    ("grip", "video-village", 5, 3, [
        ("rect", 0.02, 0.3, 0.98, 0.98, 0.03),
        ("rect", 0.2, 0.02, 0.8, 0.24, 0.03),
    ]),

    # ---------------- vehicles ----------------
    ("vehicles", "sedan", 6, 15, car(0.3, 0.62, True)),
    ("vehicles", "suv", 6.5, 16, car(0.24, 0.66, True)),
    ("vehicles", "van", 7, 18, car(0.14, 0.72)),
    ("vehicles", "pickup", 6.5, 17, [
        ("rect", 0.06, 0.02, 0.94, 0.98, 0.1),
        ("rect", 0.12, 0.16, 0.88, 0.44, 0.05),
        ("line", 0.06, 0.5, 0.94, 0.5),
        ("rect", 0.1, 0.56, 0.9, 0.94, 0.03),
    ]),
    ("vehicles", "motorcycle", 2.2, 7, [
        ("ellipse", 0.3, 0.02, 0.7, 0.22), ("ellipse", 0.3, 0.78, 0.7, 0.98),
        ("line", 0.5, 0.22, 0.5, 0.78), ("line", 0.1, 0.3, 0.9, 0.3),
    ]),
    ("vehicles", "bicycle", 1.7, 5.8, [
        ("ellipse", 0.2, 0.02, 0.8, 0.2), ("ellipse", 0.2, 0.8, 0.8, 0.98),
        ("line", 0.5, 0.2, 0.5, 0.8), ("line", 0.14, 0.26, 0.86, 0.26),
    ]),

    # ---------------- exterior ----------------
    ("exterior", "tree", 10, 10, [
        ("ellipse", 0.03, 0.03, 0.97, 0.97), ("ellipse", 0.34, 0.34, 0.66, 0.66),
        ("ellipse", 0.46, 0.46, 0.54, 0.54),
    ]),
    ("exterior", "shrub", 3, 3, [("ellipse", 0.06, 0.06, 0.94, 0.94), ("ellipse", 0.3, 0.3, 0.7, 0.7)]),
    ("exterior", "picnic-table", 6, 5.5, [
        ("rect", 0.02, 0.3, 0.98, 0.7, 0.02),
        ("rect", 0.02, 0.04, 0.98, 0.2, 0.02), ("rect", 0.02, 0.8, 0.98, 0.96, 0.02),
    ]),
    ("exterior", "park-bench", 5, 2, [
        ("rect", 0.02, 0.4, 0.98, 0.96, 0.04), ("rect", 0.02, 0.06, 0.98, 0.28, 0.04),
    ]),
    ("exterior", "streetlight", 1.2, 1.2, [
        ("ellipse", 0.25, 0.25, 0.75, 0.75), ("line", 0.5, 0.0, 0.5, 0.25), ("line", 0.5, 0.75, 0.5, 1.0),
        ("line", 0.0, 0.5, 0.25, 0.5), ("line", 0.75, 0.5, 1.0, 0.5),
    ]),
    ("exterior", "parking-space", 9, 18, [
        ("line", 0.0, 0.0, 0.0, 1.0), ("line", 1.0, 0.0, 1.0, 1.0), ("line", 0.0, 1.0, 1.0, 1.0),
    ]),
]


# ----------------------------------------------------------------------
# Renderer
# ----------------------------------------------------------------------

def render(width_ft, depth_ft, parts):
    longest = max(width_ft, depth_ft)
    w = max(24, int(round(LONG_EDGE * width_ft / longest)))
    h = max(24, int(round(LONG_EDGE * depth_ft / longest)))
    img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = max(SS, int(round(STROKE * SS)))
    W, H = w * SS, h * SS

    def X(v):
        return v * W

    def Y(v):
        return v * H

    def inset(x0, y0, x1, y1):
        """Keep strokes inside the canvas so nothing is clipped at the edges."""
        m = lw / 2
        return [
            min(max(X(x0), m), W - m), min(max(Y(y0), m), H - m),
            min(max(X(x1), m), W - m), min(max(Y(y1), m), H - m),
        ]

    for p in parts:
        kind = p[0]
        if kind in ("rect", "frect"):
            box = inset(*p[1:5])
            if kind == "frect":
                d.rectangle(box, fill=BLACK)
            else:
                r = p[5] * min(W, H) if len(p) > 5 else 0
                if r > 1:
                    d.rounded_rectangle(box, radius=r, outline=BLACK, width=lw)
                else:
                    d.rectangle(box, outline=BLACK, width=lw)
        elif kind in ("ellipse", "fellipse"):
            box = inset(*p[1:5])
            d.ellipse(box, fill=BLACK if kind == "fellipse" else None,
                      outline=None if kind == "fellipse" else BLACK,
                      width=lw)
        elif kind == "line":
            d.line([X(p[1]), Y(p[2]), X(p[3]), Y(p[4])], fill=BLACK, width=lw)
        elif kind == "arc":
            d.arc([X(p[1]), Y(p[2]), X(p[3]), Y(p[4])], p[5], p[6], fill=BLACK, width=lw)
        elif kind in ("poly", "fpoly"):
            pts = [(X(a), Y(b)) for a, b in p[1]]
            if kind == "fpoly":
                d.polygon(pts, fill=BLACK)
            else:
                d.line(pts + [pts[0]], fill=BLACK, width=lw, joint="curve")
        else:
            raise ValueError("unknown primitive " + kind)

    return img.resize((w, h), Image.LANCZOS)


def fmt(n):
    return str(int(n)) if float(n) == int(n) else str(n)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "stencils"
    made = 0
    for category, slug, w, d, parts in CATALOG:
        folder = os.path.join(out, category)
        os.makedirs(folder, exist_ok=True)
        name = f"{slug}_{fmt(w)}x{fmt(d)}.png"
        render(w, d, parts).save(os.path.join(folder, name))
        made += 1
    print(f"Wrote {made} stencils to {out}")


if __name__ == "__main__":
    main()
