import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   BLOCKING BOARD
   A top-down camera blocking tool: floor plan, linked cameras,
   auto-generated shot list, line of action checking.
   Units are feet. Angles are degrees, 0 = up (north), clockwise.
   ============================================================ */

const SENSORS = {
  "Super 35": { w: 24.89, h: 14.0 },
  "Full Frame": { w: 36.0, h: 20.25 },
  "Micro 4/3": { w: 17.3, h: 9.73 },
  "Super 16": { w: 12.52, h: 7.04 },
};

const LENSES = [12, 14, 16, 18, 21, 24, 27, 32, 35, 40, 50, 65, 75, 85, 100, 135, 150, 200];

const MOVES = ["Static", "Pan", "Tilt", "Dolly in", "Dolly out", "Track", "Crane", "Handheld", "Steadicam", "Zoom"];

const SUPPORTS = ["Sticks", "Handheld", "Dolly", "Steadicam", "Gimbal", "Crane", "Jib", "Slider", "Car mount", "Drone"];

const CAM_LETTERS = ["A", "B", "C", "D"];

/* Setup letters follow standard slating practice: I and O are skipped because
   they read as 1 and 0 on a slate, and after Z the letters double rather than
   pairing up, so the run is X, Y, Z, AA, BB, CC. */
const SLATE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function setupSuffix(n) {
  const cycle = Math.floor(n / SLATE_LETTERS.length);
  return SLATE_LETTERS[n % SLATE_LETTERS.length].repeat(cycle + 1);
}

const SUBJECT_HEIGHT = 5.9; // feet, standing adult
const EYE_HEIGHT = 5.4;

/* ------------------------------------------------------------
   STENCILS
   The app looks for a manifest at STENCIL_MANIFEST on load. Drop
   PNGs into the stencils folder, run tools/build-stencils.mjs, and
   they appear in the picker. Footprints are real world feet, so a
   sofa placed on the plan is genuinely seven feet of floor.
   The small set below is a fallback so the app still runs before
   any manifest exists.
   ------------------------------------------------------------ */

const STENCIL_MANIFEST = "stencils/manifest.json";

const stencilArt = (paths) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="4">${paths}</svg>`
  );

const FALLBACK_STENCILS = [
  {
    id: "builtin/table",
    name: "Table",
    category: "Furniture",
    w: 5,
    d: 3,
    tint: "light",
    file: stencilArt(`<rect x="6" y="6" width="88" height="88" rx="4"/>`),
  },
  {
    id: "builtin/round-table",
    name: "Round table",
    category: "Furniture",
    w: 4,
    d: 4,
    tint: "light",
    file: stencilArt(`<circle cx="50" cy="50" r="44"/>`),
  },
  {
    id: "builtin/chair",
    name: "Chair",
    category: "Furniture",
    w: 1.8,
    d: 1.8,
    tint: "light",
    file: stencilArt(`<rect x="18" y="26" width="64" height="60" rx="6"/><rect x="12" y="10" width="76" height="14" rx="6"/>`),
  },
  {
    id: "builtin/sofa",
    name: "Sofa",
    category: "Furniture",
    w: 7,
    d: 3,
    tint: "light",
    file: stencilArt(
      `<rect x="6" y="30" width="88" height="60" rx="8"/><rect x="6" y="8" width="88" height="24" rx="8"/><path d="M50 32v58"/>`
    ),
  },
  {
    id: "builtin/bed",
    name: "Bed",
    category: "Furniture",
    w: 5,
    d: 6.5,
    tint: "light",
    file: stencilArt(`<rect x="10" y="6" width="80" height="88" rx="5"/><path d="M10 30h80"/>`),
  },
  {
    id: "builtin/door",
    name: "Door swing",
    category: "Architecture",
    w: 3,
    d: 3,
    tint: "light",
    file: stencilArt(`<path d="M8 92V8"/><path d="M8 8a84 84 0 0 1 84 84"/><path d="M8 92h84"/>`),
  },
  {
    id: "builtin/window",
    name: "Window",
    category: "Architecture",
    w: 4,
    d: 0.7,
    tint: "light",
    file: stencilArt(`<rect x="4" y="34" width="92" height="32"/><path d="M4 50h92"/>`),
  },
  {
    id: "builtin/car",
    name: "Car",
    category: "Vehicles",
    w: 6,
    d: 15,
    tint: "light",
    file: stencilArt(
      `<rect x="16" y="4" width="68" height="92" rx="22"/><path d="M28 34h44M28 62h44"/>`
    ),
  },
];

const PAPER = {
  ink: "#f4f2ed",
  panel: "#151d26",
  panelHi: "#1d2833",
  rule: "#cec9bc",
  ruleSoft: "#e4dfd4",
  text: "#1c2732",
  dim: "#6b7681",
  camera: "#a9640c",
  cameraSoft: "rgba(169,100,12,0.14)",
  actor: "#0d6f66",
  prop: "#5b7286",
  bad: "#bf262b",
  select: "#101418",
};

const COLORS = {
  ink: "#0d1218",
  panel: "#151d26",
  panelHi: "#1d2833",
  rule: "#22303d",
  ruleSoft: "#1a242e",
  text: "#c8d4de",
  dim: "#7b8b99",
  camera: "#e8a33d",
  cameraSoft: "rgba(232,163,61,0.16)",
  actor: "#4fd1c5",
  prop: "#5b7286",
  bad: "#e5484d",
  select: "#ffffff",
};

/* ---------------- geometry helpers ---------------- */

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// facing vector for a heading where 0 points up the screen
const facing = (rot) => ({ x: Math.sin(rad(rot)), y: -Math.cos(rad(rot)) });

// heading that points along vector (dx, dy)
const headingOf = (dx, dy) => (deg(Math.atan2(dx, -dy)) + 360) % 360;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const norm = (v) => {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
};

const rotatePoint = (p, center, delta) => {
  const s = Math.sin(rad(delta));
  const c = Math.cos(rad(delta));
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
};

/* ---------------- shot description engine ---------------- */

function frameHeight(distanceFt, focal, sensorKey) {
  const s = SENSORS[sensorKey] || SENSORS["Super 35"];
  return (distanceFt * s.h) / focal;
}

function shotSize(V, subjectHeight) {
  const h = subjectHeight && subjectHeight > 0 ? subjectHeight : SUBJECT_HEIGHT;
  const v = (V * SUBJECT_HEIGHT) / h; // a child fills more of the frame at the same distance
  if (v <= 1.2) return { code: "ECU", label: "Extreme close up" };
  if (v <= 1.8) return { code: "BCU", label: "Big close up" };
  if (v <= 2.5) return { code: "CU", label: "Close up" };
  if (v <= 3.4) return { code: "MCU", label: "Medium close up" };
  if (v <= 4.6) return { code: "MS", label: "Medium shot" };
  if (v <= 6.2) return { code: "MWS", label: "Medium wide" };
  if (v <= 9.5) return { code: "WS", label: "Wide shot" };
  if (v <= 17) return { code: "VWS", label: "Very wide" };
  return { code: "EWS", label: "Extreme wide" };
}

function subjectRelation(cam, subj) {
  const f = facing(subj.rot);
  const toCam = norm({ x: cam.x - subj.x, y: cam.y - subj.y });
  const a = deg(Math.acos(Math.max(-1, Math.min(1, f.x * toCam.x + f.y * toCam.y))));
  if (a < 22) return "frontal";
  if (a < 67) return "3/4 front";
  if (a < 112) return "profile";
  if (a < 157) return "3/4 back";
  return "from behind";
}

function heightNote(h) {
  if (h >= EYE_HEIGHT + 1.6) return "high angle";
  if (h <= EYE_HEIGHT - 1.9) return "low angle";
  return "eye level";
}

/* ---------------- object factories ---------------- */

let seq = 0;
const uid = (p) => `${p}${++seq}`;

const newActor = (x, y, name) => ({
  id: uid("a"),
  type: "actor",
  name,
  x,
  y,
  rot: 180,
  height: SUBJECT_HEIGHT,
});

const newCamera = (x, y, name, extra = {}) => ({
  id: uid("c"),
  type: "camera",
  name,
  x,
  y,
  rot: 0,
  focal: 35,
  sensor: "Super 35",
  height: EYE_HEIGHT,
  move: "Static",
  support: "Sticks",
  est: 20,
  sameSetup: false,
  notes: "",
  linkTo: null,
  aim: true,
  ...extra,
});

const newProp = (x, y, name, st = null) => ({
  id: uid("p"),
  type: "prop",
  name,
  x,
  y,
  rot: 0,
  w: st ? st.w : 5,
  d: st ? st.d : 2.5,
  src: st ? st.file : null,
  stencilId: st ? st.id : null,
  tint: st ? st.tint || "light" : "none",
});

const STARTER = () => {
  const a = newActor(-4, 0, "ANNA");
  const b = newActor(4, 0, "BEN");
  a.rot = 90;
  b.rot = 270;
  const table = newProp(0, 0, "Table", FALLBACK_STENCILS[0]);
  return [a, b, table];
};

/* ============================================================
   Component
   ============================================================ */

export default function BlockingBoard() {
  const [objects, setObjects] = useState(STARTER);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 16 });
  const [line, setLine] = useState({ on: true, auto: true, a: null, b: null, side: 1 });
  const [showCones, setShowCones] = useState(true);
  const [paper, setPaper] = useState(true);
  const [pane, setPane] = useState("shots");
  const [stencils, setStencils] = useState(FALLBACK_STENCILS);
  const [stencilQuery, setStencilQuery] = useState("");
  const [catalogNote, setCatalogNote] = useState("Built in set. No stencil folder found yet.");
  const [meta, setMeta] = useState({
    production: "Untitled",
    director: "",
    scene: "1",
    intExt: "INT.",
    location: "",
    timeOfDay: "DAY",
    pages: "",
    shootDay: "",
  });

  const svgRef = useRef(null);
  const drag = useRef(null);
  const fileRef = useRef(null);
  const pngRef = useRef(null);

  /* ---- pull in the PNG stencil folder if one is published ---- */
  useEffect(() => {
    let cancelled = false;
    const base = STENCIL_MANIFEST.slice(0, STENCIL_MANIFEST.lastIndexOf("/") + 1);
    fetch(STENCIL_MANIFEST)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const loaded = (data.stencils || [])
          .filter((s) => s && s.file)
          .map((s) => ({
            id: s.id || s.file,
            name: s.name || "Untitled",
            category: s.category || "Uncategorized",
            w: Number(s.w) > 0 ? Number(s.w) : 3,
            d: Number(s.d) > 0 ? Number(s.d) : 3,
            tint: s.tint || "light",
            file: /^(https?:|data:|\/)/.test(s.file) ? s.file : base + s.file,
          }));
        if (loaded.length) {
          setStencils(loaded);
          setCatalogNote(`${loaded.length} stencils loaded from the folder.`);
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogNote("Built in set. Publish a stencils folder to replace it.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => Object.fromEntries(objects.map((o) => [o.id, o])), [objects]);
  const actors = objects.filter((o) => o.type === "actor");
  const cameras = objects.filter((o) => o.type === "camera");

  /* ---- who gets the line ----
     With two actors it is obvious. With more, score every pair on how much
     they face each other and how close they stand, and give the line to the
     strongest relationship. Recomputed from live positions, so the line and
     the flagged cameras track the actors as they are dragged. */
  const autoPair = useMemo(() => {
    if (actors.length < 2) return null;
    let best = null;
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const A = actors[i];
        const B = actors[j];
        const u = norm({ x: B.x - A.x, y: B.y - A.y });
        const fA = facing(A.rot);
        const fB = facing(B.rot);
        const mutual = fA.x * u.x + fA.y * u.y + (fB.x * -u.x + fB.y * -u.y); // 2 = facing each other
        const score = mutual * 6 - dist(A, B) / 4;
        if (!best || score > best.score) best = { score, a: A.id, b: B.id };
      }
    }
    return best ? [best.a, best.b] : null;
  }, [actors]);

  const linePair = useMemo(() => {
    if (!line.on) return null;
    if (!line.auto && line.a && line.b && byId[line.a] && byId[line.b]) return [line.a, line.b];
    return autoPair;
  }, [line, autoPair, byId]);

  /* ---- center the view once we know the pane size ---- */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2, y: r.height / 2 }));
  }, []);

  /* ---- wheel zoom, registered non passive so it can block page scroll ---- */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const next = Math.max(4, Math.min(70, v.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
        const k = next / v.scale;
        return { scale: next, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeObject(selected);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, objects]);

  const toWorld = useCallback(
    (e) => {
      const r = svgRef.current.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - view.x) / view.scale,
        y: (e.clientY - r.top - view.y) / view.scale,
      };
    },
    [view]
  );

  /* ---- effective heading: aimed cameras always point at their subject ---- */
  const headingFor = useCallback(
    (o) => {
      if (o.type === "camera" && o.aim && o.linkTo && byId[o.linkTo]) {
        const t = byId[o.linkTo];
        return headingOf(t.x - o.x, t.y - o.y);
      }
      return o.rot;
    },
    [byId]
  );

  /* ---- moving an actor carries its linked cameras with it ---- */
  const moveObject = (id, nx, ny) => {
    setObjects((prev) => {
      const target = prev.find((o) => o.id === id);
      if (!target) return prev;
      const dx = nx - target.x;
      const dy = ny - target.y;
      return prev.map((o) => {
        if (o.id === id) return { ...o, x: nx, y: ny };
        if (target.type === "actor" && o.type === "camera" && o.linkTo === id) {
          return { ...o, x: o.x + dx, y: o.y + dy };
        }
        return o;
      });
    });
  };

  const rotateObject = (id, newRot) => {
    setObjects((prev) => {
      const target = prev.find((o) => o.id === id);
      if (!target) return prev;
      const delta = newRot - target.rot;
      return prev.map((o) => {
        if (o.id === id) return { ...o, rot: (newRot + 360) % 360 };
        if (target.type === "actor" && o.type === "camera" && o.linkTo === id) {
          const p = rotatePoint(o, target, delta);
          return { ...o, x: p.x, y: p.y, rot: (o.rot + delta + 360) % 360 };
        }
        return o;
      });
    });
  };

  const patch = (id, fields) =>
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...fields } : o)));

  const removeObject = (id) => {
    setObjects((prev) =>
      prev.filter((o) => o.id !== id).map((o) => (o.linkTo === id ? { ...o, linkTo: null, aim: false } : o))
    );
    setLine((l) => ({ ...l, a: l.a === id ? null : l.a, b: l.b === id ? null : l.b }));
    setSelected(null);
  };

  /* ---- pointer handling ---- */

  const onObjectDown = (e, o, mode) => {
    e.stopPropagation();
    const w = toWorld(e);
    setSelected(o.id);
    drag.current = {
      mode,
      id: o.id,
      ox: w.x - o.x,
      oy: w.y - o.y,
      startW: o.w,
      startD: o.d,
      aspect: o.w && o.d ? o.w / o.d : null,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onCanvasDown = (e) => {
    setSelected(null);
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
      return;
    }
    const w = toWorld(e);
    const o = byId[d.id];
    if (!o) return;
    if (d.mode === "move") {
      moveObject(d.id, +(w.x - d.ox).toFixed(2), +(w.y - d.oy).toFixed(2));
    } else if (d.mode === "rotate") {
      const h = headingOf(w.x - o.x, w.y - o.y);
      if (o.type === "camera") patch(d.id, { rot: Math.round(h), aim: false });
      else rotateObject(d.id, Math.round(h));
    } else if (d.mode === "resize") {
      if (o.type === "actor") {
        const r = Math.hypot(w.x - o.x, w.y - o.y);
        patch(d.id, { height: +Math.max(1.5, Math.min(9, (r / 0.95) * SUBJECT_HEIGHT * 0.55)).toFixed(1) });
        return;
      }
      // Pointer into the object's own frame, so resizing works at any rotation
      const dx = w.x - o.x;
      const dy = w.y - o.y;
      const c = Math.cos(rad(o.rot));
      const s = Math.sin(rad(o.rot));
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      let nw = Math.max(0.4, Math.abs(lx) * 2);
      let nd = Math.max(0.4, Math.abs(ly) * 2);
      if (e.shiftKey && d.aspect) {
        const k = Math.max(nw / d.startW, nd / d.startD);
        nw = d.startW * k;
        nd = d.startD * k;
      }
      patch(d.id, { w: +nw.toFixed(2), d: +nd.toFixed(2) });
    }
  };

  const onUp = () => {
    drag.current = null;
  };

  /* ---- adding things ---- */

  const centerOfView = () => ({
    x: +((svgRef.current.clientWidth / 2 - view.x) / view.scale).toFixed(2),
    y: +((svgRef.current.clientHeight / 2 - view.y) / view.scale).toFixed(2),
  });

  const addActor = () => {
    const c = centerOfView();
    const names = ["ANNA", "BEN", "CLARA", "DIEGO", "EVE", "FRANK", "GRACE", "HUGO"];
    const o = newActor(c.x, c.y, names[actors.length % names.length]);
    setObjects((p) => [...p, o]);
    setSelected(o.id);
  };

  const addCamera = () => {
    const c = centerOfView();
    const o = newCamera(c.x, c.y - 8, String.fromCharCode(65 + cameras.length));
    o.aim = false;
    setObjects((p) => [...p, o]);
    setSelected(o.id);
  };

  const addProp = () => {
    const c = centerOfView();
    const o = newProp(c.x, c.y, "Set piece");
    setObjects((p) => [...p, o]);
    setSelected(o.id);
  };

  const placeStencil = (st) => {
    const c = centerOfView();
    const o = newProp(c.x, c.y, st.name, st);
    setObjects((p) => [...p, o]);
    setSelected(o.id);
  };

  /* Filenames carry their real footprint: sofa_7x3.png is seven feet by three.
     Anything without the suffix lands at 3 by 3 and can be resized on the plan. */
  const parseStencilName = (filename) => {
    const stem = filename.replace(/\.[a-z0-9]+$/i, "");
    const m = stem.match(/^(.*?)[_-](\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
    const raw = m ? m[1] : stem;
    const name = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      w: m ? parseFloat(m[2]) : 3,
      d: m ? parseFloat(m[3]) : 3,
    };
  };

  const importPngs = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    Promise.all(
      files.map(
        (f) =>
          new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => {
              const meta = parseStencilName(f.name);
              resolve({
                id: `session/${f.name}`,
                name: meta.name,
                category: "Imported",
                w: meta.w,
                d: meta.d,
                tint: "light",
                file: r.result,
              });
            };
            r.onerror = () => resolve(null);
            r.readAsDataURL(f);
          })
      )
    ).then((added) => {
      const good = added.filter(Boolean);
      if (!good.length) return;
      setStencils((prev) => [...prev.filter((s) => !good.some((g) => g.id === s.id)), ...good]);
      setCatalogNote(`${good.length} imported into this session.`);
    });
    e.target.value = "";
  };

  /* ---- coverage template: builds a standard two person setup ---- */
  const buildCoverage = () => {
    if (!linePair) return;
    const A = byId[linePair[0]];
    const B = byId[linePair[1]];
    if (!A || !B) return;
    const u = norm({ x: B.x - A.x, y: B.y - A.y });
    const n = { x: -u.y * line.side, y: u.x * line.side };
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const gap = dist(A, B);
    const push = (p, along, off) => ({
      x: p.x + u.x * along + n.x * off,
      y: p.y + u.y * along + n.y * off,
    });

    const made = [
      newCamera(mid.x + n.x * (gap + 6), mid.y + n.y * (gap + 6), "1", {
        focal: 32,
        linkTo: A.id,
        aim: true,
        notes: "Master, both in frame",
      }),
      newCamera(push(A, -3, 2.6).x, push(A, -3, 2.6).y, "2", {
        focal: 50,
        linkTo: B.id,
        aim: true,
        notes: `Over ${A.name} shoulder`,
      }),
      newCamera(push(B, 3, 2.6).x, push(B, 3, 2.6).y, "3", {
        focal: 50,
        linkTo: A.id,
        aim: true,
        notes: `Over ${B.name} shoulder`,
      }),
      newCamera(push(A, -2, 5.5).x, push(A, -2, 5.5).y, "4", {
        focal: 85,
        linkTo: B.id,
        aim: true,
        notes: `Clean single, ${B.name}`,
      }),
      newCamera(push(B, 2, 5.5).x, push(B, 2, 5.5).y, "5", {
        focal: 85,
        linkTo: A.id,
        aim: true,
        notes: `Clean single, ${A.name}`,
      }),
    ];
    setObjects((p) => [...p.filter((o) => o.type !== "camera"), ...made]);
    setPane("shots");
  };

  /* ---- line of action ---- */

  const sideOf = (p) => {
    if (!linePair) return 0;
    const A = byId[linePair[0]];
    const B = byId[linePair[1]];
    if (!A || !B) return 0;
    return Math.sign((B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x));
  };

  const crossesLine = (cam) => {
    if (!linePair) return false;
    const s = sideOf(cam);
    return s !== 0 && s !== line.side;
  };

  /* ---- derived shot list ---- */

  const shots = useMemo(() => {
    let setupIndex = -1;
    let camIndex = 0;
    const sceneNo = (meta.scene || "").trim() || "1";

    return cameras.map((cam, i) => {
      /* Slating: the first setup of a scene carries the bare scene number, and
         every new setup after it takes the next letter. Extra cameras rolling on
         the same setup share its slate and are told apart by camera letter. */
      if (i === 0) {
        setupIndex = 0;
        camIndex = 0;
      } else if (cam.sameSetup) {
        camIndex = Math.min(camIndex + 1, CAM_LETTERS.length - 1);
      } else {
        setupIndex += 1;
        camIndex = 0;
      }
      const slate = setupIndex === 0 ? sceneNo : `${sceneNo}${setupSuffix(setupIndex - 1)}`;

      let subj = cam.linkTo ? byId[cam.linkTo] : null;
      if (!subj && actors.length) {
        subj = actors.reduce((best, a) => (dist(cam, a) < dist(cam, best) ? a : best), actors[0]);
      }
      const d = subj ? dist(cam, subj) : 0;
      const V = subj ? frameHeight(d, cam.focal, cam.sensor) : 0;
      const size = subj ? shotSize(V, subj.height) : { code: "n/a", label: "No subject" };
      const rel = subj ? subjectRelation(cam, subj) : "";
      return {
        cam,
        index: i + 1,
        slate,
        camLetter: CAM_LETTERS[camIndex],
        multicam: cam.sameSetup || (cameras[i + 1] && cameras[i + 1].sameSetup),
        subject: subj,
        distance: d,
        frame: V,
        size,
        rel,
        height: heightNote(cam.height),
        crossing: crossesLine(cam),
        description: subj
          ? `${size.code} on ${subj.name}, ${rel}, ${cam.focal}mm, ${heightNote(cam.height)}`
          : `${cam.focal}mm, no subject linked`,
      };
    });
  }, [cameras, actors, byId, line, linePair, meta.scene]);

  const moveShot = (id, dir) => {
    setObjects((prev) => {
      const idx = prev.findIndex((o) => o.id === id);
      if (idx < 0) return prev;
      const camIdxs = prev.map((o, i) => (o.type === "camera" ? i : -1)).filter((i) => i >= 0);
      const at = camIdxs.indexOf(idx);
      const swapWith = camIdxs[at + dir];
      if (swapWith === undefined) return prev;
      const next = [...prev];
      next[idx] = prev[swapWith];
      next[swapWith] = prev[idx];
      return next;
    });
  };

  const stencilGroups = useMemo(() => {
    const q = stencilQuery.trim().toLowerCase();
    const hits = stencils.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
    const map = new Map();
    hits.forEach((s) => {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category).push(s);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [stencils, stencilQuery]);

  /* ---- import and export ---- */

  const download = (name, text, mime) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const slugline = () =>
    `${meta.intExt} ${(meta.location || "LOCATION").toUpperCase()} ${meta.timeOfDay ? "\u2014 " + meta.timeOfDay : ""}`.trim();

  const totalEst = shots.reduce((n, s) => n + (Number(s.cam.est) || 0), 0);

  const exportScene = () =>
    download("scene.json", JSON.stringify({ objects, line, meta }, null, 2), "application/json");

  const exportShotList = () => {
    const head = [
      "Scene",
      "Setup",
      "Cam",
      "Shot",
      "Size",
      "Angle",
      "Subject",
      "Lens",
      "Height",
      "Movement",
      "Support",
      "Distance ft",
      "Est min",
      "Notes",
    ];
    const rows = shots.map((s) => [
      meta.scene,
      s.slate,
      s.camLetter,
      s.index,
      s.size.code,
      `${s.rel}${s.height ? ", " + s.height : ""}`,
      s.subject ? s.subject.name : "",
      `${s.cam.focal}mm`,
      `${s.cam.height.toFixed(1)} ft`,
      s.cam.move,
      s.cam.support,
      s.distance.toFixed(1),
      s.cam.est,
      s.cam.notes.replace(/"/g, "'"),
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    download(`shot-list-sc${meta.scene}.csv`, csv, "text/csv");
  };

  /* A shot list a 1st AD would recognize: scene header, slate column, one row per
     setup, camera letter only where a second camera is on the same setup. */
  const buildShotListHtml = () => {
    const esc = (s) =>
      String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const rows = shots
      .map(
        (s) => `<tr${s.crossing ? ' class="flag"' : ""}>
        <td class="slate">${esc(s.slate)}${s.multicam ? `<span class="cam">${esc(s.camLetter)}</span>` : ""}</td>
        <td class="size">${esc(s.size.code)}</td>
        <td>${esc(s.subject ? s.subject.name : "")}</td>
        <td>${esc(s.rel)}${s.height ? `<span class="sub">, ${esc(s.height)}</span>` : ""}</td>
        <td class="num">${esc(s.cam.focal)}mm</td>
        <td>${esc(s.cam.move)}</td>
        <td>${esc(s.cam.support)}</td>
        <td class="num">${esc(s.cam.est)}</td>
        <td class="notes">${esc(s.cam.notes)}${
          s.crossing ? '<span class="warn">Crosses the line</span>' : ""
        }</td>
      </tr>`
      )
      .join("\n");

    return `<!doctype html><html><head><meta charset="utf-8">
<title>Shot list, scene ${esc(meta.scene)}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font: 11px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; }
  .prod { font-size: 17px; font-weight: 700; letter-spacing: 0.02em; }
  .dir { font-size: 11px; color: #444; margin-top: 2px; }
  .scene { text-align: right; }
  .sceneno { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .slug { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .meta { font-size: 10px; color: #555; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th { text-align: left; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #555;
       border-bottom: 1px solid #999; padding: 0 6px 5px; }
  td { padding: 7px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .slate { font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cam { display: inline-block; margin-left: 4px; padding: 1px 4px; border: 1px solid #111; border-radius: 2px;
         font-size: 9px; font-weight: 700; vertical-align: top; }
  .size { font-weight: 700; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sub { color: #666; }
  .notes { color: #333; }
  .warn { display: block; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.06em; margin-top: 2px; }
  .flag td { background: #f6f6f6; }
  tfoot td { border-bottom: none; border-top: 1px solid #999; font-weight: 700; padding-top: 8px; }
  .foot { margin-top: 18px; font-size: 9px; color: #777; display: flex; justify-content: space-between; }
</style></head><body>
<div class="head">
  <div>
    <div class="prod">${esc(meta.production || "Untitled")}</div>
    <div class="dir">${meta.director ? "Directed by " + esc(meta.director) : ""}</div>
  </div>
  <div class="scene">
    <div class="sceneno">SC. ${esc(meta.scene)}</div>
    <div class="slug">${esc(slugline())}</div>
    <div class="meta">${meta.pages ? esc(meta.pages) + " pages" : ""}${
      meta.pages && meta.shootDay ? " &middot; " : ""
    }${meta.shootDay ? "Day " + esc(meta.shootDay) : ""}</div>
  </div>
</div>
<table>
  <thead><tr>
    <th style="width:8%">Setup</th><th style="width:6%">Size</th><th style="width:11%">Subject</th>
    <th style="width:15%">Angle</th><th style="width:7%">Lens</th><th style="width:11%">Movement</th>
    <th style="width:11%">Support</th><th style="width:6%">Est</th><th>Notes</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="7">${shots.length} setups</td><td class="num">${totalEst}</td><td>minutes estimated</td>
  </tr></tfoot>
</table>
<div class="foot">
  <span>Setup letters skip I and O. A second camera on the same setup shares the slate and is marked by camera letter.</span>
  <span>${new Date().toLocaleDateString()}</span>
</div>
</body></html>`;
  };

  const printShotList = () => {
    const html = buildShotListHtml();
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    } else {
      download(`shot-list-sc${meta.scene}.html`, html, "text/html");
    }
  };

  const importScene = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (Array.isArray(data.objects)) {
          setObjects(data.objects);
          setLine(data.line || { on: true, auto: true, a: null, b: null, side: 1 });
          if (data.meta) setMeta((m) => ({ ...m, ...data.meta }));
          setSelected(null);
        }
      } catch (err) {
        console.error("Could not read that file", err);
      }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  /* ============================================================
     Render
     ============================================================ */

  const sel = selected ? byId[selected] : null;
  const C = paper ? PAPER : COLORS;
  const px = (n) => n / view.scale; // stroke widths that stay constant on screen

  const lineGeo = () => {
    if (!linePair) return null;
    const A = byId[linePair[0]];
    const B = byId[linePair[1]];
    if (!A || !B) return null;
    const u = norm({ x: B.x - A.x, y: B.y - A.y });
    const far = 400;
    const p1 = { x: A.x - u.x * far, y: A.y - u.y * far };
    const p2 = { x: B.x + u.x * far, y: B.y + u.y * far };
    return { p1, p2 };
  };
  const lg = lineGeo();

  return (
    <div className="w-full h-screen flex flex-col select-none" style={{ background: COLORS.ink, color: COLORS.text }}>
      {/* top bar */}
      <header
        className="flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{ background: COLORS.panel, borderBottom: `1px solid ${COLORS.rule}` }}
      >
        <div className="mr-3">
          <div className="text-xs font-bold tracking-widest uppercase" style={{ color: COLORS.camera }}>
            Blocking Board
          </div>
          <div className="text-xs" style={{ color: COLORS.dim }}>
            top down camera plan
          </div>
        </div>
        <Btn onClick={addActor}>Add actor</Btn>
        <Btn onClick={addCamera}>Add camera</Btn>
        <Btn onClick={() => setPane("stencils")}>Set pieces</Btn>
        <Btn
          onClick={() => setLine((l) => ({ ...l, on: !l.on }))}
          disabled={actors.length < 2}
          active={line.on}
        >
          180 line {line.on ? "on" : "off"}
        </Btn>
        <Btn onClick={buildCoverage} disabled={!linePair} accent>
          Build coverage
        </Btn>
        <div className="flex-1" />
        <Btn onClick={() => setPaper((v) => !v)}>{paper ? "Paper" : "Dark"}</Btn>
        <Btn onClick={() => setShowCones((s) => !s)}>{showCones ? "Hide lenses" : "Show lenses"}</Btn>
        <Btn onClick={() => setView((v) => ({ ...v, scale: Math.min(70, v.scale * 1.2) }))}>+</Btn>
        <Btn onClick={() => setView((v) => ({ ...v, scale: Math.max(4, v.scale / 1.2) }))}>&minus;</Btn>
        <Btn onClick={printShotList} accent>
          Print shot list
        </Btn>
        <Btn onClick={exportShotList}>Export CSV</Btn>
        <Btn onClick={exportScene}>Save scene</Btn>
        <Btn onClick={() => fileRef.current.click()}>Open scene</Btn>
        <input ref={fileRef} type="file" accept="application/json" onChange={importScene} className="hidden" />
      </header>

      <div className="flex-1 flex min-h-0">
        {/* canvas */}
        <div className="flex-1 relative min-w-0">
          <svg
            ref={svgRef}
            className="w-full h-full touch-none"
            style={{ cursor: drag.current?.mode === "pan" ? "grabbing" : "default" }}
            onPointerDown={onCanvasDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <rect x="0" y="0" width="100%" height="100%" fill={C.ink} />
            <defs>
              <pattern id="fine" width={view.scale} height={view.scale} patternUnits="userSpaceOnUse">
                <path d={`M ${view.scale} 0 L 0 0 0 ${view.scale}`} fill="none" stroke={C.ruleSoft} strokeWidth="1" />
              </pattern>
              <pattern id="coarse" width={view.scale * 5} height={view.scale * 5} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${view.scale * 5} 0 L 0 0 0 ${view.scale * 5}`}
                  fill="none"
                  stroke={C.rule}
                  strokeWidth="1"
                />
              </pattern>
            </defs>

            <g transform={`translate(${view.x % (view.scale * 5)} ${view.y % (view.scale * 5)})`}>
              <rect x={-view.scale * 5} y={-view.scale * 5} width="400%" height="400%" fill="url(#fine)" />
              <rect x={-view.scale * 5} y={-view.scale * 5} width="400%" height="400%" fill="url(#coarse)" />
            </g>

            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              {/* line of action */}
              {lg && (
                <line
                  x1={lg.p1.x}
                  y1={lg.p1.y}
                  x2={lg.p2.x}
                  y2={lg.p2.y}
                  stroke={C.bad}
                  strokeWidth={px(1.5)}
                  strokeDasharray={`${px(8)} ${px(6)}`}
                />
              )}

              {/* set pieces */}
              {objects
                .filter((o) => o.type === "prop")
                .map((o) => (
                  <g key={o.id} transform={`translate(${o.x} ${o.y}) rotate(${o.rot})`}>
                    {o.src ? (
                      <image
                        href={o.src}
                        x={-o.w / 2}
                        y={-o.d / 2}
                        width={o.w}
                        height={o.d}
                        preserveAspectRatio="none"
                        style={{
                          pointerEvents: "none",
                          filter: o.tint === "light" && !paper ? "invert(1)" : "none",
                          opacity: 0.92,
                        }}
                      />
                    ) : (
                      <rect
                        x={-o.w / 2}
                        y={-o.d / 2}
                        width={o.w}
                        height={o.d}
                        rx={0.15}
                        fill="rgba(91,114,134,0.25)"
                        stroke={C.prop}
                        strokeWidth={px(1.2)}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    <rect
                      x={-o.w / 2}
                      y={-o.d / 2}
                      width={o.w}
                      height={o.d}
                      fill="transparent"
                      stroke={selected === o.id ? C.select : "transparent"}
                      strokeWidth={px(selected === o.id ? 1.5 : 0)}
                      strokeDasharray={`${px(5)} ${px(4)}`}
                      onPointerDown={(e) => onObjectDown(e, o, "move")}
                      style={{ cursor: "move" }}
                    />
                    <text
                      x="0"
                      y={o.d / 2 + 0.9}
                      textAnchor="middle"
                      fill={C.dim}
                      fontSize={0.75}
                      style={{ pointerEvents: "none" }}
                    >
                      {o.name}
                    </text>
                    {selected === o.id && (
                      <>
                        <Handle x={0} y={-o.d / 2 - 1.6} px={px} c={C} onDown={(e) => onObjectDown(e, o, "rotate")} />
                        <rect
                          x={o.w / 2 - 0.32}
                          y={o.d / 2 - 0.32}
                          width={0.64}
                          height={0.64}
                          fill={C.camera}
                          stroke={C.ink}
                          strokeWidth={px(1)}
                          onPointerDown={(e) => onObjectDown(e, o, "resize")}
                          style={{ cursor: "nwse-resize" }}
                        />
                      </>
                    )}
                  </g>
                ))}

              {/* actors */}
              {actors.map((o) => {
                const f = facing(o.rot);
                const isLineEnd = !!linePair && (linePair[0] === o.id || linePair[1] === o.id);
                const r = 0.95 * Math.max(0.55, Math.min(1.5, (o.height || SUBJECT_HEIGHT) / SUBJECT_HEIGHT));
                return (
                  <g key={o.id}>
                    {/* eyeline */}
                    <line
                      x1={o.x}
                      y1={o.y}
                      x2={o.x + f.x * 6}
                      y2={o.y + f.y * 6}
                      stroke={C.actor}
                      strokeWidth={px(1)}
                      strokeDasharray={`${px(3)} ${px(4)}`}
                      opacity="0.5"
                    />
                    {isLineEnd && (
                      <circle
                        cx={o.x}
                        cy={o.y}
                        r={r + 0.5}
                        fill="none"
                        stroke={C.bad}
                        strokeWidth={px(1.2)}
                        opacity="0.65"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    <circle
                      cx={o.x}
                      cy={o.y}
                      r={r}
                      fill="rgba(79,209,197,0.18)"
                      stroke={selected === o.id ? C.select : C.actor}
                      strokeWidth={px(isLineEnd ? 3 : 2)}
                      onPointerDown={(e) => onObjectDown(e, o, "move")}
                      style={{ cursor: "move" }}
                    />
                    <polygon
                      points={`${o.x + f.x * 1.5},${o.y + f.y * 1.5} ${o.x + f.x * 0.6 - f.y * 0.45},${
                        o.y + f.y * 0.6 + f.x * 0.45
                      } ${o.x + f.x * 0.6 + f.y * 0.45},${o.y + f.y * 0.6 - f.x * 0.45}`}
                      fill={C.actor}
                      style={{ pointerEvents: "none" }}
                    />
                    <text
                      x={o.x}
                      y={o.y - 1.5}
                      textAnchor="middle"
                      fill={C.actor}
                      fontSize={0.85}
                      fontWeight="600"
                      style={{ pointerEvents: "none" }}
                    >
                      {o.name}
                    </text>
                    {selected === o.id && (
                      <>
                        <Handle
                          x={o.x + f.x * 2.6}
                          y={o.y + f.y * 2.6}
                          px={px}
                          c={C}
                          onDown={(e) => onObjectDown(e, o, "rotate")}
                        />
                        <rect
                          x={o.x + r * 0.72 - 0.3}
                          y={o.y + r * 0.72 - 0.3}
                          width={0.6}
                          height={0.6}
                          fill={C.camera}
                          stroke={C.ink}
                          strokeWidth={px(1)}
                          onPointerDown={(e) => onObjectDown(e, o, "resize")}
                          style={{ cursor: "nwse-resize" }}
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {/* cameras */}
              {cameras.map((o) => {
                const h = headingFor(o);
                const f = facing(h);
                const s = SENSORS[o.sensor];
                const half = deg(Math.atan(s.w / (2 * o.focal)));
                const reach = Math.max(6, o.linkTo && byId[o.linkTo] ? dist(o, byId[o.linkTo]) * 1.25 : 12);
                const l = facing(h - half);
                const r = facing(h + half);
                const bad = crossesLine(o);
                const stroke = selected === o.id ? C.select : bad ? C.bad : C.camera;
                return (
                  <g key={o.id}>
                    {showCones && (
                      <polygon
                        points={`${o.x},${o.y} ${o.x + l.x * reach},${o.y + l.y * reach} ${o.x + r.x * reach},${
                          o.y + r.y * reach
                        }`}
                        fill={C.cameraSoft}
                        stroke="none"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    <polygon
                      points={`${o.x + f.x * 1.1},${o.y + f.y * 1.1} ${o.x - f.x * 0.7 - f.y * 0.8},${
                        o.y - f.y * 0.7 + f.x * 0.8
                      } ${o.x - f.x * 0.7 + f.y * 0.8},${o.y - f.y * 0.7 - f.x * 0.8}`}
                      fill="rgba(232,163,61,0.35)"
                      stroke={stroke}
                      strokeWidth={px(2)}
                      onPointerDown={(e) => onObjectDown(e, o, "move")}
                      style={{ cursor: "move" }}
                    />
                    <text
                      x={o.x - f.x * 1.9}
                      y={o.y - f.y * 1.9 + 0.3}
                      textAnchor="middle"
                      fill={bad ? C.bad : C.camera}
                      fontSize={0.9}
                      fontWeight="700"
                      style={{ pointerEvents: "none" }}
                    >
                      {o.name}
                    </text>
                    {selected === o.id && (
                      <Handle
                        x={o.x + f.x * 2.4}
                        y={o.y + f.y * 2.4}
                        px={px}
                        onDown={(e) => onObjectDown(e, o, "rotate")}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          <div
            className="absolute bottom-3 left-3 text-xs px-2 py-1 rounded"
            style={{ background: "rgba(13,18,24,0.8)", color: COLORS.dim }}
          >
            {view.scale.toFixed(0)} px per foot. Grid square = 1 ft, heavy line = 5 ft. Drag empty space to pan, scroll to zoom.
          </div>
        </div>

        {/* right panel */}
        <aside
          className="w-80 shrink-0 flex flex-col min-h-0"
          style={{ background: COLORS.panel, borderLeft: `1px solid ${COLORS.rule}` }}
        >
          <div className="flex" style={{ borderBottom: `1px solid ${COLORS.rule}` }}>
            {["shots", "scene", "stencils", "object", "line"].map((t) => (
              <button
                key={t}
                onClick={() => setPane(t)}
                className="flex-1 px-1 py-2 text-xs uppercase tracking-wider"
                style={{
                  color: pane === t ? COLORS.camera : COLORS.dim,
                  borderBottom: pane === t ? `2px solid ${COLORS.camera}` : "2px solid transparent",
                }}
              >
                {t === "shots"
                  ? "Shots"
                  : t === "scene"
                  ? "Scene"
                  : t === "stencils"
                  ? "Props"
                  : t === "object"
                  ? "Item"
                  : "Line"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {pane === "shots" && (
              <>
                {shots.length === 0 && (
                  <p className="text-xs" style={{ color: COLORS.dim }}>
                    No cameras yet. Add one, or set the line of action between two actors and build a coverage
                    template.
                  </p>
                )}
                {shots.map((s) => (
                  <div
                    key={s.cam.id}
                    onClick={() => {
                      setSelected(s.cam.id);
                      setPane("object");
                    }}
                    className="p-2 rounded cursor-pointer"
                    style={{
                      background: selected === s.cam.id ? COLORS.panelHi : "transparent",
                      border: `1px solid ${s.crossing ? COLORS.bad : COLORS.rule}`,
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold font-mono" style={{ color: COLORS.text }}>
                        {s.slate}
                      </span>
                      {s.multicam && (
                        <span
                          className="text-xs font-bold px-1 rounded"
                          style={{ border: `1px solid ${COLORS.dim}`, color: COLORS.dim }}
                        >
                          {s.camLetter}
                        </span>
                      )}
                      <span className="text-sm font-bold" style={{ color: COLORS.camera }}>
                        {s.size.code}
                      </span>
                      <span className="text-sm">{s.subject ? s.subject.name : ""}</span>
                      <span className="ml-auto text-xs font-mono" style={{ color: COLORS.dim }}>
                        {s.cam.focal}mm
                      </span>
                    </div>
                    <div className="text-xs mt-1" style={{ color: COLORS.dim }}>
                      {s.rel} {s.rel && "\u00b7"} {s.height} {"\u00b7"} {s.cam.move} {"\u00b7"} {s.cam.support}
                    </div>
                    {s.cam.notes && (
                      <div className="text-xs mt-1" style={{ color: COLORS.text }}>
                        {s.cam.notes}
                      </div>
                    )}
                    {s.crossing && (
                      <div className="text-xs mt-1 font-semibold" style={{ color: COLORS.bad }}>
                        Crosses the line of action
                      </div>
                    )}
                    <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                      <Btn onClick={() => moveShot(s.cam.id, -1)}>Up</Btn>
                      <Btn onClick={() => moveShot(s.cam.id, 1)}>Down</Btn>
                      <span className="ml-auto text-xs font-mono self-center" style={{ color: COLORS.dim }}>
                        {s.cam.est} min
                      </span>
                    </div>
                  </div>
                ))}
                {shots.length > 0 && (
                  <div className="text-xs pt-2" style={{ color: COLORS.dim, borderTop: `1px solid ${COLORS.rule}` }}>
                    {shots.length} setups {"\u00b7"} {totalEst} minutes estimated {"\u00b7"} shooting order sets the
                    slate letters
                  </div>
                )}
              </>
            )}

            {pane === "stencils" && (
              <div className="space-y-3">
                <input
                  value={stencilQuery}
                  onChange={(e) => setStencilQuery(e.target.value)}
                  placeholder="Search stencils"
                  className="w-full px-2 py-1 rounded text-sm"
                  style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                />
                <div className="flex gap-2">
                  <Btn onClick={() => pngRef.current.click()}>Import PNGs</Btn>
                  <Btn onClick={addProp}>Blank footprint</Btn>
                </div>
                <input
                  ref={pngRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/webp"
                  multiple
                  onChange={importPngs}
                  className="hidden"
                />
                <p className="text-xs" style={{ color: COLORS.dim }}>
                  {catalogNote}
                </p>

                {stencilGroups.length === 0 && (
                  <p className="text-xs" style={{ color: COLORS.dim }}>
                    Nothing matches that search.
                  </p>
                )}

                {stencilGroups.map(([category, items]) => (
                  <div key={category}>
                    <div className="text-xs uppercase tracking-widest mb-1" style={{ color: COLORS.dim }}>
                      {category}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {items.map((st) => (
                        <button
                          key={st.id}
                          onClick={() => placeStencil(st)}
                          title={`${st.name}, ${st.w} by ${st.d} ft`}
                          className="p-1 rounded flex flex-col items-center gap-1"
                          style={{ background: COLORS.panelHi, border: `1px solid ${COLORS.rule}` }}
                        >
                          <img
                            src={st.file}
                            alt={st.name}
                            className="w-full h-10 object-contain rounded"
                            style={{ background: "#e8e4dc", padding: "2px" }}
                          />
                          <span className="text-xs leading-tight text-center" style={{ color: COLORS.text }}>
                            {st.name}
                          </span>
                          <span className="text-xs font-mono" style={{ color: COLORS.dim }}>
                            {st.w}x{st.d}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pane === "scene" && (
              <div className="space-y-3">
                <Field label="Production">
                  <Txt value={meta.production} onChange={(v) => setMeta((m) => ({ ...m, production: v }))} />
                </Field>
                <Field label="Director">
                  <Txt value={meta.director} onChange={(v) => setMeta((m) => ({ ...m, director: v }))} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Scene number">
                    <Txt value={meta.scene} onChange={(v) => setMeta((m) => ({ ...m, scene: v }))} />
                  </Field>
                  <Field label="Int or Ext">
                    <Sel
                      value={meta.intExt}
                      options={["INT.", "EXT.", "INT./EXT."]}
                      onChange={(v) => setMeta((m) => ({ ...m, intExt: v }))}
                    />
                  </Field>
                </div>
                <Field label="Location">
                  <Txt value={meta.location} onChange={(v) => setMeta((m) => ({ ...m, location: v }))} />
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Time">
                    <Sel
                      value={meta.timeOfDay}
                      options={["DAY", "NIGHT", "DUSK", "DAWN", "CONTINUOUS"]}
                      onChange={(v) => setMeta((m) => ({ ...m, timeOfDay: v }))}
                    />
                  </Field>
                  <Field label="Pages">
                    <Txt value={meta.pages} onChange={(v) => setMeta((m) => ({ ...m, pages: v }))} />
                  </Field>
                  <Field label="Day">
                    <Txt value={meta.shootDay} onChange={(v) => setMeta((m) => ({ ...m, shootDay: v }))} />
                  </Field>
                </div>
                <p className="text-xs pt-1" style={{ color: COLORS.dim, borderTop: `1px solid ${COLORS.rule}` }}>
                  Slate preview: the first setup is <span className="font-mono">{meta.scene || "1"}</span>, then{" "}
                  <span className="font-mono">
                    {["", "A", "B", "C"].slice(1).map((l) => `${meta.scene || "1"}${l}`).join(", ")}
                  </span>
                  . Letters I and O are skipped, and after Z they double to AA, BB.
                </p>
                <Btn onClick={printShotList} accent>
                  Print shot list
                </Btn>
              </div>
            )}

            {pane === "object" && !sel && (
              <p className="text-xs" style={{ color: COLORS.dim }}>
                Select something in the plan to edit it.
              </p>
            )}

            {pane === "object" && sel && (
              <div className="space-y-3">
                <Field label="Name">
                  <input
                    value={sel.name}
                    onChange={(e) => patch(sel.id, { name: e.target.value })}
                    className="w-full px-2 py-1 rounded text-sm"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="X (ft)">
                    <Num value={sel.x} step={0.5} onChange={(v) => moveObject(sel.id, v, sel.y)} />
                  </Field>
                  <Field label="Y (ft)">
                    <Num value={sel.y} step={0.5} onChange={(v) => moveObject(sel.id, sel.x, v)} />
                  </Field>
                </div>

                <Field label={`Heading ${Math.round(headingFor(sel))}\u00b0`}>
                  <input
                    type="range"
                    min="0"
                    max="359"
                    value={Math.round(headingFor(sel))}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (sel.type === "camera") patch(sel.id, { rot: v, aim: false });
                      else rotateObject(sel.id, v);
                    }}
                    className="w-full"
                  />
                </Field>

                {sel.type === "camera" && (
                  <>
                    <Field label="Lens">
                      <select
                        value={sel.focal}
                        onChange={(e) => patch(sel.id, { focal: +e.target.value })}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        {LENSES.map((l) => (
                          <option key={l} value={l}>
                            {l}mm
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Sensor">
                      <select
                        value={sel.sensor}
                        onChange={(e) => patch(sel.id, { sensor: e.target.value })}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        {Object.keys(SENSORS).map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`Lens height ${sel.height.toFixed(1)} ft, ${heightNote(sel.height)}`}>
                      <input
                        type="range"
                        min="0.5"
                        max="12"
                        step="0.1"
                        value={sel.height}
                        onChange={(e) => patch(sel.id, { height: +e.target.value })}
                        className="w-full"
                      />
                    </Field>
                    <Field label="Movement">
                      <select
                        value={sel.move}
                        onChange={(e) => patch(sel.id, { move: e.target.value })}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        {MOVES.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Support">
                        <Sel
                          value={sel.support}
                          options={SUPPORTS}
                          onChange={(v) => patch(sel.id, { support: v })}
                        />
                      </Field>
                      <Field label="Est. minutes">
                        <Num value={sel.est} step={5} onChange={(v) => patch(sel.id, { est: Math.max(0, v) })} />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-xs" style={{ color: COLORS.dim }}>
                      <input
                        type="checkbox"
                        checked={!!sel.sameSetup}
                        onChange={(e) => patch(sel.id, { sameSetup: e.target.checked })}
                      />
                      Second camera on the previous setup
                    </label>
                    <Field label="Locked to actor">
                      <select
                        value={sel.linkTo || ""}
                        onChange={(e) => patch(sel.id, { linkTo: e.target.value || null })}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        <option value="">None</option>
                        {actors.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 text-xs" style={{ color: COLORS.dim }}>
                      <input
                        type="checkbox"
                        checked={!!sel.aim}
                        disabled={!sel.linkTo}
                        onChange={(e) => patch(sel.id, { aim: e.target.checked })}
                      />
                      Keep pointed at that actor
                    </label>
                    <Field label="Notes">
                      <textarea
                        value={sel.notes}
                        onChange={(e) => patch(sel.id, { notes: e.target.value })}
                        rows={3}
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      />
                    </Field>
                  </>
                )}

                {sel.type === "prop" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Width (ft)">
                        <Num value={sel.w} step={0.5} onChange={(v) => patch(sel.id, { w: Math.max(0.5, v) })} />
                      </Field>
                      <Field label="Depth (ft)">
                        <Num value={sel.d} step={0.5} onChange={(v) => patch(sel.id, { d: Math.max(0.5, v) })} />
                      </Field>
                    </div>
                    {sel.src && (
                      <>
                        <Field label="Artwork">
                          <select
                            value={sel.tint}
                            onChange={(e) => patch(sel.id, { tint: e.target.value })}
                            className="w-full px-2 py-1 rounded text-sm"
                            style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                          >
                            <option value="light">Invert, for black line art</option>
                            <option value="none">Leave as drawn</option>
                          </select>
                        </Field>
                        <Btn onClick={() => patch(sel.id, { src: null, stencilId: null, tint: "none" })}>
                          Replace with plain box
                        </Btn>
                      </>
                    )}
                  </>
                )}

                {sel.type === "actor" && (
                  <>
                    <Field label={`Subject height ${(sel.height || SUBJECT_HEIGHT).toFixed(1)} ft`}>
                      <input
                        type="range"
                        min="1.5"
                        max="9"
                        step="0.1"
                        value={sel.height || SUBJECT_HEIGHT}
                        onChange={(e) => patch(sel.id, { height: +e.target.value })}
                        className="w-full"
                      />
                    </Field>
                    <p className="text-xs" style={{ color: COLORS.dim }}>
                      Height feeds the framing math, so a child or a seated actor reports the shot size the lens
                      actually delivers.
                    </p>
                    <div className="flex gap-2">
                      <Btn onClick={() => setLine((l) => ({ ...l, on: true, auto: false, a: sel.id }))}>
                        Set as line A
                      </Btn>
                      <Btn onClick={() => setLine((l) => ({ ...l, on: true, auto: false, b: sel.id }))}>
                        Set as line B
                      </Btn>
                    </div>
                  </>
                )}

                <Btn onClick={() => removeObject(sel.id)} danger>
                  Delete
                </Btn>
              </div>
            )}

            {pane === "line" && (
              <div className="space-y-3 text-sm">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={line.on}
                    disabled={actors.length < 2}
                    onChange={(e) => setLine((l) => ({ ...l, on: e.target.checked }))}
                  />
                  Show the 180 line
                </label>
                {actors.length < 2 && (
                  <p className="text-xs" style={{ color: COLORS.dim }}>
                    Add a second actor to set an axis.
                  </p>
                )}

                <div className="flex gap-2">
                  <Btn onClick={() => setLine((l) => ({ ...l, auto: true }))} active={line.auto} disabled={!line.on}>
                    Pick the pair for me
                  </Btn>
                  <Btn onClick={() => setLine((l) => ({ ...l, auto: false }))} active={!line.auto} disabled={!line.on}>
                    Choose myself
                  </Btn>
                </div>

                <p className="text-xs" style={{ color: COLORS.dim }}>
                  {line.on && linePair
                    ? `Axis running through ${byId[linePair[0]].name} and ${byId[linePair[1]].name}. It stays glued to them as they move. Cameras on the shaded side are flagged as crossing.`
                    : "The axis is the relationship between two actors. Everything on the shaded side is a crossed line."}
                </p>

                {line.auto && (
                  <p className="text-xs" style={{ color: COLORS.dim }}>
                    Automatic pick goes to the two actors who are closest to facing each other. Everyone else stays
                    off the axis.
                  </p>
                )}

                <Field label="Actor A">
                  <select
                    value={(line.auto && linePair ? linePair[0] : line.a) || ""}
                    disabled={!line.on || line.auto}
                    onChange={(e) => setLine((l) => ({ ...l, a: e.target.value || null }))}
                    className="w-full px-2 py-1 rounded text-sm"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  >
                    <option value="">None</option>
                    {actors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Actor B">
                  <select
                    value={(line.auto && linePair ? linePair[1] : line.b) || ""}
                    disabled={!line.on || line.auto}
                    onChange={(e) => setLine((l) => ({ ...l, b: e.target.value || null }))}
                    className="w-full px-2 py-1 rounded text-sm"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  >
                    <option value="">None</option>
                    {actors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Btn onClick={() => setLine((l) => ({ ...l, side: l.side * -1 }))} disabled={!linePair}>
                  Flip working side
                </Btn>
                <Btn onClick={buildCoverage} disabled={!linePair} accent>
                  Build standard coverage
                </Btn>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function Btn({ children, onClick, disabled, accent, danger, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 rounded text-xs font-medium"
      style={{
        background: danger
          ? "rgba(229,72,77,0.15)"
          : accent
          ? "rgba(232,163,61,0.18)"
          : active
          ? "rgba(79,209,197,0.18)"
          : COLORS.panelHi,
        color: disabled ? COLORS.dim : danger ? COLORS.bad : accent ? COLORS.camera : active ? COLORS.actor : COLORS.text,
        border: `1px solid ${danger ? COLORS.bad : accent ? COLORS.camera : active ? COLORS.actor : COLORS.rule}`,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider mb-1" style={{ color: COLORS.dim }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Txt({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 rounded text-sm"
      style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
    />
  );
}

function Sel({ value, options, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 rounded text-sm"
      style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function Num({ value, step, onChange }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(+e.target.value)}
      className="w-full px-2 py-1 rounded text-sm font-mono"
      style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
    />
  );
}

function Handle({ x, y, px, onDown, c = COLORS }) {
  return (
    <circle
      cx={x}
      cy={y}
      r={0.42}
      fill={c.select}
      stroke={c.ink}
      strokeWidth={px(1)}
      onPointerDown={onDown}
      style={{ cursor: "grab" }}
    />
  );
}
