import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import PrevisWindow, { renderPrevisFrame } from "./PrevisWindow";
import {
  CINEMATOGRAPHY,
  DIRECTOR,
  LAYER_SCHEMA_VERSION,
  migrateSceneDocument,
  normalizeLayerContext,
  resolveLayerPresentation,
  stencilPaletteGroup,
  stencilIsAvailableInMode,
  withStencilRole,
  withLayerDefaults,
} from "./layerSystem";
import {
  buildSceneShareUrl,
  MAX_SHARE_URL_LENGTH,
  sceneFromShareHash,
} from "./sceneShare";
import {
  PREVIS_CAST,
  PREVIS_HAIR_COLORS,
  PREVIS_HAIR_STYLES,
  PREVIS_SKIN_TONES,
  PREVIS_WARDROBES,
  PREVIS_ASPECT_RATIOS,
  profilePatch,
} from "./previsCast";
import {
  motionPathDuration,
  motionPathSvg,
  normalizeHeading,
  sampleMotionPath,
} from "./motionPath";

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

const TECHNICAL_STENCILS = [
  {
    id: "cinema/camera-rig",
    name: "Cinema camera rig",
    category: "Camera rigs",
    targetMode: CINEMATOGRAPHY,
    technicalFamily: "CAMERA",
    searchTags: ["camera", "rig", "fov", "tripod"],
    w: 3.2,
    d: 2.3,
    tint: "light",
    file: stencilArt(`<rect x="12" y="34" width="76" height="38" rx="8"/><circle cx="50" cy="53" r="13"/><path d="M24 73l-9 17M50 73v17M76 73l9 17M88 44h9"/>`),
  },
  {
    id: "cinema/led-panel",
    name: "LED panel",
    category: "Lighting",
    targetMode: CINEMATOGRAPHY,
    technicalFamily: "LIGHTING",
    searchTags: ["light", "led", "panel", "key", "fill"],
    w: 2.5,
    d: 1.2,
    tint: "light",
    file: stencilArt(`<rect x="16" y="20" width="68" height="40" rx="3"/><path d="M50 60v24M32 84h36"/>`),
  },
  {
    id: "cinema/c-stand",
    name: "C-stand",
    category: "Grip",
    targetMode: CINEMATOGRAPHY,
    technicalFamily: "GRIP",
    searchTags: ["c-stand", "grip", "stand", "flag"],
    w: 2,
    d: 2,
    tint: "light",
    file: stencilArt(`<path d="M50 8v74M24 92h52M33 82l-16 10M67 82l16 10M50 26h33M83 18v16"/>`),
  },
  {
    id: "cinema/dolly-track",
    name: "Dolly track",
    category: "Movement",
    targetMode: CINEMATOGRAPHY,
    technicalFamily: "MOVEMENT",
    searchTags: ["dolly", "track", "move", "camera"],
    w: 8,
    d: 1.8,
    tint: "light",
    file: stencilArt(`<path d="M10 30h80M10 70h80M20 22v56M40 22v56M60 22v56M80 22v56"/>`),
  },
  {
    id: "cinema/diffusion",
    name: "Diffusion frame",
    category: "Grip",
    targetMode: CINEMATOGRAPHY,
    technicalFamily: "GRIP",
    searchTags: ["diffusion", "silk", "frame", "grip"],
    w: 5,
    d: 0.4,
    tint: "light",
    file: stencilArt(`<rect x="10" y="14" width="80" height="56"/><path d="M10 14l80 56M90 14L10 70M26 70v20M74 70v20"/>`),
  },
  {
    id: "cinema/truss",
    name: "Truss",
    category: "Rigging",
    targetMode: CINEMATOGRAPHY,
    technicalFamily: "RIGGING",
    searchTags: ["truss", "rigging", "overhead", "grid"],
    w: 8,
    d: 1,
    tint: "light",
    file: stencilArt(`<path d="M8 24h84M8 76h84M12 24l20 52M32 24l20 52M52 24l20 52M72 24l20 52M12 76l20-52M32 76l20-52M52 76l20-52M72 76l20-52"/>`),
  },
];

const DEFAULT_STENCILS = [
  ...FALLBACK_STENCILS.map((stencil) => ({ ...stencil, targetMode: DIRECTOR, technicalFamily: "BLOCKING" })),
  ...TECHNICAL_STENCILS,
];

const PALETTE_TABS = {
  [DIRECTOR]: [
    { id: "director-all", label: "All essentials", description: "The complete director staging kit." },
    { id: "director-set", label: "Set & furniture", description: "Furniture, fixtures, and practical set pieces." },
    { id: "director-space", label: "Architecture", description: "Rooms, doors, walls, and location geometry." },
    { id: "director-location", label: "Locations", description: "Exterior, vehicles, and location markers." },
  ],
  [CINEMATOGRAPHY]: [
    { id: "technical-all", label: "All technical", description: "The complete camera, lighting, grip, and rigging catalog." },
    { id: "technical-camera", label: "Camera", description: "Bodies, rigs, and movement tools." },
    { id: "technical-lighting", label: "Lighting", description: "LED, HMI, fluorescent, tungsten, and practical fixtures." },
    { id: "technical-control", label: "Light control", description: "Rags, frames, boards, and bounce control." },
    { id: "technical-grip", label: "Grip & rigging", description: "Support, rigging, stands, and overhead systems." },
    { id: "technical-staging", label: "Set & staging", description: "Shared director assets for a complete technical plan." },
  ],
};

const DIRECTOR_SET_CATEGORIES = new Set(["Furniture", "Fixtures", "Misc", "Labels"]);
const DIRECTOR_SPACE_CATEGORIES = new Set(["Architecture", "Rooms & Spaces"]);
const DIRECTOR_LOCATION_CATEGORIES = new Set(["Exterior", "Vehicles"]);

const stencilMatchesPalette = (stencil, focus) => {
  const classified = withStencilRole(stencil);
  const group = stencilPaletteGroup(classified);
  if (focus === "director-all") return classified.targetMode !== CINEMATOGRAPHY;
  if (focus === "director-set") return classified.targetMode !== CINEMATOGRAPHY && DIRECTOR_SET_CATEGORIES.has(classified.category);
  if (focus === "director-space") return classified.targetMode !== CINEMATOGRAPHY && DIRECTOR_SPACE_CATEGORIES.has(classified.category);
  if (focus === "director-location") return classified.targetMode !== CINEMATOGRAPHY && DIRECTOR_LOCATION_CATEGORIES.has(classified.category);
  if (focus === "technical-all") return classified.targetMode === CINEMATOGRAPHY;
  if (focus === "technical-camera") return group === "CAMERA" || group === "MOVEMENT";
  if (focus === "technical-lighting") return group === "LIGHTING";
  if (focus === "technical-control") return group === "LIGHT_CONTROL";
  if (focus === "technical-grip") return group === "GRIP_RIGGING";
  if (focus === "technical-staging") return classified.targetMode !== CINEMATOGRAPHY;
  return true;
};

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundTo = (value, step = 0.5) => Math.round(value / step) * step;
const samePoint = (a, b, tolerance = 0.04) => !!a && !!b && dist(a, b) <= tolerance;
const wallLength = (wall) => dist(wall.a, wall.b);
const wallPoint = (wall, t) => ({
  x: wall.a.x + (wall.b.x - wall.a.x) * t,
  y: wall.a.y + (wall.b.y - wall.a.y) * t,
});
const wallAngle = (wall) => deg(Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x));

const projectToWall = (point, wall) => {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const rawT = ((point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy) / lengthSquared;
  const t = clamp(rawT, 0, 1);
  const projected = wallPoint(wall, t);
  return { t, point: projected, distance: dist(point, projected) };
};

const openingRange = (opening, wall) => {
  const length = Math.max(wallLength(wall), 0.01);
  const half = (Number(opening.width) || 0) / (2 * length);
  return { start: clamp(opening.t - half, 0, 1), end: clamp(opening.t + half, 0, 1) };
};

const wallSegments = (wall, openings) => {
  const ranges = openings
    .filter((opening) => opening.wallId === wall.id)
    .map((opening) => openingRange(opening, wall))
    .sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor + 0.002) segments.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  });
  if (cursor < 0.998) segments.push({ start: cursor, end: 1 });
  return segments;
};

const doorArcPath = (width, hinge, swing) => {
  const hingeX = hinge === "end" ? width / 2 : -width / 2;
  const leafX = hinge === "end" ? -width / 2 : width / 2;
  const sweep = `${hinge === "end" ? (swing === "out" ? 0 : 1) : swing === "out" ? 1 : 0}`;
  const y = swing === "out" ? -width : width;
  return `M ${hingeX} 0 A ${width} ${width} 0 0 ${sweep} ${leafX} ${y}`;
};

const motionMarks = (object) => (Array.isArray(object?.motionPath) ? object.motionPath : []);
const motionDuration = (object) => motionPathDuration(motionMarks(object));
const cameraMotionMarks = motionMarks;
const cameraMotionDuration = motionDuration;
const actorMotionMarks = motionMarks;
const actorMotionDuration = motionDuration;

const motionMark = (camera, id = uid("m"), overrides = {}) => ({
  id,
  x: Number.isFinite(camera?.x) ? camera.x : 0,
  y: Number.isFinite(camera?.y) ? camera.y : 0,
  rot: normalizeHeading(camera?.rot ?? 0),
  duration: 1.5,
  ...overrides,
});

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
const uid = (p) => `${p}${Date.now().toString(36)}${++seq}`;

const newActor = (x, y, name, gender = "female", profileId = null) => {
  const appearance = profilePatch(profileId || (gender === "male" ? "marcus" : "maya"));
  return withLayerDefaults(
    {
      id: uid("a"),
      type: "actor",
      name,
      x,
      y,
      rot: 180,
      ...appearance,
    },
    DIRECTOR
  );
};

const newCamera = (x, y, name, extra = {}) =>
  withLayerDefaults(
    {
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
      est: "",
      sameSetup: false,
      notes: "",
      linkTo: null,
      aim: true,
      color: "#e8a33d",
      showFov: true,
      previsAspect: "2.39",
      motionPath: [],
      ...extra,
    },
    extra.layerContext || DIRECTOR
  );

const newProp = (x, y, name, st = null, layerContext = DIRECTOR) =>
  withLayerDefaults(
    {
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
      technicalFamily: st?.technicalFamily || null,
    },
    st?.targetMode === CINEMATOGRAPHY ? CINEMATOGRAPHY : layerContext
  );

const STARTER = () => {
  const a = newActor(-4, 0, "ANNA", "female");
  const b = newActor(4, 0, "BEN", "male");
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
  const [walls, setWalls] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedWall, setSelectedWall] = useState(null);
  const [selectedOpening, setSelectedOpening] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 16 });
  const [line, setLine] = useState({ on: true, auto: true, a: null, b: null, side: 1 });
  const [showCones, setShowCones] = useState(true);
  const [paper, setPaper] = useState(true);
  const [pane, setPane] = useState("shots");
  const [wallTool, setWallTool] = useState("select");
  const [wallDraft, setWallDraft] = useState(null);
  const [wallHover, setWallHover] = useState(null);
  const [snap, setSnap] = useState({ grid: true, nodes: true, lines: true, angles: true });
  const [wallDefaults, setWallDefaults] = useState({ thickness: 0.32, style: "solid" });
  const [blueprint, setBlueprint] = useState(null);
  const [previewShot, setPreviewShot] = useState(null);
  const [includePrevisInPrint, setIncludePrevisInPrint] = useState(false);
  const [shareDialog, setShareDialog] = useState(null);
  const [layerMode, setLayerMode] = useState(DIRECTOR);
  const [cinematographyDisplay, setCinematographyDisplay] = useState("hide");
  const [stencils, setStencils] = useState(DEFAULT_STENCILS);
  const [stencilQuery, setStencilQuery] = useState("");
  const [stencilFocus, setStencilFocus] = useState("director-all");
  const [catalogNote, setCatalogNote] = useState("Built in set. No stencil folder found yet.");
  const [history, setHistory] = useState([]);
  const [pathEditCameraId, setPathEditCameraId] = useState(null);
  const [pathEditActorId, setPathEditActorId] = useState(null);
  const [pathPlayback, setPathPlayback] = useState({ cameraId: null, actorId: null, progress: 0, playing: false });
  const [contextMenu, setContextMenu] = useState(null);
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
  const longPress = useRef(null);
  const fileRef = useRef(null);
  const pngRef = useRef(null);
  const blueprintRef = useRef(null);
  const historyRef = useRef([]);
  const lastHistoryRef = useRef({ key: null, at: 0, value: null });
  const sharedSceneLoadedRef = useRef(false);
  const playbackStartedAtRef = useRef(null);
  const playbackFrameRef = useRef(null);

  useEffect(
    () => () => {
      if (longPress.current?.timer) window.clearTimeout(longPress.current.timer);
    },
    []
  );

  const snapshot = useCallback(
    () => JSON.parse(JSON.stringify({ objects, walls, openings, line, meta, blueprint })),
    [objects, walls, openings, line, meta, blueprint]
  );

  const pushSnapshot = useCallback((before, key = "change") => {
    const value = JSON.stringify(before);
    const now = Date.now();
    const last = lastHistoryRef.current;
    if (last.value === value || (last.key === key && now - last.at < 700)) return;
    const next = [...historyRef.current.slice(-49), before];
    historyRef.current = next;
    lastHistoryRef.current = { key, at: now, value };
    setHistory(next);
  }, []);

  const recordUndo = useCallback((key) => pushSnapshot(snapshot(), key), [pushSnapshot, snapshot]);

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    const next = historyRef.current.slice(0, -1);
    historyRef.current = next;
    setHistory(next);
    lastHistoryRef.current = { key: null, at: 0, value: null };
    setObjects(previous.objects);
    setWalls(previous.walls || []);
    setOpenings(previous.openings || []);
    setLine(previous.line);
    setMeta(previous.meta);
    setBlueprint(previous.blueprint || null);
    setSelected(null);
    setSelectedWall(null);
    setSelectedOpening(null);
  }, []);

  const changeLine = useCallback(
    (updater, key = "axis") => {
      recordUndo(key);
      setLine(updater);
    },
    [recordUndo]
  );

  const changeMeta = useCallback(
    (updater, key = "scene") => {
      recordUndo(key);
      setMeta(updater);
    },
    [recordUndo]
  );

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
          .map((s) => withStencilRole({
            id: s.id || s.file,
            name: s.name || "Untitled",
            category: s.category || "Uncategorized",
            w: Number(s.w) > 0 ? Number(s.w) : 3,
            d: Number(s.d) > 0 ? Number(s.d) : 3,
            tint: s.tint || "light",
            file: /^(https?:|data:|\/)/.test(s.file) ? s.file : base + s.file,
            targetMode: s.targetMode,
            technicalFamily: s.technicalFamily,
            searchTags: Array.isArray(s.searchTags) ? s.searchTags : [],
          }));
        if (loaded.length) {
          setStencils([
            ...DEFAULT_STENCILS.filter((builtIn) => !loaded.some((stencil) => stencil.id === builtIn.id)),
            ...loaded,
          ]);
          setCatalogNote(`${loaded.length} stencils loaded from the folder, plus the built-in cinematography library.`);
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

  /* This is the only layer-aware adapter the SVG renderer and pointer pipeline
     need. The core object array, geometry, and event flow remain unchanged. */
  const layerPresentation = useCallback(
    (object) => resolveLayerPresentation(object, layerMode, cinematographyDisplay),
    [cinematographyDisplay, layerMode]
  );

  const canInteractWithObject = useCallback(
    (object) => !!object && layerPresentation(object).interactive,
    [layerPresentation]
  );

  const switchLayerWorkspace = useCallback((nextMode) => {
    setLayerMode(nextMode);
    setStencilFocus(nextMode === CINEMATOGRAPHY ? "technical-all" : "director-all");
    setStencilQuery("");
  }, []);

  useEffect(() => {
    const playbackObjectId = pathPlayback.cameraId || pathPlayback.actorId;
    if (!pathPlayback.playing || !playbackObjectId) return undefined;
    const playbackObject = byId[playbackObjectId];
    const duration = motionDuration(playbackObject);
    if (!playbackObject || motionMarks(playbackObject).length < 2 || duration <= 0) {
      setPathPlayback((current) => ({ ...current, playing: false }));
      return undefined;
    }

    if (playbackStartedAtRef.current == null) {
      playbackStartedAtRef.current = performance.now() - pathPlayback.progress * duration * 1000;
    }

    const tick = (now) => {
      const nextProgress = clamp((now - playbackStartedAtRef.current) / (duration * 1000), 0, 1);
      setPathPlayback((current) => ({ ...current, progress: nextProgress, playing: nextProgress < 1 }));
      if (nextProgress < 1) playbackFrameRef.current = requestAnimationFrame(tick);
      else {
        playbackStartedAtRef.current = null;
        playbackFrameRef.current = null;
      }
    };

    playbackFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (playbackFrameRef.current) cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    };
  }, [byId, pathPlayback.actorId, pathPlayback.cameraId, pathPlayback.playing]);

  const renderNodes = useMemo(
    () =>
      objects
        .map((source) => {
          const isPreviewing =
            (source.type === "camera" && pathPlayback.cameraId === source.id) ||
            (source.type === "actor" && pathPlayback.actorId === source.id);
          const motionPose = isPreviewing && motionMarks(source).length > 1
            ? sampleMotionPath(motionMarks(source), pathPlayback.progress)
            : null;
          return {
            source,
            object: motionPose ? { ...source, ...motionPose } : source,
            presentation: layerPresentation(source),
          };
        })
        .filter(({ presentation }) => presentation.render),
    [layerPresentation, objects, pathPlayback.actorId, pathPlayback.cameraId, pathPlayback.progress]
  );
  const renderedProps = renderNodes.filter(({ object }) => object.type === "prop");
  const renderedActors = renderNodes.filter(({ object }) => object.type === "actor");
  const renderedCameras = renderNodes.filter(({ object }) => object.type === "camera");

  useEffect(() => {
    const current = selected ? byId[selected] : null;
    if (current && layerMode === DIRECTOR && normalizeLayerContext(current.layerContext) === CINEMATOGRAPHY) {
      setSelected(null);
      setPane("shots");
    }
  }, [byId, layerMode, selected]);

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.key === "Delete" || e.key === "Backspace") && (selected || selectedWall || selectedOpening)) {
        e.preventDefault();
        if (selected) removeObject(selected);
        if (selectedWall) removeWall(selectedWall);
        if (selectedOpening) removeOpening(selectedOpening);
      }
      if (e.key === "Escape") {
        setSelected(null);
        setSelectedWall(null);
        setSelectedOpening(null);
        setWallDraft(null);
        setWallHover(null);
        setWallTool("select");
        setPathEditCameraId(null);
        setPathEditActorId(null);
        setContextMenu(null);
        stopCameraPath();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedWall, selectedOpening, objects, walls, openings, undo]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, [contextMenu]);

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

  const nearestWall = useCallback(
    (point, wallId = null) => {
      const candidates = wallId ? walls.filter((wall) => wall.id === wallId) : walls;
      return candidates.reduce((best, wall) => {
        const projection = projectToWall(point, wall);
        return !best || projection.distance < best.distance ? { wall, ...projection } : best;
      }, null);
    },
    [walls]
  );

  const snapWorld = useCallback(
    (point, origin = null) => {
      let next = { ...point };
      if (snap.grid) next = { x: roundTo(next.x), y: roundTo(next.y) };

      if (origin && snap.angles) {
        const dx = next.x - origin.x;
        const dy = next.y - origin.y;
        const length = Math.hypot(dx, dy);
        if (length > 0.05) {
          const angle = Math.atan2(dy, dx);
          const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const delta = Math.abs(((angle - snappedAngle + Math.PI) % (Math.PI * 2)) - Math.PI);
          if (delta < Math.PI / 15) {
            next = { x: origin.x + Math.cos(snappedAngle) * length, y: origin.y + Math.sin(snappedAngle) * length };
            if (snap.grid) next = { x: roundTo(next.x), y: roundTo(next.y) };
          }
        }
      }

      const endpoints = walls.flatMap((wall) => [wall.a, wall.b]);
      if (snap.nodes) {
        const node = endpoints.reduce(
          (best, endpoint) => (!best || dist(next, endpoint) < dist(next, best) ? endpoint : best),
          null
        );
        if (node && dist(next, node) <= 0.72) next = { ...node };
      }

      if (snap.lines) {
        const hit = nearestWall(next);
        if (hit && hit.distance <= 0.42 && (!snap.nodes || !endpoints.some((endpoint) => samePoint(endpoint, next)))) {
          next = hit.point;
        }
      }
      return { x: +next.x.toFixed(2), y: +next.y.toFixed(2) };
    },
    [nearestWall, snap, walls]
  );

  /* ---- effective heading: aimed cameras always point at their subject ---- */
  const headingFor = useCallback(
    (o) => {
      if (o.type === "camera" && o.aim && o.linkTo && byId[o.linkTo]) {
        const target = byId[o.linkTo];
        const t =
          pathPlayback.actorId === target.id && actorMotionMarks(target).length > 1
            ? { ...target, ...sampleMotionPath(actorMotionMarks(target), pathPlayback.progress) }
            : target;
        return headingOf(t.x - o.x, t.y - o.y);
      }
      return o.rot;
    },
    [byId, pathPlayback.actorId, pathPlayback.progress]
  );

  /* ---- moving an actor carries its linked cameras with it ---- */
  const moveObject = (id, nx, ny, record = true) => {
    if (!canInteractWithObject(byId[id])) return;
    if (record) recordUndo(`object:${id}`);
    setObjects((prev) => {
      const target = prev.find((o) => o.id === id);
      if (!target) return prev;
      const dx = nx - target.x;
      const dy = ny - target.y;
      return prev.map((o) => {
        if (o.id === id) {
          const path = motionMarks(o);
          return {
            ...o,
            x: nx,
            y: ny,
            ...((o.type === "camera" || o.type === "actor") && path.length
              ? { motionPath: path.map((mark, index) => (index === 0 ? { ...mark, x: nx, y: ny } : mark)) }
              : {}),
          };
        }
        if (target.type === "actor" && o.type === "camera" && o.linkTo === id) {
          return {
            ...o,
            x: o.x + dx,
            y: o.y + dy,
            motionPath: cameraMotionMarks(o).map((mark) => ({ ...mark, x: mark.x + dx, y: mark.y + dy })),
          };
        }
        return o;
      });
    });
  };

  const rotateObject = (id, newRot, record = true) => {
    if (!canInteractWithObject(byId[id])) return;
    if (record) recordUndo(`object:${id}`);
    setObjects((prev) => {
      const target = prev.find((o) => o.id === id);
      if (!target) return prev;
      const delta = newRot - target.rot;
      return prev.map((o) => {
        if (o.id === id) {
          const normalized = normalizeHeading(newRot);
          return {
            ...o,
            rot: normalized,
            ...((o.type === "camera" || o.type === "actor") && motionMarks(o).length
              ? { motionPath: motionMarks(o).map((mark, index) => (index === 0 ? { ...mark, rot: normalized } : mark)) }
              : {}),
          };
        }
        if (target.type === "actor" && o.type === "camera" && o.linkTo === id) {
          const p = rotatePoint(o, target, delta);
          return {
            ...o,
            x: p.x,
            y: p.y,
            rot: normalizeHeading(o.rot + delta),
            motionPath: cameraMotionMarks(o).map((mark) => {
              const rotated = rotatePoint(mark, target, delta);
              return { ...mark, x: rotated.x, y: rotated.y, rot: normalizeHeading(mark.rot + delta) };
            }),
          };
        }
        return o;
      });
    });
  };

  const patch = (id, fields, record = true) => {
    const target = byId[id];
    const isLayerControl = Object.prototype.hasOwnProperty.call(fields, "isVisible") || Object.prototype.hasOwnProperty.call(fields, "isLocked");
    if (!target || (!canInteractWithObject(target) && !isLayerControl)) return;
    if (record) recordUndo(`object:${id}`);
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...fields };
        if ((o.type === "camera" || o.type === "actor") && motionMarks(o).length) {
          const first = motionMarks(o)[0];
          const x = Object.prototype.hasOwnProperty.call(fields, "x") ? fields.x : first.x;
          const y = Object.prototype.hasOwnProperty.call(fields, "y") ? fields.y : first.y;
          const rot = Object.prototype.hasOwnProperty.call(fields, "rot") ? normalizeHeading(fields.rot) : first.rot;
          next.motionPath = motionMarks(o).map((mark, index) => (index === 0 ? { ...mark, x, y, rot } : mark));
        }
        return next;
      })
    );
  };

  const replaceCameraMotionPath = (cameraId, nextPath, key = "camera-path") => {
    const camera = byId[cameraId];
    if (!camera || !canInteractWithObject(camera)) return;
    recordUndo(key);
    setObjects((previous) =>
      previous.map((object) =>
        object.id === cameraId
          ? {
              ...object,
              motionPath: nextPath,
              move: nextPath.length > 1 && object.move === "Static" ? "Track" : object.move,
            }
          : object
      )
    );
  };

  const startCameraPath = (cameraId) => {
    const camera = byId[cameraId];
    if (!camera || !canInteractWithObject(camera)) return;
    const marks = cameraMotionMarks(camera);
    if (!marks.length) replaceCameraMotionPath(cameraId, [motionMark(camera, uid("m"), { duration: 0 })], "start-camera-path");
    setPathPlayback({ cameraId: null, actorId: null, progress: 0, playing: false });
    playbackStartedAtRef.current = null;
    setPathEditCameraId(cameraId);
    setSelected(cameraId);
    setPane("object");
  };

  const addCameraMark = (cameraId) => {
    const camera = byId[cameraId];
    if (!camera || !canInteractWithObject(camera)) return;
    const marks = cameraMotionMarks(camera);
    const first = marks[0] || motionMark(camera, uid("m"), { duration: 0 });
    const last = marks.at(-1) || first;
    const forward = facing(last.rot);
    const next = motionMark(
      { ...camera, x: last.x + forward.x * 6, y: last.y + forward.y * 6, rot: last.rot },
      uid("m"),
      { duration: 1.5 }
    );
    replaceCameraMotionPath(cameraId, [...(marks.length ? marks : [first]), next], "add-camera-mark");
    setPathEditCameraId(cameraId);
  };

  const removeCameraMark = (cameraId, markId) => {
    const camera = byId[cameraId];
    const marks = cameraMotionMarks(camera);
    if (!camera || marks.length <= 1) return;
    const next = marks.filter((mark) => mark.id !== markId);
    replaceCameraMotionPath(cameraId, next, "remove-camera-mark");
    if (pathPlayback.cameraId === cameraId) {
      setPathPlayback({ cameraId: null, actorId: null, progress: 0, playing: false });
      playbackStartedAtRef.current = null;
    }
  };

  const clearCameraPath = (cameraId) => {
    const camera = byId[cameraId];
    if (!camera || !cameraMotionMarks(camera).length) return;
    replaceCameraMotionPath(cameraId, [], "clear-camera-path");
    setPathEditCameraId((current) => (current === cameraId ? null : current));
    if (pathPlayback.cameraId === cameraId) {
      setPathPlayback({ cameraId: null, actorId: null, progress: 0, playing: false });
      playbackStartedAtRef.current = null;
    }
  };

  const updateCameraMark = (cameraId, markId, fields, key = "edit-camera-mark") => {
    const camera = byId[cameraId];
    if (!camera || !canInteractWithObject(camera)) return;
    recordUndo(key);
    setObjects((previous) =>
      previous.map((object) => {
        if (object.id !== cameraId) return object;
        const motionPath = cameraMotionMarks(object).map((mark, index) => {
          if (mark.id !== markId) return mark;
          const next = {
            ...mark,
            ...fields,
            ...(Object.prototype.hasOwnProperty.call(fields, "rot") ? { rot: normalizeHeading(fields.rot) } : {}),
          };
          if (index === 0) return next;
          return next;
        });
        const start = motionPath[0];
        return start ? { ...object, motionPath, x: start.x, y: start.y, rot: start.rot } : { ...object, motionPath };
      })
    );
  };

  const playCameraPath = (cameraId, restart = true) => {
    const camera = byId[cameraId];
    if (!camera || cameraMotionMarks(camera).length < 2 || cameraMotionDuration(camera) <= 0) return;
    const progress = restart || pathPlayback.cameraId !== cameraId ? 0 : pathPlayback.progress;
    playbackStartedAtRef.current = performance.now() - progress * cameraMotionDuration(camera) * 1000;
    setPathPlayback({ cameraId, actorId: null, progress, playing: true });
  };

  const stopCameraPath = () => {
    setPathPlayback((current) => ({ ...current, playing: false }));
    playbackStartedAtRef.current = null;
  };

  const replaceActorMotionPath = (actorId, nextPath, key = "actor-path") => {
    const actor = byId[actorId];
    if (!actor || actor.type !== "actor" || !canInteractWithObject(actor)) return;
    recordUndo(key);
    setObjects((previous) =>
      previous.map((object) =>
        object.id === actorId
          ? { ...object, motionPath: nextPath }
          : object
      )
    );
  };

  const startActorPath = (actorId) => {
    const actor = byId[actorId];
    if (!actor || actor.type !== "actor" || !canInteractWithObject(actor)) return;
    const marks = actorMotionMarks(actor);
    if (!marks.length) replaceActorMotionPath(actorId, [motionMark(actor, uid("m"), { duration: 0 })], "start-actor-path");
    setPathPlayback({ cameraId: null, actorId: null, progress: 0, playing: false });
    playbackStartedAtRef.current = null;
    setPathEditCameraId(null);
    setPathEditActorId(actorId);
    setSelected(actorId);
    setPane("object");
  };

  const addActorMark = (actorId) => {
    const actor = byId[actorId];
    if (!actor || actor.type !== "actor" || !canInteractWithObject(actor)) return;
    const marks = actorMotionMarks(actor);
    const first = marks[0] || motionMark(actor, uid("m"), { duration: 0 });
    const last = marks.at(-1) || first;
    const forward = facing(last.rot);
    const next = motionMark(
      { ...actor, x: last.x + forward.x * 4, y: last.y + forward.y * 4, rot: last.rot },
      uid("m"),
      { duration: 1.5 }
    );
    replaceActorMotionPath(actorId, [...(marks.length ? marks : [first]), next], "add-actor-mark");
    setPathEditCameraId(null);
    setPathEditActorId(actorId);
  };

  const updateActorMark = (actorId, markId, fields, key = "edit-actor-mark") => {
    const actor = byId[actorId];
    if (!actor || actor.type !== "actor" || !canInteractWithObject(actor)) return;
    recordUndo(key);
    setObjects((previous) =>
      previous.map((object) => {
        if (object.id !== actorId) return object;
        const motionPath = actorMotionMarks(object).map((mark) =>
          mark.id === markId
            ? {
                ...mark,
                ...fields,
                ...(Object.prototype.hasOwnProperty.call(fields, "rot") ? { rot: normalizeHeading(fields.rot) } : {}),
              }
            : mark
        );
        const start = motionPath[0];
        return start ? { ...object, motionPath, x: start.x, y: start.y, rot: start.rot } : { ...object, motionPath };
      })
    );
  };

  const removeActorMark = (actorId, markId) => {
    const actor = byId[actorId];
    const marks = actorMotionMarks(actor);
    if (!actor || marks.length <= 1) return;
    replaceActorMotionPath(actorId, marks.filter((mark) => mark.id !== markId), "remove-actor-mark");
    if (pathPlayback.actorId === actorId) {
      setPathPlayback({ cameraId: null, actorId: null, progress: 0, playing: false });
      playbackStartedAtRef.current = null;
    }
  };

  const clearActorPath = (actorId) => {
    const actor = byId[actorId];
    if (!actor || !actorMotionMarks(actor).length) return;
    replaceActorMotionPath(actorId, [], "clear-actor-path");
    setPathEditActorId((current) => (current === actorId ? null : current));
    if (pathPlayback.actorId === actorId) {
      setPathPlayback({ cameraId: null, actorId: null, progress: 0, playing: false });
      playbackStartedAtRef.current = null;
    }
  };

  const playActorPath = (actorId, restart = true) => {
    const actor = byId[actorId];
    if (!actor || actorMotionMarks(actor).length < 2 || actorMotionDuration(actor) <= 0) return;
    const progress = restart || pathPlayback.actorId !== actorId ? 0 : pathPlayback.progress;
    playbackStartedAtRef.current = performance.now() - progress * actorMotionDuration(actor) * 1000;
    setPathPlayback({ cameraId: null, actorId, progress, playing: true });
  };

  const showObjectContextMenu = (object, clientX, clientY) => {
    if (!canInteractWithObject(object)) return;
    setSelected(object.id);
    setSelectedWall(null);
    setSelectedOpening(null);
    setPane("object");
    setContextMenu({
      id: object.id,
      x: Math.max(8, Math.min(clientX, window.innerWidth - 236)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - 280)),
    });
  };

  const openObjectContextMenu = (event, object) => {
    event.preventDefault();
    event.stopPropagation();
    showObjectContextMenu(object, event.clientX, event.clientY);
  };

  const faceNearestCamera = (actorId) => {
    const actor = byId[actorId];
    if (!actor || actor.type !== "actor") return;
    const camera = cameras.reduce(
      (nearest, candidate) => (!nearest || dist(actor, candidate) < dist(actor, nearest) ? candidate : nearest),
      null
    );
    if (!camera) return;
    rotateObject(actorId, Math.round(headingOf(camera.x - actor.x, camera.y - actor.y)));
  };

  const setCameraTrackTarget = (actorId) => {
    const camera = selected && byId[selected]?.type === "camera"
      ? byId[selected]
      : cameras.reduce(
          (nearest, candidate) => {
            const actor = byId[actorId];
            return !nearest || (actor && dist(actor, candidate) < dist(actor, nearest)) ? candidate : nearest;
          },
          null
        );
    if (!camera) return;
    patch(camera.id, { linkTo: actorId, aim: true });
    setSelected(camera.id);
    setPane("object");
  };

  const removeObject = (id) => {
    if (!canInteractWithObject(byId[id])) return;
    recordUndo("remove");
    setObjects((prev) =>
      prev.filter((o) => o.id !== id).map((o) => (o.linkTo === id ? { ...o, linkTo: null, aim: false } : o))
    );
    setLine((l) => ({ ...l, a: l.a === id ? null : l.a, b: l.b === id ? null : l.b }));
    setSelected(null);
  };

  const removeWall = (id) => {
    recordUndo("remove-wall");
    setWalls((previous) => previous.filter((wall) => wall.id !== id));
    setOpenings((previous) => previous.filter((opening) => opening.wallId !== id));
    setSelectedWall(null);
    setSelectedOpening(null);
  };

  const removeOpening = (id) => {
    recordUndo("remove-opening");
    setOpenings((previous) => previous.filter((opening) => opening.id !== id));
    setSelectedOpening(null);
  };

  const patchWall = (id, fields, record = true) => {
    if (record) recordUndo(`wall:${id}`);
    setWalls((previous) => previous.map((wall) => (wall.id === id ? { ...wall, ...fields } : wall)));
  };

  const patchOpening = (id, fields, record = true) => {
    if (record) recordUndo(`opening:${id}`);
    setOpenings((previous) => previous.map((opening) => (opening.id === id ? { ...opening, ...fields } : opening)));
  };

  /* ---- pointer handling ---- */

  const clearObjectLongPress = () => {
    if (longPress.current?.timer) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  const beginObjectLongPress = (event, object) => {
    if (event.pointerType !== "touch" || !canInteractWithObject(object)) return;
    clearObjectLongPress();
    const pointerId = event.pointerId;
    const x = event.clientX;
    const y = event.clientY;
    const timer = window.setTimeout(() => {
      const pending = longPress.current;
      if (!pending || pending.pointerId !== pointerId) return;
      longPress.current = null;
      drag.current = null;
      showObjectContextMenu(object, pending.x, pending.y);
      window.navigator?.vibrate?.(12);
    }, 550);
    longPress.current = { timer, pointerId, x, y };
  };

  const cancelLongPressOnMove = (event) => {
    const pending = longPress.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 12) clearObjectLongPress();
  };

  const onObjectDown = (e, o, mode) => {
    if (e.pointerType !== "touch" && e.button !== 0) return;
    if (!canInteractWithObject(o)) return;
    e.stopPropagation();
    if (mode === "move") beginObjectLongPress(e, o);
    const w = toWorld(e);
    setSelected(o.id);
    setSelectedWall(null);
    setSelectedOpening(null);
    setPane("object");
    drag.current = {
      mode,
      id: o.id,
      ox: w.x - o.x,
      oy: w.y - o.y,
      startW: o.w,
      startD: o.d,
      aspect: o.w && o.d ? o.w / o.d : null,
      before: snapshot(),
      changed: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMotionMarkDown = (e, target, mark, mode = "motion-mark-move") => {
    if (e.pointerType !== "touch" && e.button !== 0) return;
    if (!canInteractWithObject(target)) return;
    e.stopPropagation();
    setSelected(target.id);
    setSelectedWall(null);
    setSelectedOpening(null);
    if (target.type === "actor") {
      setPathEditCameraId(null);
      setPathEditActorId(target.id);
    } else {
      setPathEditActorId(null);
      setPathEditCameraId(target.id);
    }
    setPane("object");
    drag.current = {
      mode,
      id: target.id,
      markId: mark.id,
      before: snapshot(),
      changed: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const addOpeningAt = (kind, point, preferredWallId = null) => {
    const hit = nearestWall(point, preferredWallId);
    if (!hit || hit.distance > 1.25) return false;
    const width = kind === "window" ? 4 : 3;
    const id = uid("o");
    recordUndo(`add-${kind}`);
    setOpenings((previous) => [
      ...previous,
      {
        id,
        type: kind,
        wallId: hit.wall.id,
        t: +clamp(hit.t, 0.04, 0.96).toFixed(3),
        width,
        swing: "in",
        hinge: "start",
      },
    ]);
    setSelected(null);
    setSelectedWall(null);
    setSelectedOpening(id);
    setPane("setdesign");
    return true;
  };

  const onWallDown = (e, wall, mode = "select") => {
    e.stopPropagation();
    const point = toWorld(e);
    if (["door", "window", "opening"].includes(wallTool)) {
      addOpeningAt(wallTool, point, wall.id);
      return;
    }
    setSelected(null);
    setSelectedOpening(null);
    setSelectedWall(wall.id);
    setPane("setdesign");
    const projection = projectToWall(point, wall);
    drag.current = {
      mode,
      id: wall.id,
      startPoint: point,
      originalA: { ...wall.a },
      originalB: { ...wall.b },
      node: mode === "wall-node-a" ? "a" : mode === "wall-node-b" ? "b" : null,
      anchor: mode === "wall-node-a" ? wall.b : wall.a,
      currentNode: mode === "wall-node-a" ? { ...wall.a } : mode === "wall-node-b" ? { ...wall.b } : null,
      before: snapshot(),
      changed: false,
      startT: projection.t,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onOpeningDown = (e, opening, mode = "opening-move") => {
    e.stopPropagation();
    setSelected(null);
    setSelectedWall(null);
    setSelectedOpening(opening.id);
    setPane("setdesign");
    drag.current = { mode, id: opening.id, before: snapshot(), changed: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onCanvasDown = (e) => {
    if (e.pointerType !== "touch" && e.button !== 0) return;
    const point = toWorld(e);
    const pathEditObjectId = pathEditCameraId || pathEditActorId;
    if (pathEditObjectId) {
      const target = byId[pathEditObjectId];
      if (target && canInteractWithObject(target)) {
        const marks = motionMarks(target);
        const first = marks[0] || motionMark(target, uid("m"), { duration: 0 });
        const last = marks.at(-1) || first;
        const nextPoint = snapWorld(point, last);
        if (dist(nextPoint, last) > 0.15) {
          const nextPath = [
            ...(marks.length ? marks : [first]),
            motionMark({ ...target, ...nextPoint, rot: last.rot }, uid("m"), { duration: 1.5 }),
          ];
          if (target.type === "actor") replaceActorMotionPath(target.id, nextPath, "place-actor-mark");
          else replaceCameraMotionPath(target.id, nextPath, "place-camera-mark");
        }
        return;
      }
      setPathEditCameraId(null);
      setPathEditActorId(null);
    }
    if (wallTool === "wall") {
      const next = snapWorld(point, wallDraft);
      setSelected(null);
      setSelectedWall(null);
      setSelectedOpening(null);
      setPane("setdesign");
      if (!wallDraft) {
        setWallDraft(next);
      } else if (dist(next, wallDraft) > 0.15) {
        recordUndo("draw-wall");
        setWalls((previous) => [
          ...previous,
          {
            id: uid("w"),
            a: { ...wallDraft },
            b: { ...next },
            thickness: wallDefaults.thickness,
            style: wallDefaults.style,
          },
        ]);
        setWallDraft(next);
      }
      return;
    }
    if (["door", "window", "opening"].includes(wallTool)) {
      addOpeningAt(wallTool, point);
      return;
    }
    setSelected(null);
    setSelectedWall(null);
    setSelectedOpening(null);
    if (pane === "object") setPane("shots");
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };

  const onMove = (e) => {
    cancelLongPressOnMove(e);
    const d = drag.current;
    if (!d) {
      if (wallTool === "wall") setWallHover(snapWorld(toWorld(e), wallDraft));
      return;
    }
    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
      return;
    }
    const w = toWorld(e);
    if (d.mode === "wall-node-a" || d.mode === "wall-node-b") {
      const next = snapWorld(w, d.anchor);
      const original = d.node === "a" ? d.originalA : d.originalB;
      d.changed = d.changed || !samePoint(next, original);
      const source = d.currentNode || original;
      setWalls((previous) =>
        previous.map((wall) => ({
          ...wall,
          a: samePoint(wall.a, source) ? next : wall.a,
          b: samePoint(wall.b, source) ? next : wall.b,
        }))
      );
      d.currentNode = next;
      return;
    }
    if (d.mode === "wall-midpoint") {
      const rawDx = w.x - d.startPoint.x;
      const rawDy = w.y - d.startPoint.y;
      const startMid = { x: (d.originalA.x + d.originalB.x) / 2, y: (d.originalA.y + d.originalB.y) / 2 };
      const snappedMid = snapWorld({ x: startMid.x + rawDx, y: startMid.y + rawDy });
      const dx = snappedMid.x - startMid.x;
      const dy = snappedMid.y - startMid.y;
      d.changed = d.changed || Math.hypot(dx, dy) > 0.01;
      setWalls((previous) =>
        previous.map((wall) =>
          wall.id === d.id
            ? { ...wall, a: { x: d.originalA.x + dx, y: d.originalA.y + dy }, b: { x: d.originalB.x + dx, y: d.originalB.y + dy } }
            : wall
        )
      );
      return;
    }
    if (d.mode === "opening-move") {
      const hit = nearestWall(w);
      if (!hit || hit.distance > 1.5) return;
      d.changed = true;
      setOpenings((previous) =>
        previous.map((opening) =>
          opening.id === d.id ? { ...opening, wallId: hit.wall.id, t: +clamp(hit.t, 0.02, 0.98).toFixed(3) } : opening
        )
      );
      return;
    }
    if (d.mode === "opening-resize") {
      const opening = openings.find((item) => item.id === d.id);
      const wall = opening && walls.find((item) => item.id === opening.wallId);
      if (!opening || !wall) return;
      const projection = projectToWall(w, wall);
      const nextWidth = clamp(Math.abs(projection.t - opening.t) * wallLength(wall) * 2, 0.5, wallLength(wall) * 0.92);
      d.changed = true;
      patchOpening(d.id, { width: +nextWidth.toFixed(2) }, false);
      return;
    }
    if (d.mode === "motion-mark-move") {
      const target = byId[d.id];
      const mark = motionMarks(target).find((item) => item.id === d.markId);
      if (!target || !mark) return;
      const marks = motionMarks(target);
      const previous = d.markId === marks[0]?.id ? null : marks[marks.findIndex((item) => item.id === d.markId) - 1];
      const next = snapWorld(w, previous);
      d.changed = d.changed || !samePoint(next, mark);
      setObjects((previousObjects) =>
        previousObjects.map((object) => {
          if (object.id !== d.id) return object;
          const motionPath = motionMarks(object).map((item) => (item.id === d.markId ? { ...item, ...next } : item));
          const start = motionPath[0];
          return { ...object, motionPath, x: start.x, y: start.y };
        })
      );
      return;
    }
    if (d.mode === "motion-mark-rotate") {
      const target = byId[d.id];
      const mark = motionMarks(target).find((item) => item.id === d.markId);
      if (!target || !mark) return;
      const heading = Math.round(headingOf(w.x - mark.x, w.y - mark.y));
      d.changed = true;
      setObjects((previousObjects) =>
        previousObjects.map((object) => {
          if (object.id !== d.id) return object;
          const motionPath = motionMarks(object).map((item) => (item.id === d.markId ? { ...item, rot: heading } : item));
          const start = motionPath[0];
          return { ...object, motionPath, rot: start.rot };
        })
      );
      return;
    }
    const o = byId[d.id];
    if (!o) return;
    if (d.mode === "move") {
      d.changed = true;
      moveObject(d.id, +(w.x - d.ox).toFixed(2), +(w.y - d.oy).toFixed(2), false);
    } else if (d.mode === "rotate") {
      d.changed = true;
      const h = headingOf(w.x - o.x, w.y - o.y);
      if (o.type === "camera") patch(d.id, { rot: Math.round(h), aim: false }, false);
      else rotateObject(d.id, Math.round(h), false);
    } else if (d.mode === "resize") {
      if (o.type === "actor") {
        d.changed = true;
        const r = Math.hypot(w.x - o.x, w.y - o.y);
        patch(d.id, { height: +Math.max(1.5, Math.min(9, (r / 0.95) * SUBJECT_HEIGHT * 0.55)).toFixed(1) }, false);
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
      d.changed = true;
      patch(d.id, { w: +nw.toFixed(2), d: +nd.toFixed(2) }, false);
    }
  };

  const onUp = (event) => {
    if (!event || !longPress.current || longPress.current.pointerId === event.pointerId) clearObjectLongPress();
    if (drag.current?.changed) pushSnapshot(drag.current.before, "drag");
    drag.current = null;
  };

  const toggleWallTool = () => {
    if (wallTool === "wall") {
      setWallTool("select");
      setWallDraft(null);
      setWallHover(null);
      return;
    }
    setSelected(null);
    setSelectedWall(null);
    setSelectedOpening(null);
    setWallDraft(null);
    setWallHover(null);
    setWallTool("wall");
    setPane("setdesign");
  };

  /* ---- adding things ---- */

  const centerOfView = () => ({
    x: +((svgRef.current.clientWidth / 2 - view.x) / view.scale).toFixed(2),
    y: +((svgRef.current.clientHeight / 2 - view.y) / view.scale).toFixed(2),
  });

  const addActor = () => {
    const c = centerOfView();
    const names = ["ANNA", "BEN", "CLARA", "DIEGO", "EVE", "FRANK", "GRACE", "HUGO"];
    const o = newActor(
      c.x,
      c.y,
      names[actors.length % names.length],
      actors.length % 2 === 0 ? "female" : "male"
    );
    recordUndo("add");
    setObjects((p) => [...p, o]);
    setSelected(o.id);
    setPane("object");
  };

  const addCamera = () => {
    const c = centerOfView();
    const o = newCamera(c.x, c.y - 8, String.fromCharCode(65 + cameras.length), { layerContext: layerMode });
    o.aim = false;
    recordUndo("add");
    setObjects((p) => [...p, o]);
    setSelected(o.id);
    setPane("object");
  };

  const addProp = () => {
    const c = centerOfView();
    const o = newProp(c.x, c.y, "Set piece", null, layerMode);
    recordUndo("add");
    setObjects((p) => [...p, o]);
    setSelected(o.id);
    setPane("object");
  };

  const placeStencil = (st) => {
    const c = centerOfView();
    const o = newProp(c.x, c.y, st.name, st);
    recordUndo("add");
    setObjects((p) => [...p, o]);
    setSelected(o.id);
    setPane("object");
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
                targetMode: layerMode,
                technicalFamily: layerMode === CINEMATOGRAPHY ? "CUSTOM_TECHNICAL" : "BLOCKING",
                searchTags: ["imported"],
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

  const importBlueprint = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = reader.result;
      const image = new Image();
      image.onload = () => {
        recordUndo("blueprint");
        const aspect = image.naturalWidth && image.naturalHeight ? image.naturalHeight / image.naturalWidth : 0.7;
        setBlueprint({ src: source, x: 0, y: 0, width: 30, height: +(30 * aspect).toFixed(2), opacity: 0.42 });
      };
      image.onerror = () => {
        recordUndo("blueprint");
        setBlueprint({ src: source, x: 0, y: 0, width: 30, height: 21, opacity: 0.42 });
      };
      image.src = source;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const patchBlueprint = (fields, record = true) => {
    if (record) recordUndo("blueprint");
    setBlueprint((current) => (current ? { ...current, ...fields } : current));
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
    if (!canInteractWithObject(byId[id])) return;
    recordUndo("shot-order");
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
      (s) =>
        stencilIsAvailableInMode(s, layerMode) &&
        stencilMatchesPalette(s, stencilFocus) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.searchTags || []).some((tag) => String(tag).toLowerCase().includes(q)))
    );
    const map = new Map();
    hits.forEach((s) => {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category).push(s);
    });
    const categoryRank = layerMode === CINEMATOGRAPHY
      ? ["Cameras", "Camera rigs", "LED Fixtures", "HMI Fixtures", "Fluorescent Fixtures", "Tungsten & Practicals", "Lighting", "Frames & Boards", "Rags", "Rolls & Cards", "Support & Rigging", "Grip", "Rigging", "Movement"]
      : ["Architecture", "Rooms & Spaces", "Furniture", "Fixtures", "Exterior", "Vehicles", "Misc", "Labels"];
    return [...map.entries()].sort((a, b) => {
      const rankA = categoryRank.indexOf(a[0]);
      const rankB = categoryRank.indexOf(b[0]);
      return (rankA < 0 ? 999 : rankA) - (rankB < 0 ? 999 : rankB) || a[0].localeCompare(b[0]);
    });
  }, [layerMode, stencilFocus, stencils, stencilQuery]);

  const activePaletteTabs = PALETTE_TABS[layerMode];
  const availableStencilCount = useMemo(
    () => stencils.filter((stencil) => stencilIsAvailableInMode(stencil, layerMode)).length,
    [layerMode, stencils]
  );

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

  const plannedMinutes = shots.reduce((n, s) => n + (Number(s.cam.est) || 0), 0);
  const hasPlannedMinutes = shots.some((s) => s.cam.est !== "" && s.cam.est != null && Number(s.cam.est) >= 0);

  const sceneDocument = useCallback(
    () => ({
      schemaVersion: LAYER_SCHEMA_VERSION,
      layerSettings: { cinematographyDisplay },
      objects,
      walls,
      openings,
      line,
      meta,
      blueprint,
    }),
    [blueprint, cinematographyDisplay, line, meta, objects, openings, walls]
  );

  const exportScene = () =>
    download(
      `shot-planner-sc${meta.scene || "scene"}.json`,
      JSON.stringify(sceneDocument(), null, 2),
      "application/json"
    );

  const openShareDialog = () => {
    const url = buildSceneShareUrl(window.location.href, sceneDocument());
    setShareDialog({
      url,
      tooLong: url.length > MAX_SHARE_URL_LENGTH,
      copied: false,
      error: "",
    });
  };

  const copyShareLink = async () => {
    if (!shareDialog?.url || shareDialog.tooLong) return;
    try {
      await navigator.clipboard.writeText(shareDialog.url);
      setShareDialog((current) => ({ ...current, copied: true, error: "" }));
    } catch {
      const input = document.createElement("textarea");
      input.value = shareDialog.url;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      setShareDialog((current) => ({
        ...current,
        copied,
        error: copied ? "" : "Copy was blocked. Select and copy the link manually.",
      }));
    }
  };

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
      "Planned min",
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
      s.cam.est ?? "",
      s.cam.notes.replace(/"/g, "'"),
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    download(`shot-list-sc${meta.scene}.csv`, csv, "text/csv");
  };

  /* A shot list a 1st AD would recognize: scene header, slate column, one row per
     setup, camera letter only where a second camera is on the same setup. */
  const buildShotListHtml = (previsFrames = []) => {
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
    const previs = previsFrames.length
      ? `<section class="previs-page">
          <div class="previs-title">3D previs frames</div>
          <div class="previs-grid">${previsFrames
            .map(
              (frame) => `<figure class="previs-card">
                <img src="${frame.image}" alt="3D previs for setup ${esc(frame.slate)}">
                <figcaption><strong>${esc(frame.slate)}</strong>${frame.camLetter ? ` <span class="cam">${esc(frame.camLetter)}</span>` : ""} · ${esc(frame.description)}</figcaption>
              </figure>`
            )
            .join("")}</div>
        </section>`
      : "";

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
  .previs-page { break-before: page; page-break-before: always; }
  .previs-title { font-size: 16px; font-weight: 700; border-bottom: 2px solid #111; padding-bottom: 7px; margin-bottom: 12px; }
  .previs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .previs-card { margin: 0; break-inside: avoid; page-break-inside: avoid; border: 1px solid #bbb; padding: 6px; }
  .previs-card img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; background: #111820; }
  .previs-card figcaption { font-size: 9px; line-height: 1.35; margin-top: 5px; }
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
    <th style="width:11%">Support</th><th style="width:6%">Plan</th><th>Notes</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="7">${shots.length} setups</td><td class="num">${hasPlannedMinutes ? plannedMinutes : ""}</td><td>${
      hasPlannedMinutes ? "user-entered minutes" : "No planning minutes entered"
    }</td>
  </tr></tfoot>
</table>
${previs}
<div class="foot">
  <span>Setup letters skip I and O. A second camera on the same setup shares the slate and is marked by camera letter.</span>
  <span>${new Date().toLocaleDateString()}</span>
</div>
</body></html>`;
  };

  const printShotList = () => {
    const previsFrames = includePrevisInPrint
      ? shots.map((shot) => ({
          image: renderPrevisFrame({ shot, objects, walls, openings }),
          slate: shot.slate,
          camLetter: shot.multicam ? shot.camLetter : "",
          description: shot.description,
        }))
      : [];
    const html = buildShotListHtml(previsFrames);
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

  const loadSceneDocument = useCallback(
    (raw, { recordHistory = false } = {}) => {
      const data = migrateSceneDocument(raw);
      if (recordHistory) recordUndo("open-scene");
      setObjects(data.objects);
      setWalls(Array.isArray(data.walls) ? data.walls : []);
      setOpenings(Array.isArray(data.openings) ? data.openings : []);
      setLine(data.line || { on: true, auto: true, a: null, b: null, side: 1 });
      if (data.meta) setMeta((current) => ({ ...current, ...data.meta }));
      setBlueprint(data.blueprint || null);
      setCinematographyDisplay(data.layerSettings.cinematographyDisplay);
      setLayerMode(DIRECTOR);
      setStencilFocus("director-all");
      setSelected(null);
      setSelectedWall(null);
      setSelectedOpening(null);
    },
    [recordUndo]
  );

  useEffect(() => {
    if (sharedSceneLoadedRef.current || typeof window === "undefined") return;
    sharedSceneLoadedRef.current = true;
    try {
      const sharedScene = sceneFromShareHash(window.location.hash);
      if (sharedScene) loadSceneDocument(sharedScene);
    } catch (error) {
      console.error("Could not open the shared scene", error);
    }
  }, [loadSceneDocument]);

  const importScene = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        loadSceneDocument(JSON.parse(r.result), { recordHistory: true });
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
  const selectedWallData = selectedWall ? walls.find((wall) => wall.id === selectedWall) : null;
  const selectedOpeningData = selectedOpening ? openings.find((opening) => opening.id === selectedOpening) : null;
  const wallSlices = useMemo(
    () => walls.flatMap((wall) => wallSegments(wall, openings).map((segment) => ({ wall, ...segment }))),
    [walls, openings]
  );
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
            Shot Planner
          </div>
          <div className="text-xs" style={{ color: COLORS.dim }}>
            top down camera plan
          </div>
        </div>
        <Btn onClick={addActor}>Add performer</Btn>
        <Btn onClick={addCamera}>Add camera</Btn>
        <Btn
          onClick={() => {
            const currentShot = shots.at(-1);
            if (currentShot) setPreviewShot(currentShot);
          }}
          disabled={shots.length === 0}
          accent
          data-testid="button-open-3d-previs"
        >
          Open 3D preview
        </Btn>
        <Btn onClick={() => setPane("stencils")}>Set pieces</Btn>
        <Btn
          onClick={() => switchLayerWorkspace(layerMode === DIRECTOR ? CINEMATOGRAPHY : DIRECTOR)}
          active={layerMode === CINEMATOGRAPHY}
          data-testid="button-cinematography-mode"
          aria-pressed={layerMode === CINEMATOGRAPHY}
        >
          Workspace: {layerMode === CINEMATOGRAPHY ? "Cinematographer" : "Director"}
        </Btn>
        <Btn
          onClick={() => setCinematographyDisplay((current) => (current === "hide" ? "ghost" : "hide"))}
          active={cinematographyDisplay === "ghost"}
          data-testid="button-cinematography-display"
          title="Controls how cinematography objects appear in Director mode"
        >
          Director: {cinematographyDisplay === "ghost" ? "ghost" : "hide"} cinema
        </Btn>
        <Btn
          onClick={toggleWallTool}
          active={wallTool === "wall"}
          aria-pressed={wallTool === "wall"}
          title={wallTool === "wall" ? "Turn off Wall Tool and discard the unfinished wall segment" : "Turn on Wall Tool"}
          data-testid="button-wall-tool"
        >
          Wall tool: {wallTool === "wall" ? "on" : "off"}
        </Btn>
        <Btn
          onClick={() => changeLine((l) => ({ ...l, on: !l.on }))}
          disabled={actors.length < 2}
          active={line.on}
        >
          Axis {line.on ? "on" : "off"}
        </Btn>
        <Btn onClick={undo} disabled={history.length === 0}>
          Undo
        </Btn>
        <div className="flex-1" />
        <Btn onClick={() => setPaper((v) => !v)}>{paper ? "Paper" : "Dark"}</Btn>
        <Btn onClick={() => setShowCones((s) => !s)} active={showCones}>
          Field of view {showCones ? "on" : "off"}
        </Btn>
        <Btn onClick={() => setView((v) => ({ ...v, scale: Math.min(70, v.scale * 1.2) }))}>+</Btn>
        <Btn onClick={() => setView((v) => ({ ...v, scale: Math.max(4, v.scale / 1.2) }))}>&minus;</Btn>
        <details className="relative">
          <summary
            className="px-2 py-1 rounded text-xs font-medium cursor-pointer list-none"
            style={{ background: COLORS.panelHi, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
          >
            File & output
          </summary>
          <div
            className="absolute right-0 top-full mt-2 z-20 w-56 p-2 rounded grid gap-2 shadow-xl"
            style={{ background: COLORS.panel, border: `1px solid ${COLORS.rule}` }}
          >
            <label className="flex items-center gap-2 px-1 text-xs" style={{ color: COLORS.dim }}>
              <input
                type="checkbox"
                checked={includePrevisInPrint}
                onChange={(e) => setIncludePrevisInPrint(e.target.checked)}
              />
              Include 3D previs frames in PDF
            </label>
            <Btn onClick={printShotList} accent>Print / save PDF</Btn>
            <Btn onClick={exportShotList}>Export CSV</Btn>
            <Btn onClick={openShareDialog} accent data-testid="button-share-scene">Share scene</Btn>
            <Btn onClick={exportScene}>Download scene file</Btn>
            <Btn onClick={() => fileRef.current.click()}>Open scene file</Btn>
          </div>
        </details>
        <input ref={fileRef} type="file" accept="application/json" onChange={importScene} className="hidden" />
        <input ref={blueprintRef} type="file" accept="image/*" onChange={importBlueprint} className="hidden" />
      </header>

      <div className="flex-1 flex min-h-0 max-lg:flex-col">
        {/* canvas */}
        <div className="flex-1 relative min-w-0 min-h-0 max-lg:min-h-[58vh]">
          <svg
            ref={svgRef}
            className="w-full h-full touch-none"
            style={{
              cursor:
                drag.current?.mode === "pan"
                  ? "grabbing"
                  : pathEditCameraId || pathEditActorId
                  ? "crosshair"
                  : wallTool === "wall"
                  ? "crosshair"
                  : ["door", "window", "opening"].includes(wallTool)
                  ? "copy"
                  : "default",
            }}
            onPointerDown={onCanvasDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onPointerCancel={onUp}
            onContextMenu={(event) => event.preventDefault()}
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
              <rect
                x={-view.scale * 5}
                y={-view.scale * 5}
                width="400%"
                height="400%"
                fill="url(#fine)"
                style={{ pointerEvents: "none" }}
              />
              <rect
                x={-view.scale * 5}
                y={-view.scale * 5}
                width="400%"
                height="400%"
                fill="url(#coarse)"
                style={{ pointerEvents: "none" }}
              />
            </g>

            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              {/* imported location plan / blueprint, kept below construction and blocking */}
              {blueprint && (
                <image
                  href={blueprint.src}
                  x={blueprint.x - blueprint.width / 2}
                  y={blueprint.y - blueprint.height / 2}
                  width={blueprint.width}
                  height={blueprint.height}
                  opacity={blueprint.opacity}
                  preserveAspectRatio="none"
                  style={{ pointerEvents: "none" }}
                />
              )}

              {/* set designer: wall slices automatically leave apertures for hosted elements */}
              {wallSlices.map(({ wall, start, end }, index) => {
                const a = wallPoint(wall, start);
                const b = wallPoint(wall, end);
                const strokeWidth = Math.max(Number(wall.thickness) || 0.32, px(2));
                const isSelectedWall = selectedWall === wall.id;
                const style = wall.style || "solid";
                return (
                  <g key={`${wall.id}-${index}`}>
                    {style === "outline" ? (
                      <>
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={C.ink}
                          strokeWidth={strokeWidth + px(2)}
                          strokeLinecap="square"
                          style={{ pointerEvents: "none" }}
                        />
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={C.prop}
                          strokeWidth={Math.max(px(1), strokeWidth * 0.38)}
                          strokeLinecap="square"
                          style={{ pointerEvents: "none" }}
                        />
                      </>
                    ) : (
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={isSelectedWall ? C.select : C.text}
                        strokeWidth={strokeWidth}
                        strokeOpacity={style === "translucent" ? 0.42 : 0.95}
                        strokeLinecap="square"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    <line
                      data-testid={`wall-segment-${wall.id}-${index}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={Math.max(strokeWidth + px(14), px(18))}
                      onPointerDown={(event) => onWallDown(event, wall)}
                      style={{ cursor: ["door", "window", "opening"].includes(wallTool) ? "copy" : "pointer" }}
                    />
                  </g>
                );
              })}

              {/* hosted doors, windows, and pass-throughs */}
              {openings.map((opening) => {
                const wall = walls.find((item) => item.id === opening.wallId);
                if (!wall) return null;
                const point = wallPoint(wall, opening.t);
                const width = Math.min(Number(opening.width) || 3, wallLength(wall) * 0.92);
                const angle = wallAngle(wall);
                const selectedOpeningNow = selectedOpening === opening.id;
                const openingColor = opening.type === "window" ? C.actor : opening.type === "door" ? C.camera : C.dim;
                const hingeX = opening.hinge === "end" ? width / 2 : -width / 2;
                const leafX = opening.hinge === "end" ? -width / 2 : width / 2;
                const leafY = opening.swing === "out" ? -width : width;
                return (
                  <g key={opening.id} transform={`translate(${point.x} ${point.y}) rotate(${angle})`}>
                    <rect
                      x={-width / 2}
                      y={-0.75}
                      width={width}
                      height={1.5}
                      fill="transparent"
                      onPointerDown={(event) => onOpeningDown(event, opening)}
                      style={{ cursor: "grab" }}
                    />
                    {opening.type === "door" ? (
                      <>
                        <line
                          x1={hingeX}
                          y1="0"
                          x2={leafX}
                          y2={leafY}
                          stroke={openingColor}
                          strokeWidth={px(1.5)}
                          style={{ pointerEvents: "none" }}
                        />
                        <path
                          d={doorArcPath(width, opening.hinge, opening.swing)}
                          fill="none"
                          stroke={openingColor}
                          strokeWidth={px(1)}
                          strokeDasharray={`${px(3)} ${px(2)}`}
                          style={{ pointerEvents: "none" }}
                        />
                        <circle cx={hingeX} cy="0" r={px(2)} fill={openingColor} style={{ pointerEvents: "none" }} />
                      </>
                    ) : opening.type === "window" ? (
                      <>
                        <line
                          x1={-width / 2}
                          y1="0"
                          x2={width / 2}
                          y2="0"
                          stroke={openingColor}
                          strokeWidth={Math.max(px(3), 0.12)}
                          style={{ pointerEvents: "none" }}
                        />
                        <line
                          x1={-width / 2}
                          y1={-0.2}
                          x2={width / 2}
                          y2={-0.2}
                          stroke={C.text}
                          strokeWidth={px(1)}
                          style={{ pointerEvents: "none" }}
                        />
                      </>
                    ) : (
                      <line
                        x1={-width / 2}
                        y1="0"
                        x2={width / 2}
                        y2="0"
                        stroke={openingColor}
                        strokeWidth={px(1.5)}
                        strokeDasharray={`${px(5)} ${px(3)}`}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    {selectedOpeningNow && (
                      <>
                        <rect
                          x={-width / 2 - 0.25}
                          y={-0.25}
                          width={0.5}
                          height={0.5}
                          fill={C.select}
                          stroke={C.ink}
                          strokeWidth={px(1)}
                          onPointerDown={(event) => onOpeningDown(event, opening, "opening-resize")}
                          style={{ cursor: "ew-resize" }}
                        />
                        <rect
                          x={width / 2 - 0.25}
                          y={-0.25}
                          width={0.5}
                          height={0.5}
                          fill={C.select}
                          stroke={C.ink}
                          strokeWidth={px(1)}
                          onPointerDown={(event) => onOpeningDown(event, opening, "opening-resize")}
                          style={{ cursor: "ew-resize" }}
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {/* editable wall nodes and midpoint translation handles */}
              {walls.map((wall) => {
                if (selectedWall !== wall.id) return null;
                const midpoint = wallPoint(wall, 0.5);
                return (
                  <g key={`handles-${wall.id}`}>
                    <Handle x={wall.a.x} y={wall.a.y} px={px} c={C} onDown={(event) => onWallDown(event, wall, "wall-node-a")} />
                    <Handle x={wall.b.x} y={wall.b.y} px={px} c={C} onDown={(event) => onWallDown(event, wall, "wall-node-b")} />
                    <rect
                      x={midpoint.x - 0.28}
                      y={midpoint.y - 0.28}
                      width={0.56}
                      height={0.56}
                      fill={C.camera}
                      stroke={C.ink}
                      strokeWidth={px(1)}
                      onPointerDown={(event) => onWallDown(event, wall, "wall-midpoint")}
                      style={{ cursor: "move" }}
                    />
                  </g>
                );
              })}

              {/* next segment preview while drawing a node-based wall chain */}
              {wallTool === "wall" && wallDraft && wallHover && dist(wallDraft, wallHover) > 0.05 && (
                <line
                  x1={wallDraft.x}
                  y1={wallDraft.y}
                  x2={wallHover.x}
                  y2={wallHover.y}
                  stroke={C.camera}
                  strokeWidth={Math.max(wallDefaults.thickness, px(2))}
                  strokeDasharray={`${px(6)} ${px(4)}`}
                  opacity="0.82"
                  style={{ pointerEvents: "none" }}
                />
              )}

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

              {/* camera movement: authored cubic Bézier paths sit above the set and below live camera bodies */}
              {renderedCameras.map(({ source: camera, presentation }) => {
                const marks = cameraMotionMarks(camera);
                if (marks.length < 2) return null;
                const isEditing = pathEditCameraId === camera.id;
                const isPlaying = pathPlayback.cameraId === camera.id && pathPlayback.playing;
                const pathColor = camera.color || C.camera;
                return (
                  <g
                    key={`motion-path-${camera.id}`}
                    data-testid={`camera-path-${camera.id}`}
                    opacity={presentation.opacity}
                    style={{ pointerEvents: "none" }}
                  >
                    <path
                      d={motionPathSvg(marks)}
                      fill="none"
                      stroke={pathColor}
                      strokeWidth={px(isEditing ? 2.4 : 1.4)}
                      strokeDasharray={isPlaying ? undefined : `${px(5)} ${px(3)}`}
                      opacity={isEditing ? 0.96 : 0.68}
                    />
                    {marks.map((mark, index) => {
                      const markerHeading = facing(mark.rot);
                      const isStart = index === 0;
                      const isEnd = index === marks.length - 1;
                      const markerColor = isStart ? C.actor : isEnd ? C.camera : pathColor;
                      const canEdit = isEditing && presentation.interactive && !isPlaying;
                      return (
                        <g key={mark.id} data-testid={`camera-path-mark-${camera.id}-${mark.id}`}>
                          <circle
                            cx={mark.x}
                            cy={mark.y}
                            r={px(isStart || isEnd ? 9 : 7)}
                            fill={C.ink}
                            stroke={markerColor}
                            strokeWidth={px(2)}
                            style={{ pointerEvents: canEdit ? "auto" : "none", cursor: canEdit ? "move" : "default" }}
                            onPointerDown={(event) => onMotionMarkDown(event, camera, mark)}
                          />
                          <text
                            x={mark.x}
                            y={mark.y + px(3.2)}
                            textAnchor="middle"
                            fill={C.text}
                            fontSize={px(10)}
                            fontWeight="700"
                            style={{ pointerEvents: "none" }}
                          >
                            {index + 1}
                          </text>
                          {canEdit && (
                            <>
                              <line
                                x1={mark.x}
                                y1={mark.y}
                                x2={mark.x + markerHeading.x * 1.15}
                                y2={mark.y + markerHeading.y * 1.15}
                                stroke={markerColor}
                                strokeWidth={px(1.4)}
                                style={{ pointerEvents: "none" }}
                              />
                              <circle
                                cx={mark.x + markerHeading.x * 1.25}
                                cy={mark.y + markerHeading.y * 1.25}
                                r={px(5)}
                                fill={markerColor}
                                stroke={C.ink}
                                strokeWidth={px(1.1)}
                                style={{ pointerEvents: "auto", cursor: "crosshair" }}
                                onPointerDown={(event) => onMotionMarkDown(event, camera, mark, "motion-mark-rotate")}
                              />
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* performer blocking paths use the same authored spline and mark language as camera movement */}
              {renderedActors.map(({ source: actor, presentation }) => {
                const marks = actorMotionMarks(actor);
                if (marks.length < 2) return null;
                const isEditing = pathEditActorId === actor.id;
                const isPlaying = pathPlayback.actorId === actor.id && pathPlayback.playing;
                return (
                  <g
                    key={`actor-motion-path-${actor.id}`}
                    data-testid={`actor-path-${actor.id}`}
                    opacity={presentation.opacity}
                    style={{ pointerEvents: "none" }}
                  >
                    <path
                      d={motionPathSvg(marks)}
                      fill="none"
                      stroke={C.actor}
                      strokeWidth={px(isEditing ? 2.4 : 1.4)}
                      strokeDasharray={isPlaying ? undefined : `${px(4)} ${px(3)}`}
                      opacity={isEditing ? 0.98 : 0.72}
                    />
                    {marks.map((mark, index) => {
                      const markerHeading = facing(mark.rot);
                      const isStart = index === 0;
                      const isEnd = index === marks.length - 1;
                      const markerColor = isStart ? C.actor : isEnd ? C.select : C.actor;
                      const canEdit = isEditing && presentation.interactive && !isPlaying;
                      return (
                        <g key={mark.id} data-testid={`actor-path-mark-${actor.id}-${mark.id}`}>
                          <circle
                            cx={mark.x}
                            cy={mark.y}
                            r={px(isStart || isEnd ? 9 : 7)}
                            fill={C.ink}
                            stroke={markerColor}
                            strokeWidth={px(2)}
                            style={{ pointerEvents: canEdit ? "auto" : "none", cursor: canEdit ? "move" : "default" }}
                            onPointerDown={(event) => onMotionMarkDown(event, actor, mark)}
                          />
                          <text
                            x={mark.x}
                            y={mark.y + px(3.2)}
                            textAnchor="middle"
                            fill={C.text}
                            fontSize={px(10)}
                            fontWeight="700"
                            style={{ pointerEvents: "none" }}
                          >
                            {index + 1}
                          </text>
                          {canEdit && (
                            <>
                              <line
                                x1={mark.x}
                                y1={mark.y}
                                x2={mark.x + markerHeading.x * 1.15}
                                y2={mark.y + markerHeading.y * 1.15}
                                stroke={markerColor}
                                strokeWidth={px(1.4)}
                                style={{ pointerEvents: "none" }}
                              />
                              <circle
                                cx={mark.x + markerHeading.x * 1.25}
                                cy={mark.y + markerHeading.y * 1.25}
                                r={px(5)}
                                fill={markerColor}
                                stroke={C.ink}
                                strokeWidth={px(1.1)}
                                style={{ pointerEvents: "auto", cursor: "crosshair" }}
                                onPointerDown={(event) => onMotionMarkDown(event, actor, mark, "motion-mark-rotate")}
                              />
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* set pieces */}
              {renderedProps.map(({ object: o, presentation }) => (
                  <g
                    key={o.id}
                    data-testid={`canvas-object-${o.id}`}
                    data-layer-context={normalizeLayerContext(o.layerContext)}
                    transform={`translate(${o.x} ${o.y}) rotate(${o.rot})`}
                    opacity={presentation.opacity}
                    style={{ pointerEvents: presentation.interactive ? "auto" : "none" }}
                  >
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
                    {selected === o.id && presentation.interactive && (
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
              {renderedActors.map(({ object: o, source: actor, presentation }) => {
                const f = facing(o.rot);
                const isLineEnd = !!linePair && (linePair[0] === o.id || linePair[1] === o.id);
                const r = 0.95 * Math.max(0.55, Math.min(1.5, (o.height || SUBJECT_HEIGHT) / SUBJECT_HEIGHT));
                const isPlaying = pathPlayback.actorId === actor.id && pathPlayback.playing;
                return (
                  <g
                    key={o.id}
                    data-testid={`canvas-object-${o.id}`}
                    data-layer-context={normalizeLayerContext(o.layerContext)}
                    opacity={presentation.opacity}
                    style={{ pointerEvents: presentation.interactive && !isPlaying ? "auto" : "none" }}
                    onContextMenu={(event) => openObjectContextMenu(event, actor)}
                  >
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
                      onPointerDown={(e) => onObjectDown(e, actor, "move")}
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
                    {selected === o.id && presentation.interactive && (
                      <>
                        <Handle
                          x={o.x + f.x * 2.6}
                          y={o.y + f.y * 2.6}
                          px={px}
                          c={C}
                          onDown={(e) => onObjectDown(e, actor, "rotate")}
                        />
                        <rect
                          x={o.x + r * 0.72 - 0.3}
                          y={o.y + r * 0.72 - 0.3}
                          width={0.6}
                          height={0.6}
                          fill={C.camera}
                          stroke={C.ink}
                          strokeWidth={px(1)}
                          onPointerDown={(e) => onObjectDown(e, actor, "resize")}
                          style={{ cursor: "nwse-resize" }}
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {/* cameras */}
              {renderedCameras.map(({ object: o, source: camera, presentation }) => {
                const h = headingFor(o);
                const f = facing(h);
                const s = SENSORS[o.sensor];
                const half = deg(Math.atan(s.w / (2 * o.focal)));
                const reach = Math.max(6, o.linkTo && byId[o.linkTo] ? dist(o, byId[o.linkTo]) * 1.25 : 12);
                const l = facing(h - half);
                const r = facing(h + half);
                const bad = crossesLine(o);
                const cameraColor = o.color || COLORS.camera;
                const stroke = selected === o.id ? C.select : bad ? C.bad : cameraColor;
                const isPlaying = pathPlayback.cameraId === camera.id && pathPlayback.playing;
                return (
                  <g
                    key={o.id}
                    data-testid={`canvas-object-${o.id}`}
                    data-layer-context={normalizeLayerContext(o.layerContext)}
                    opacity={presentation.opacity}
                    style={{ pointerEvents: presentation.interactive && !isPlaying ? "auto" : "none" }}
                    onContextMenu={(event) => openObjectContextMenu(event, camera)}
                  >
                    {showCones && o.showFov !== false && (
                      <polygon
                        points={`${o.x},${o.y} ${o.x + l.x * reach},${o.y + l.y * reach} ${o.x + r.x * reach},${
                          o.y + r.y * reach
                        }`}
                        fill={bad ? "rgba(229,72,77,0.15)" : `${cameraColor}26`}
                        stroke="none"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    <g transform={`translate(${o.x} ${o.y}) rotate(${h})`}>
                      <rect
                        x={-1}
                        y={-0.8}
                        width={2}
                        height={1.5}
                        rx={0.18}
                        fill={`${cameraColor}55`}
                        stroke={stroke}
                        strokeWidth={px(1.7)}
                        onPointerDown={(e) => onObjectDown(e, camera, "move")}
                        style={{ cursor: "move" }}
                      />
                      <rect
                        x={-0.56}
                        y={-1.25}
                        width={1.12}
                        height={0.52}
                        rx={0.11}
                        fill={cameraColor}
                        stroke={stroke}
                        strokeWidth={px(1.2)}
                        style={{ pointerEvents: "none" }}
                      />
                      <circle cx="0" cy={-0.98} r={0.16} fill={C.ink} style={{ pointerEvents: "none" }} />
                    </g>
                    <text
                      x={o.x - f.x * 1.9}
                      y={o.y - f.y * 1.9 + 0.3}
                      textAnchor="middle"
                      fill={bad ? C.bad : cameraColor}
                      fontSize={0.9}
                      fontWeight="700"
                      style={{ pointerEvents: "none" }}
                    >
                      {o.name}
                    </text>
                    {selected === o.id && presentation.interactive && !isPlaying && (
                      <Handle
                        x={o.x + f.x * 2.4}
                        y={o.y + f.y * 2.4}
                        px={px}
                        onDown={(e) => onObjectDown(e, camera, "rotate")}
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
            {wallTool === "wall"
              ? wallDraft
                ? "Tap the next point to continue the wall. Esc or Finish ends the chain."
                : "Wall tool: tap a point to begin. Grid, node, line, and 45° / 90° snap are active."
              : ["door", "window", "opening"].includes(wallTool)
              ? `Place ${wallTool === "opening" ? "a wall opening" : `a ${wallTool}`} on a wall.`
              : `${view.scale.toFixed(0)} px per foot. Grid square = 1 ft, heavy line = 5 ft. Drag empty space to pan, scroll to zoom.`}
          </div>
        </div>

        {/* right panel */}
        <aside
          className="w-[22rem] shrink-0 flex flex-col min-h-0 max-lg:w-full max-lg:h-[42vh]"
          style={{ background: COLORS.panel, borderLeft: `1px solid ${COLORS.rule}` }}
        >
          <div className="px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${COLORS.rule}` }}>
            <div className="text-xs uppercase tracking-[0.18em] font-semibold" style={{ color: COLORS.dim }}>
              Workspace
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1">
              {["shots", "setdesign", "scene", "stencils"].map((t) => (
              <button
                key={t}
                onClick={() => setPane(t)}
                className="px-2 py-2 rounded text-xs font-medium"
                style={{
                  color: pane === t ? COLORS.camera : COLORS.dim,
                  background: pane === t ? "rgba(232,163,61,0.10)" : "transparent",
                  border: `1px solid ${pane === t ? COLORS.camera : COLORS.rule}`,
                }}
              >
                {t === "shots"
                  ? "Shots"
                  : t === "setdesign"
                  ? "Set design"
                  : t === "scene"
                  ? "Scene"
                  : "Set pieces"}
              </button>
            ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {pane === "shots" && (
              <>
                {shots.length === 0 && (
                  <p className="text-xs" style={{ color: COLORS.dim }}>
                    No shots yet. Add a camera, then select it to choose its subject, lens, movement, and color.
                  </p>
                )}
                {shots.map((s) => {
                  const shotEditable = canInteractWithObject(s.cam);
                  return (
                    <div
                    key={s.cam.id}
                    onClick={() => {
                      if (shotEditable) setSelected(s.cam.id);
                      setPreviewShot(s);
                    }}
                    className="p-2 rounded cursor-pointer"
                    style={{
                      background: selected === s.cam.id ? COLORS.panelHi : "transparent",
                      border: `1px solid ${s.crossing ? COLORS.bad : COLORS.rule}`,
                      borderLeft: `4px solid ${s.crossing ? COLORS.bad : s.cam.color || COLORS.camera}`,
                      opacity: shotEditable ? 1 : 0.55,
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
                      <span className="text-sm font-bold" style={{ color: s.cam.color || COLORS.camera }}>
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
                      <Btn onClick={() => { setSelected(s.cam.id); setPane("object"); }} disabled={!shotEditable}>Edit</Btn>
                      <Btn onClick={() => moveShot(s.cam.id, -1)} disabled={!shotEditable}>Up</Btn>
                      <Btn onClick={() => moveShot(s.cam.id, 1)} disabled={!shotEditable}>Down</Btn>
                      {s.cam.est !== "" && s.cam.est != null && (
                        <span className="ml-auto text-xs font-mono self-center" style={{ color: COLORS.dim }}>
                          {s.cam.est} min planned
                        </span>
                      )}
                    </div>
                  </div>
                  );
                })}
                {shots.length > 0 && (
                  <div className="text-xs pt-2" style={{ color: COLORS.dim, borderTop: `1px solid ${COLORS.rule}` }}>
                    {shots.length} setups
                    {hasPlannedMinutes ? ` · ${plannedMinutes} user-entered minutes` : ""} · shooting order sets the slate letters
                  </div>
                )}
              </>
            )}

            {pane === "stencils" && (
              <div className="space-y-3">
                <div
                  className="rounded-md p-3"
                  style={{
                    background: layerMode === CINEMATOGRAPHY ? "rgba(79,209,197,0.09)" : "rgba(232,163,61,0.09)",
                    border: `1px solid ${layerMode === CINEMATOGRAPHY ? COLORS.actor : COLORS.camera}`,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: layerMode === CINEMATOGRAPHY ? COLORS.actor : COLORS.camera }}>
                        {layerMode === CINEMATOGRAPHY ? "Cinematographer toolkit" : "Director toolkit"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed" style={{ color: COLORS.text }}>
                        {layerMode === CINEMATOGRAPHY
                          ? "Technical tools are expanded by discipline. Staging assets remain one focused tab away."
                          : "Only blocking and staging essentials are shown. Camera, lighting, grip, and rigging stay out of your pass."}
                      </p>
                    </div>
                    <span className="shrink-0 rounded px-2 py-1 text-xs font-mono" style={{ color: COLORS.text, background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}>
                      {availableStencilCount}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1" role="tablist" aria-label="Stencil role filters">
                  {activePaletteTabs.map((tab) => {
                    const count = stencils.filter(
                      (stencil) => stencilIsAvailableInMode(stencil, layerMode) && stencilMatchesPalette(stencil, tab.id)
                    ).length;
                    const active = stencilFocus === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        title={tab.description}
                        onClick={() => setStencilFocus(tab.id)}
                        data-testid={`button-stencil-filter-${tab.id}`}
                        className="min-h-10 rounded px-2 py-1 text-left text-xs font-medium"
                        style={{
                          background: active ? (layerMode === CINEMATOGRAPHY ? "rgba(79,209,197,0.16)" : "rgba(232,163,61,0.16)") : COLORS.panelHi,
                          color: active ? (layerMode === CINEMATOGRAPHY ? COLORS.actor : COLORS.camera) : COLORS.text,
                          border: `1px solid ${active ? (layerMode === CINEMATOGRAPHY ? COLORS.actor : COLORS.camera) : COLORS.rule}`,
                        }}
                      >
                        <span>{tab.label}</span>
                        <span className="ml-1 font-mono" style={{ color: COLORS.dim }}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                <input
                  value={stencilQuery}
                  onChange={(e) => setStencilQuery(e.target.value)}
                  placeholder={layerMode === CINEMATOGRAPHY ? "Search camera, light, grip, or rigging" : "Search set, furniture, or architecture"}
                  className="w-full px-2 py-1 rounded text-sm"
                  style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                />
                <div className="flex gap-2">
                  <Btn onClick={() => pngRef.current.click()}>Import role assets</Btn>
                  <Btn onClick={addProp}>{layerMode === CINEMATOGRAPHY ? "Technical mark" : "Blank footprint"}</Btn>
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
                <p className="text-xs leading-relaxed" style={{ color: layerMode === CINEMATOGRAPHY ? COLORS.actor : COLORS.dim }}>
                  {layerMode === CINEMATOGRAPHY
                    ? "Camera bodies, fixtures, light control, grip, and rigging are editable here. Use Set & staging for the shared floor plan."
                    : "Actors, architecture, furniture, practical set pieces, and location markers stay editable. Switch Workspace to Cinematographer for technical gear."}
                </p>

                {stencilGroups.length === 0 && (
                  <p className="text-xs" style={{ color: COLORS.dim }}>
                    Nothing matches that search.
                  </p>
                )}

                {stencilGroups.map(([category, items]) => (
                  <div key={category}>
                    <div className="text-xs uppercase tracking-widest mb-1" style={{ color: COLORS.dim }}>
                      {category} <span className="font-mono normal-case tracking-normal">· {items.length}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {items.map((st) => (
                        <button
                          key={st.id}
                          onClick={() => placeStencil(st)}
                          title={`${st.name}, ${st.w} by ${st.d} ft`}
                          data-testid={`stencil-${st.id.replace(/[^a-z0-9]+/gi, "-")}`}
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

            {pane === "setdesign" && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] font-semibold" style={{ color: COLORS.camera }}>
                    Set designer
                  </div>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: COLORS.dim }}>
                    Build a linked overhead set with point-to-point walls. Doors, windows, and pass-throughs remain hosted to their wall as the geometry changes.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Btn onClick={() => { setWallTool("select"); setWallDraft(null); }} active={wallTool === "select"}>
                    Select / edit
                  </Btn>
                  <Btn
                    onClick={toggleWallTool}
                    active={wallTool === "wall"}
                    accent
                    aria-pressed={wallTool === "wall"}
                    data-testid="button-draw-walls"
                  >
                    Draw walls: {wallTool === "wall" ? "on" : "off"}
                  </Btn>
                  <Btn onClick={() => { setWallTool("door"); setWallDraft(null); }} active={wallTool === "door"}>
                    Add door
                  </Btn>
                  <Btn onClick={() => { setWallTool("window"); setWallDraft(null); }} active={wallTool === "window"}>
                    Add window
                  </Btn>
                  <Btn onClick={() => { setWallTool("opening"); setWallDraft(null); }} active={wallTool === "opening"}>
                    Wall opening
                  </Btn>
                  <Btn onClick={() => blueprintRef.current?.click()} active={!!blueprint}>
                    Import blueprint
                  </Btn>
                </div>

                {wallTool === "wall" && (
                  <div className="flex items-center justify-between gap-2 rounded p-2" style={{ background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}>
                    <span className="text-xs" style={{ color: COLORS.dim }}>
                      {wallDraft ? "Chain in progress" : "Ready for first point"}
                    </span>
                    <Btn onClick={() => { setWallDraft(null); setWallHover(null); }} disabled={!wallDraft}>
                      Finish wall
                    </Btn>
                  </div>
                )}

                <div className="rounded p-3 space-y-3" style={{ background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}>
                  <div className="text-xs uppercase tracking-wider" style={{ color: COLORS.text }}>Snap engine</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {[
                      ["grid", "Grid alignment"],
                      ["nodes", "Node magnetism"],
                      ["lines", "Wall-line snap"],
                      ["angles", "45° / 90° angles"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs" style={{ color: COLORS.dim }}>
                        <input
                          type="checkbox"
                          checked={snap[key]}
                          onChange={(event) => setSnap((current) => ({ ...current, [key]: event.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label={`New wall thickness ${wallDefaults.thickness.toFixed(2)} ft`}>
                    <input
                      type="range"
                      min="0.12"
                      max="0.9"
                      step="0.02"
                      value={wallDefaults.thickness}
                      onChange={(event) => setWallDefaults((current) => ({ ...current, thickness: +event.target.value }))}
                      className="w-full"
                    />
                  </Field>
                  <Field label="New wall display">
                    <Sel
                      value={wallDefaults.style}
                      options={["solid", "outline", "translucent"]}
                      onChange={(style) => setWallDefaults((current) => ({ ...current, style }))}
                    />
                  </Field>
                </div>

                {blueprint && (
                  <div className="rounded p-3 space-y-3" style={{ background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wider" style={{ color: COLORS.text }}>Blueprint underlay</div>
                      <Btn onClick={() => { recordUndo("remove-blueprint"); setBlueprint(null); }} danger>
                        Remove
                      </Btn>
                    </div>
                    <Field label={`Scale / width ${blueprint.width.toFixed(1)} ft`}>
                      <input
                        type="range"
                        min="5"
                        max="120"
                        step="0.5"
                        value={blueprint.width}
                        onChange={(event) => {
                          const width = +event.target.value;
                          patchBlueprint({ width, height: +(blueprint.height * (width / blueprint.width)).toFixed(2) });
                        }}
                        className="w-full"
                      />
                    </Field>
                    <Field label={`Opacity ${Math.round(blueprint.opacity * 100)}%`}>
                      <input
                        type="range"
                        min="0.1"
                        max="0.85"
                        step="0.05"
                        value={blueprint.opacity}
                        onChange={(event) => patchBlueprint({ opacity: +event.target.value })}
                        className="w-full"
                      />
                    </Field>
                    <p className="text-xs leading-relaxed" style={{ color: COLORS.dim }}>
                      Align the imported plan to the one-foot grid, then trace the perimeter with the Wall tool. Save scene keeps the underlay with the floor plan.
                    </p>
                  </div>
                )}

                {!selectedWallData && !selectedOpeningData && (
                  <div className="rounded p-3 text-xs leading-relaxed" style={{ background: COLORS.panelHi, color: COLORS.dim, border: `1px solid ${COLORS.rule}` }}>
                    {walls.length
                      ? `${walls.length} wall segment${walls.length === 1 ? "" : "s"} and ${openings.length} hosted opening${openings.length === 1 ? "" : "s"}. Tap a wall to move its endpoints or midpoint.`
                      : "Start with Draw walls, tap each exterior corner in sequence, then press Finish wall. Select a wall and use Extrude to pull an interior branch."}
                  </div>
                )}

                {selectedWallData && (
                  <div className="rounded p-3 space-y-3" style={{ background: COLORS.panelHi, border: `1px solid ${COLORS.camera}` }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wider" style={{ color: COLORS.dim }}>Selected wall</div>
                        <div className="text-sm font-semibold" style={{ color: COLORS.text }}>
                          {wallLength(selectedWallData).toFixed(1)} ft · {wallAngle(selectedWallData).toFixed(0)}°
                        </div>
                      </div>
                      <Btn onClick={() => { setSelectedWall(null); setWallTool("select"); }}>Done</Btn>
                    </div>
                    <Field label={`Thickness ${Number(selectedWallData.thickness || 0.32).toFixed(2)} ft`}>
                      <input
                        type="range"
                        min="0.12"
                        max="0.9"
                        step="0.02"
                        value={selectedWallData.thickness || 0.32}
                        onChange={(event) => patchWall(selectedWallData.id, { thickness: +event.target.value })}
                        className="w-full"
                      />
                    </Field>
                    <Field label="Wall display">
                      <Sel
                        value={selectedWallData.style || "solid"}
                        options={["solid", "outline", "translucent"]}
                        onChange={(style) => patchWall(selectedWallData.id, { style })}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Btn
                        onClick={() => {
                          const midpoint = wallPoint(selectedWallData, 0.5);
                          setWallDraft(midpoint);
                          setWallHover(null);
                          setWallTool("wall");
                        }}
                        accent
                      >
                        Extrude from midpoint
                      </Btn>
                      <Btn onClick={() => removeWall(selectedWallData.id)} danger>
                        Delete wall
                      </Btn>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: COLORS.dim }}>
                      Circle handles reshape every wall joined at that node. The square midpoint shifts this segment; attached doors and windows stay proportional to their host wall.
                    </p>
                  </div>
                )}

                {selectedOpeningData && (
                  <div className="rounded p-3 space-y-3" style={{ background: COLORS.panelHi, border: `1px solid ${COLORS.actor}` }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wider" style={{ color: COLORS.dim }}>Hosted {selectedOpeningData.type}</div>
                        <div className="text-sm font-semibold capitalize" style={{ color: COLORS.text }}>
                          {selectedOpeningData.type} · {Number(selectedOpeningData.width).toFixed(1)} ft
                        </div>
                      </div>
                      <Btn onClick={() => setSelectedOpening(null)}>Done</Btn>
                    </div>
                    <Field label={`Aperture width ${Number(selectedOpeningData.width).toFixed(1)} ft`}>
                      <input
                        type="range"
                        min="0.5"
                        max={Math.max(1, wallLength(walls.find((wall) => wall.id === selectedOpeningData.wallId) || { a: { x: 0, y: 0 }, b: { x: 8, y: 0 } }) * 0.92)}
                        step="0.1"
                        value={selectedOpeningData.width}
                        onChange={(event) => patchOpening(selectedOpeningData.id, { width: +event.target.value })}
                        className="w-full"
                      />
                    </Field>
                    {selectedOpeningData.type === "door" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Swing">
                          <Sel
                            value={selectedOpeningData.swing || "in"}
                            options={["in", "out"]}
                            onChange={(swing) => patchOpening(selectedOpeningData.id, { swing })}
                          />
                        </Field>
                        <Field label="Hinge side">
                          <Sel
                            value={selectedOpeningData.hinge || "start"}
                            options={["start", "end"]}
                            onChange={(hinge) => patchOpening(selectedOpeningData.id, { hinge })}
                          />
                        </Field>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Btn onClick={() => setWallTool(selectedOpeningData.type === "opening" ? "opening" : selectedOpeningData.type)} active>
                        Slide on wall
                      </Btn>
                      <Btn onClick={() => removeOpening(selectedOpeningData.id)} danger>
                        Delete {selectedOpeningData.type}
                      </Btn>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: COLORS.dim }}>
                      Drag the element to slide it along this wall or onto another wall. Square end handles resize the aperture and cut geometry updates immediately.
                    </p>
                  </div>
                )}
              </div>
            )}

            {pane === "scene" && (
              <div className="space-y-3">
                <Field label="Production">
                  <Txt value={meta.production} onChange={(v) => changeMeta((m) => ({ ...m, production: v }))} />
                </Field>
                <Field label="Director">
                  <Txt value={meta.director} onChange={(v) => changeMeta((m) => ({ ...m, director: v }))} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Scene number">
                    <Txt value={meta.scene} onChange={(v) => changeMeta((m) => ({ ...m, scene: v }))} />
                  </Field>
                  <Field label="Int or Ext">
                    <Sel
                      value={meta.intExt}
                      options={["INT.", "EXT.", "INT./EXT."]}
                      onChange={(v) => changeMeta((m) => ({ ...m, intExt: v }))}
                    />
                  </Field>
                </div>
                <Field label="Location">
                  <Txt value={meta.location} onChange={(v) => changeMeta((m) => ({ ...m, location: v }))} />
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Time">
                    <Sel
                      value={meta.timeOfDay}
                      options={["DAY", "NIGHT", "DUSK", "DAWN", "CONTINUOUS"]}
                      onChange={(v) => changeMeta((m) => ({ ...m, timeOfDay: v }))}
                    />
                  </Field>
                  <Field label="Pages">
                    <Txt value={meta.pages} onChange={(v) => changeMeta((m) => ({ ...m, pages: v }))} />
                  </Field>
                  <Field label="Day">
                    <Txt value={meta.shootDay} onChange={(v) => changeMeta((m) => ({ ...m, shootDay: v }))} />
                  </Field>
                </div>
                <p className="text-xs pt-1" style={{ color: COLORS.dim, borderTop: `1px solid ${COLORS.rule}` }}>
                  Slate preview: the first setup is <span className="font-mono">{meta.scene || "1"}</span>, then{" "}
                  <span className="font-mono">
                    {["", "A", "B", "C"].slice(1).map((l) => `${meta.scene || "1"}${l}`).join(", ")}
                  </span>
                  . Letters I and O are skipped, and after Z they double to AA, BB.
                </p>
                <div className="pt-1 space-y-2">
                  <label className="flex items-center gap-2 text-xs" style={{ color: COLORS.dim }}>
                    <input
                      type="checkbox"
                      checked={includePrevisInPrint}
                      onChange={(e) => setIncludePrevisInPrint(e.target.checked)}
                    />
                    Include 3D previs frames in PDF
                  </label>
                  <Btn onClick={printShotList} accent>
                    Print / save PDF
                  </Btn>
                </div>
                <details className="pt-3" style={{ borderTop: `1px solid ${COLORS.rule}` }}>
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider" style={{ color: COLORS.text }}>
                    Screen direction and 180 line
                  </summary>
                  <div className="pt-3 space-y-3 text-sm">
                    <label className="flex items-center gap-2 text-xs" style={{ color: COLORS.dim }}>
                      <input
                        type="checkbox"
                        checked={line.on}
                        disabled={actors.length < 2}
                        onChange={(e) => changeLine((l) => ({ ...l, on: e.target.checked }))}
                      />
                      Show axis on plan
                    </label>
                    <div className="flex gap-2">
                      <Btn onClick={() => changeLine((l) => ({ ...l, auto: true }))} active={line.auto} disabled={!line.on}>
                        Automatic pair
                      </Btn>
                      <Btn onClick={() => changeLine((l) => ({ ...l, auto: false }))} active={!line.auto} disabled={!line.on}>
                        Choose pair
                      </Btn>
                    </div>
                    {!line.auto && (
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Actor A">
                          <select
                            value={line.a || ""}
                            disabled={!line.on}
                            onChange={(e) => changeLine((l) => ({ ...l, a: e.target.value || null }))}
                            className="w-full px-2 py-1 rounded text-sm"
                            style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                          >
                            <option value="">None</option>
                            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Actor B">
                          <select
                            value={line.b || ""}
                            disabled={!line.on}
                            onChange={(e) => changeLine((l) => ({ ...l, b: e.target.value || null }))}
                            className="w-full px-2 py-1 rounded text-sm"
                            style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                          >
                            <option value="">None</option>
                            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </Field>
                      </div>
                    )}
                    <Btn onClick={() => changeLine((l) => ({ ...l, side: l.side * -1 }))} disabled={!linePair}>
                      Flip working side
                    </Btn>
                  </div>
                </details>
              </div>
            )}

            {pane === "object" && !sel && (
              <p className="text-xs" style={{ color: COLORS.dim }}>
                Select something in the plan to edit it.
              </p>
            )}

            {pane === "object" && sel && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 pb-3" style={{ borderBottom: `1px solid ${COLORS.rule}` }}>
                  <div>
                    <div className="text-xs uppercase tracking-widest" style={{ color: COLORS.dim }}>Selected</div>
                    <div className="text-base font-semibold" style={{ color: COLORS.text }}>{sel.type === "actor" ? "Performer" : sel.type === "camera" ? "Camera / shot" : "Set piece"}</div>
                  </div>
                  <Btn onClick={() => { setSelected(null); setPane("shots"); }}>Done</Btn>
                </div>
                <Field label="Name">
                  <input
                    value={sel.name}
                    onChange={(e) => patch(sel.id, { name: e.target.value })}
                    className="w-full px-2 py-1 rounded text-sm"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  />
                </Field>

                <Field label="Layer context">
                  <select
                    value={normalizeLayerContext(sel.layerContext)}
                    onChange={(e) => patch(sel.id, { layerContext: e.target.value })}
                    data-testid="select-object-layer-context"
                    className="w-full px-2 py-1 rounded text-sm"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  >
                    <option value={DIRECTOR}>Director</option>
                    <option value={CINEMATOGRAPHY}>Cinematography</option>
                    <option value="BOTH">Both layers</option>
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <label
                    className="h-9 px-2 rounded flex items-center gap-2 text-xs"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  >
                    <input
                      type="checkbox"
                      checked={sel.isVisible !== false}
                      onChange={(e) => patch(sel.id, { isVisible: e.target.checked })}
                      data-testid="checkbox-object-visible"
                    />
                    Visible
                  </label>
                  <label
                    className="h-9 px-2 rounded flex items-center gap-2 text-xs"
                    style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  >
                    <input
                      type="checkbox"
                      checked={!!sel.isLocked}
                      onChange={(e) => patch(sel.id, { isLocked: e.target.checked })}
                      data-testid="checkbox-object-locked"
                    />
                    Lock object
                  </label>
                </div>

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
                    <Btn
                      onClick={() => {
                        const shot = shots.find((s) => s.cam.id === sel.id);
                        if (shot) setPreviewShot(shot);
                      }}
                      accent
                    >
                      Open 3D previs
                    </Btn>
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
                    <Field label="Previs format">
                      <select
                        value={sel.previsAspect || "2.39"}
                        onChange={(e) => patch(sel.id, { previsAspect: e.target.value })}
                        data-testid="select-previs-aspect"
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        {PREVIS_ASPECT_RATIOS.map((format) => (
                          <option key={format.id} value={format.id}>
                            {format.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Shot color">
                        <input
                          type="color"
                          aria-label="Shot color"
                          value={sel.color || COLORS.camera}
                          onChange={(e) => patch(sel.id, { color: e.target.value })}
                          className="h-9 w-full rounded cursor-pointer"
                          style={{ background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}
                        />
                      </Field>
                      <Field label="Field of view">
                        <label className="h-9 px-2 rounded flex items-center gap-2 text-xs" style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}>
                          <input
                            type="checkbox"
                            checked={sel.showFov !== false}
                            onChange={(e) => patch(sel.id, { showFov: e.target.checked })}
                          />
                          Show guide
                        </label>
                      </Field>
                    </div>
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
                    <details
                      open={pathEditCameraId === sel.id}
                      className="rounded overflow-hidden"
                      style={{ border: `1px solid ${COLORS.rule}`, background: "rgba(8,13,18,0.28)" }}
                    >
                      <summary
                        className="cursor-pointer px-2.5 py-2 text-xs font-semibold flex items-center justify-between"
                        style={{ color: COLORS.text }}
                      >
                        <span>Camera movement path</span>
                        <span style={{ color: COLORS.camera }}>
                          {cameraMotionMarks(sel).length ? `${cameraMotionMarks(sel).length} marks · ${cameraMotionDuration(sel).toFixed(1)}s` : "No marks"}
                        </span>
                      </summary>
                      <div className="px-2.5 pb-2.5 space-y-2.5">
                        <p className="text-[11px] leading-4" style={{ color: COLORS.dim }}>
                          Mark 1 anchors the camera. Add or drag later marks to shape a smooth curve. Use the small direction handle at a mark to pan independently.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <Btn
                            onClick={() => {
                              if (!cameraMotionMarks(sel).length) startCameraPath(sel.id);
                              else setPathEditCameraId((current) => (current === sel.id ? null : sel.id));
                            }}
                            data-testid="button-edit-camera-path"
                            accent={pathEditCameraId === sel.id}
                          >
                            {!cameraMotionMarks(sel).length ? "Start marks" : pathEditCameraId === sel.id ? "Finish marks" : "Edit marks"}
                          </Btn>
                          <Btn
                            onClick={() => addCameraMark(sel.id)}
                            disabled={!cameraMotionMarks(sel).length}
                            data-testid="button-add-camera-mark"
                          >
                            Add mark
                          </Btn>
                        </div>
                        {cameraMotionMarks(sel).length > 1 && (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <Btn
                                onClick={() => (pathPlayback.cameraId === sel.id && pathPlayback.playing ? stopCameraPath() : playCameraPath(sel.id))}
                                data-testid="button-play-camera-path"
                                accent
                              >
                                {pathPlayback.cameraId === sel.id && pathPlayback.playing ? "Pause path" : "Preview path"}
                              </Btn>
                              <Btn
                                onClick={() => {
                                  playbackStartedAtRef.current = null;
                                  setPathPlayback({ cameraId: sel.id, progress: 0, playing: false });
                                }}
                                data-testid="button-reset-camera-path-preview"
                              >
                                Reset preview
                              </Btn>
                            </div>
                            <label className="block text-[11px]" style={{ color: COLORS.dim }}>
                              Path preview {Math.round((pathPlayback.cameraId === sel.id ? pathPlayback.progress : 0) * 100)}%
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.001"
                                value={pathPlayback.cameraId === sel.id ? pathPlayback.progress : 0}
                                onChange={(event) => {
                                  playbackStartedAtRef.current = null;
                                  setPathPlayback({ cameraId: sel.id, progress: +event.target.value, playing: false });
                                }}
                                className="w-full mt-1"
                                data-testid="input-camera-path-scrubber"
                              />
                            </label>
                          </>
                        )}
                        {pathEditCameraId === sel.id && (
                          <div className="rounded px-2 py-1.5 text-[11px]" style={{ color: COLORS.camera, background: "rgba(232,163,61,0.1)" }}>
                            Canvas edit is active. Click an open spot in the floor plan to place the next numbered mark.
                          </div>
                        )}
                        {cameraMotionMarks(sel).map((mark, index) => (
                          <div
                            key={mark.id}
                            className="rounded p-2 space-y-1.5"
                            style={{ background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}
                            data-testid={`camera-mark-editor-${index + 1}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold" style={{ color: index === 0 ? COLORS.actor : COLORS.camera }}>
                                Mark {index + 1}{index === 0 ? " · start" : index === cameraMotionMarks(sel).length - 1 ? " · stop" : ""}
                              </span>
                              {index > 0 && (
                                <button
                                  className="text-[11px] underline"
                                  style={{ color: COLORS.bad }}
                                  onClick={() => removeCameraMark(sel.id, mark.id)}
                                  data-testid={`button-remove-camera-mark-${index + 1}`}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <Field label="X">
                                <Num value={mark.x} step={0.5} onChange={(value) => updateCameraMark(sel.id, mark.id, { x: value })} />
                              </Field>
                              <Field label="Y">
                                <Num value={mark.y} step={0.5} onChange={(value) => updateCameraMark(sel.id, mark.id, { y: value })} />
                              </Field>
                              <Field label="Pan°">
                                <Num value={Math.round(mark.rot)} step={1} onChange={(value) => updateCameraMark(sel.id, mark.id, { rot: value })} />
                              </Field>
                            </div>
                            {index > 0 && (
                              <Field label="Travel from previous mark (seconds)">
                                <input
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  value={mark.duration ?? 1.5}
                                  onChange={(event) => updateCameraMark(sel.id, mark.id, { duration: Math.max(0.1, +event.target.value || 0.1) })}
                                  className="w-full px-2 py-1 rounded text-sm font-mono"
                                  style={{ background: C.ink, color: C.text, border: `1px solid ${C.rule}` }}
                                  data-testid={`input-camera-mark-duration-${index + 1}`}
                                />
                              </Field>
                            )}
                          </div>
                        ))}
                        {cameraMotionMarks(sel).length > 0 && (
                          <Btn onClick={() => clearCameraPath(sel.id)} data-testid="button-clear-camera-path">
                            Clear movement path
                          </Btn>
                        )}
                      </div>
                    </details>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Support">
                        <Sel
                          value={sel.support}
                          options={SUPPORTS}
                          onChange={(v) => patch(sel.id, { support: v })}
                        />
                      </Field>
                      <Field label="Planning minutes (optional)">
                        <input
                          type="number"
                          min="0"
                          step="5"
                          value={sel.est ?? ""}
                          placeholder="You decide"
                          onChange={(e) => {
                            const raw = e.target.value;
                            patch(sel.id, { est: raw === "" ? "" : Math.max(0, +raw) });
                          }}
                          className="w-full px-2 py-1 rounded text-sm font-mono"
                          style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                        />
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
                    <Field label="Track To actor">
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
                      Track To keeps this camera aimed at the actor through every mark
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
                    <details
                      open={pathEditActorId === sel.id}
                      className="rounded overflow-hidden"
                      style={{ border: `1px solid ${COLORS.rule}`, background: "rgba(8,13,18,0.28)" }}
                    >
                      <summary
                        className="cursor-pointer px-2.5 py-2 text-xs font-semibold flex items-center justify-between"
                        style={{ color: COLORS.text }}
                      >
                        <span>Performer blocking path</span>
                        <span style={{ color: COLORS.actor }}>
                          {actorMotionMarks(sel).length ? `${actorMotionMarks(sel).length} marks · ${actorMotionDuration(sel).toFixed(1)}s` : "No marks"}
                        </span>
                      </summary>
                      <div className="px-2.5 pb-2.5 space-y-2.5">
                        <p className="text-[11px] leading-4" style={{ color: COLORS.dim }}>
                          Mark 1 is the performer’s start. Add stops to block entrances, crosses, and turns. Each mark holds position, facing, and travel time.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <Btn
                            onClick={() => {
                              if (!actorMotionMarks(sel).length) startActorPath(sel.id);
                              else {
                                setPathEditCameraId(null);
                                setPathEditActorId((current) => (current === sel.id ? null : sel.id));
                              }
                            }}
                            data-testid="button-edit-actor-path"
                            accent={pathEditActorId === sel.id}
                          >
                            {!actorMotionMarks(sel).length ? "Start marks" : pathEditActorId === sel.id ? "Finish marks" : "Edit marks"}
                          </Btn>
                          <Btn
                            onClick={() => addActorMark(sel.id)}
                            disabled={!actorMotionMarks(sel).length}
                            data-testid="button-add-actor-mark"
                          >
                            Add mark
                          </Btn>
                        </div>
                        {actorMotionMarks(sel).length > 1 && (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <Btn
                                onClick={() => (pathPlayback.actorId === sel.id && pathPlayback.playing ? stopCameraPath() : playActorPath(sel.id))}
                                data-testid="button-play-actor-path"
                                accent
                              >
                                {pathPlayback.actorId === sel.id && pathPlayback.playing ? "Pause blocking" : "Preview blocking"}
                              </Btn>
                              <Btn
                                onClick={() => {
                                  playbackStartedAtRef.current = null;
                                  setPathPlayback({ cameraId: null, actorId: sel.id, progress: 0, playing: false });
                                }}
                                data-testid="button-reset-actor-path-preview"
                              >
                                Reset preview
                              </Btn>
                            </div>
                            <label className="block text-[11px]" style={{ color: COLORS.dim }}>
                              Blocking preview {Math.round((pathPlayback.actorId === sel.id ? pathPlayback.progress : 0) * 100)}%
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.001"
                                value={pathPlayback.actorId === sel.id ? pathPlayback.progress : 0}
                                onChange={(event) => {
                                  playbackStartedAtRef.current = null;
                                  setPathPlayback({ cameraId: null, actorId: sel.id, progress: +event.target.value, playing: false });
                                }}
                                className="w-full mt-1"
                                data-testid="input-actor-path-scrubber"
                              />
                            </label>
                          </>
                        )}
                        {pathEditActorId === sel.id && (
                          <div className="rounded px-2 py-1.5 text-[11px]" style={{ color: COLORS.actor, background: "rgba(79,209,197,0.1)" }}>
                            Canvas edit is active. Click an open spot in the floor plan to place the next numbered blocking mark.
                          </div>
                        )}
                        {actorMotionMarks(sel).map((mark, index) => (
                          <div
                            key={mark.id}
                            className="rounded p-2 space-y-1.5"
                            style={{ background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}
                            data-testid={`actor-mark-editor-${index + 1}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold" style={{ color: index === 0 ? COLORS.actor : COLORS.select }}>
                                Mark {index + 1}{index === 0 ? " · start" : index === actorMotionMarks(sel).length - 1 ? " · stop" : ""}
                              </span>
                              {index > 0 && (
                                <button
                                  className="text-[11px] underline"
                                  style={{ color: COLORS.bad }}
                                  onClick={() => removeActorMark(sel.id, mark.id)}
                                  data-testid={`button-remove-actor-mark-${index + 1}`}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <Field label="X">
                                <Num value={mark.x} step={0.5} onChange={(value) => updateActorMark(sel.id, mark.id, { x: value })} />
                              </Field>
                              <Field label="Y">
                                <Num value={mark.y} step={0.5} onChange={(value) => updateActorMark(sel.id, mark.id, { y: value })} />
                              </Field>
                              <Field label="Face°">
                                <Num value={Math.round(mark.rot)} step={1} onChange={(value) => updateActorMark(sel.id, mark.id, { rot: value })} />
                              </Field>
                            </div>
                            {index > 0 && (
                              <Field label="Travel from previous mark (seconds)">
                                <input
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  value={mark.duration ?? 1.5}
                                  onChange={(event) => updateActorMark(sel.id, mark.id, { duration: Math.max(0.1, +event.target.value || 0.1) })}
                                  className="w-full px-2 py-1 rounded text-sm font-mono"
                                  style={{ background: C.ink, color: C.text, border: `1px solid ${C.rule}` }}
                                  data-testid={`input-actor-mark-duration-${index + 1}`}
                                />
                              </Field>
                            )}
                          </div>
                        ))}
                        {actorMotionMarks(sel).length > 0 && (
                          <Btn onClick={() => clearActorPath(sel.id)} data-testid="button-clear-actor-path">
                            Clear blocking path
                          </Btn>
                        )}
                      </div>
                    </details>
                    <Field label="Stock cast profile">
                      <select
                        value={sel.previsCharacter || (sel.gender === "male" ? "marcus" : "maya")}
                        onChange={(e) => patch(sel.id, profilePatch(e.target.value))}
                        data-testid="select-previs-character"
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        <optgroup label="Male cast">
                          {PREVIS_CAST.filter((person) => person.gender === "male").map((person) => (
                            <option key={person.id} value={person.id}>{person.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Female cast">
                          {PREVIS_CAST.filter((person) => person.gender === "female").map((person) => (
                            <option key={person.id} value={person.id}>{person.label}</option>
                          ))}
                        </optgroup>
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Wardrobe">
                        <select
                          value={sel.previsWardrobe || "casual"}
                          onChange={(e) => patch(sel.id, { previsWardrobe: e.target.value })}
                          data-testid="select-previs-wardrobe"
                          className="w-full px-2 py-1 rounded text-sm"
                          style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                        >
                          {PREVIS_WARDROBES.map((wardrobe) => <option key={wardrobe.id} value={wardrobe.id}>{wardrobe.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Build">
                        <select
                          value={sel.previsBuild || "average"}
                          onChange={(e) => patch(sel.id, { previsBuild: e.target.value })}
                          data-testid="select-previs-build"
                          className="w-full px-2 py-1 rounded text-sm"
                          style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                        >
                          <option value="lean">Lean</option>
                          <option value="average">Average</option>
                          <option value="broad">Broad</option>
                        </select>
                      </Field>
                      <Field label="Skin tone">
                        <select
                          value={sel.previsSkinTone || "warm"}
                          onChange={(e) => patch(sel.id, { previsSkinTone: e.target.value })}
                          data-testid="select-previs-skin-tone"
                          className="w-full px-2 py-1 rounded text-sm"
                          style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                        >
                          {PREVIS_SKIN_TONES.map((tone) => <option key={tone.id} value={tone.id}>{tone.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Hair color">
                        <select
                          value={sel.previsHairColor || "brown"}
                          onChange={(e) => patch(sel.id, { previsHairColor: e.target.value })}
                          data-testid="select-previs-hair-color"
                          className="w-full px-2 py-1 rounded text-sm"
                          style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                        >
                          {PREVIS_HAIR_COLORS.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Hair style">
                      <select
                        value={sel.previsHairStyle || "wave"}
                        onChange={(e) => patch(sel.id, { previsHairStyle: e.target.value })}
                        data-testid="select-previs-hair-style"
                        className="w-full px-2 py-1 rounded text-sm"
                        style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                      >
                        {PREVIS_HAIR_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
                      </select>
                    </Field>
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
                      <Btn onClick={() => changeLine((l) => ({ ...l, on: true, auto: false, a: sel.id }))}>
                        Set as line A
                      </Btn>
                      <Btn onClick={() => changeLine((l) => ({ ...l, on: true, auto: false, b: sel.id }))}>
                        Set as line B
                      </Btn>
                    </div>
                  </>
                )}

                <Btn onClick={() => removeObject(sel.id)} danger disabled={!canInteractWithObject(sel)}>
                  Delete
                </Btn>
              </div>
            )}

          </div>
        </aside>
      </div>
      {contextMenu && byId[contextMenu.id] && (
        <div
          role="menu"
          aria-label={`${byId[contextMenu.id].type === "camera" ? "Camera" : "Performer"} controls`}
          data-testid={`context-menu-${byId[contextMenu.id].type}`}
          className="fixed z-[70] w-56 overflow-hidden rounded-lg p-1.5 shadow-2xl"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: COLORS.panel,
            border: `1px solid ${COLORS.rule}`,
            boxShadow: "0 18px 54px rgba(0,0,0,0.48)",
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const target = byId[contextMenu.id];
            const isCamera = target.type === "camera";
            const actionClass = "w-full rounded px-2.5 py-2 text-left text-xs font-medium transition";
            const actionStyle = { color: COLORS.text, background: "transparent" };
            const close = () => setContextMenu(null);
            return (
              <>
                <div className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: isCamera ? COLORS.camera : COLORS.actor }}>
                  {isCamera ? "Camera controls" : "Performer controls"} · {target.name}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className={actionClass}
                  style={actionStyle}
                  onClick={() => {
                    setSelected(target.id);
                    setPane("object");
                    close();
                  }}
                  data-testid="menu-open-inspector"
                >
                  Open inspector
                </button>
                {isCamera ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      onClick={() => {
                        if (!cameraMotionMarks(target).length) startCameraPath(target.id);
                        else {
                          setPathEditActorId(null);
                          setPathEditCameraId(target.id);
                        }
                        close();
                      }}
                      data-testid="menu-edit-camera-path"
                    >
                      {!cameraMotionMarks(target).length ? "Start camera marks" : "Edit camera marks"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      disabled={!cameraMotionMarks(target).length}
                      onClick={() => {
                        addCameraMark(target.id);
                        close();
                      }}
                      data-testid="menu-add-camera-mark"
                    >
                      Add next camera mark
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      disabled={cameraMotionMarks(target).length < 2}
                      onClick={() => {
                        playCameraPath(target.id);
                        close();
                      }}
                      data-testid="menu-preview-camera-path"
                    >
                      Preview camera path
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      disabled={!target.linkTo}
                      onClick={() => {
                        patch(target.id, { aim: !target.aim });
                        close();
                      }}
                      data-testid="menu-toggle-track-to"
                    >
                      {target.aim ? "Disable Track To" : "Enable Track To"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={{ ...actionStyle, color: COLORS.camera }}
                      onClick={() => {
                        const shot = shots.find((item) => item.cam.id === target.id);
                        if (shot) setPreviewShot(shot);
                        close();
                      }}
                      data-testid="menu-open-camera-previs"
                    >
                      Open 3D previs
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      onClick={() => {
                        if (!actorMotionMarks(target).length) startActorPath(target.id);
                        else {
                          setPathEditCameraId(null);
                          setPathEditActorId(target.id);
                        }
                        close();
                      }}
                      data-testid="menu-edit-actor-path"
                    >
                      {!actorMotionMarks(target).length ? "Start blocking marks" : "Edit blocking marks"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      disabled={!actorMotionMarks(target).length}
                      onClick={() => {
                        addActorMark(target.id);
                        close();
                      }}
                      data-testid="menu-add-actor-mark"
                    >
                      Add next blocking mark
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      disabled={actorMotionMarks(target).length < 2}
                      onClick={() => {
                        playActorPath(target.id);
                        close();
                      }}
                      data-testid="menu-preview-actor-path"
                    >
                      Preview blocking path
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={actionStyle}
                      onClick={() => {
                        faceNearestCamera(target.id);
                        close();
                      }}
                      data-testid="menu-face-nearest-camera"
                    >
                      Face nearest camera
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={actionClass}
                      style={{ ...actionStyle, color: COLORS.camera }}
                      disabled={!cameras.length}
                      onClick={() => {
                        setCameraTrackTarget(target.id);
                        close();
                      }}
                      data-testid="menu-set-track-target"
                    >
                      Make nearest camera Track To
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
      {previewShot && (
        <PrevisWindow
          shot={previewShot}
          objects={objects}
          walls={walls}
          openings={openings}
          onUpdateCamera={(cameraId, fields) => patch(cameraId, fields)}
          onClose={() => setPreviewShot(null)}
        />
      )}
      {shareDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Save and share scene"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(4, 8, 12, 0.8)", backdropFilter: "blur(6px)" }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setShareDialog(null);
          }}
        >
          <section className="w-full max-w-xl rounded-lg p-5 shadow-2xl" style={{ background: COLORS.panel, border: `1px solid ${COLORS.rule}` }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em]" style={{ color: COLORS.actor }}>Portable scene save</p>
                <h2 className="mt-1 text-lg font-semibold" style={{ color: COLORS.text }}>Share an editable Shot Planner scene</h2>
              </div>
              <button
                type="button"
                aria-label="Close scene sharing"
                onClick={() => setShareDialog(null)}
                className="min-h-10 rounded px-3 text-sm"
                style={{ color: COLORS.text, background: COLORS.ink, border: `1px solid ${COLORS.rule}` }}
              >
                Close
              </button>
            </div>

            {shareDialog.tooLong ? (
              <div className="mt-5 rounded p-4 text-sm leading-relaxed" style={{ background: "rgba(232,163,61,0.1)", color: COLORS.text, border: `1px solid ${COLORS.camera}` }}>
                This scene is too large for a dependable browser link. Download the complete scene file instead, then send that file through your team’s preferred channel. It will restore the full editable scene, including any blueprint underlay.
              </div>
            ) : (
              <>
                <p className="mt-5 text-sm leading-relaxed" style={{ color: COLORS.dim }}>
                  Copy this self-contained link to open the current editable scene on another browser or send it to a collaborator. Anyone with the link can view and edit it. Blueprint image underlays are excluded from links to keep them portable, but stay in the full scene file.
                </p>
                <textarea
                  readOnly
                  value={shareDialog.url}
                  aria-label="Portable scene share link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-4 h-28 w-full resize-none rounded p-3 text-xs font-mono"
                  style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                  data-testid="input-scene-share-link"
                />
                {shareDialog.error && (
                  <p className="mt-2 text-xs" style={{ color: COLORS.bad }}>{shareDialog.error}</p>
                )}
              </>
            )}

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {!shareDialog.tooLong && (
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="min-h-11 rounded text-sm font-medium"
                  style={{ background: "rgba(79,209,197,0.16)", color: COLORS.actor, border: `1px solid ${COLORS.actor}` }}
                  data-testid="button-copy-scene-share-link"
                >
                  {shareDialog.copied ? "Link copied" : "Copy share link"}
                </button>
              )}
              <button
                type="button"
                onClick={exportScene}
                className="min-h-11 rounded text-sm font-medium"
                style={{ background: COLORS.ink, color: COLORS.text, border: `1px solid ${COLORS.rule}` }}
                data-testid="button-download-scene-file"
              >
                Download full scene file
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function Btn({ children, onClick, disabled, accent, danger, active, ...buttonProps }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      {...buttonProps}
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
