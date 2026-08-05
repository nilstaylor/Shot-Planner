"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const RAD = Math.PI / 180;

const palette = {
  ink: "#111820",
  panel: "#18232e",
  rule: "#2f4252",
  text: "#d6e1e8",
  dim: "#91a2af",
  amber: "#e8a33d",
  teal: "#4fd1c5",
  male: "#34526d",
  female: "#75465d",
  skin: "#c98762",
  prop: "#718699",
};

const vec = (o, height = 0) => new THREE.Vector3(o.x, height, o.y);
const subjectForShot = (shot, objects) =>
  shot.subject || objects.find((o) => o.id === shot.cam.linkTo) || objects.find((o) => o.type === "actor") || null;
const wallLength = (wall) => Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
const wallPoint = (wall, t) => ({
  x: wall.a.x + (wall.b.x - wall.a.x) * t,
  y: wall.a.y + (wall.b.y - wall.a.y) * t,
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const wallSlices = (wall, openings) => {
  const length = Math.max(wallLength(wall), 0.01);
  const gaps = openings
    .filter((opening) => opening.wallId === wall.id)
    .map((opening) => {
      const half = (Number(opening.width) || 0) / (2 * length);
      return { start: clamp(opening.t - half, 0, 1), end: clamp(opening.t + half, 0, 1) };
    })
    .sort((a, b) => a.start - b.start);
  const result = [];
  let cursor = 0;
  gaps.forEach((gap) => {
    if (gap.start > cursor + 0.002) result.push({ start: cursor, end: gap.start });
    cursor = Math.max(cursor, gap.end);
  });
  if (cursor < 0.998) result.push({ start: cursor, end: 1 });
  return result;
};

function addMesh(group, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function makeActor(actor) {
  const group = new THREE.Group();
  const height = Math.max(2.5, Number(actor.height) || 5.9);
  const gender = actor.gender || "female";
  const clothing = new THREE.MeshStandardMaterial({
    color: gender === "male" ? palette.male : palette.female,
    roughness: 0.78,
  });
  const skin = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: "#1c2630", roughness: 0.86 });
  const scale = height / 5.9;

  if (gender === "female") {
    addMesh(group, new THREE.ConeGeometry(0.46 * scale, 1.45 * scale, 6), clothing, [0, 1.62 * scale, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.27 * scale, 0.31 * scale, 0.95 * scale, 8), clothing, [0, 2.72 * scale, 0]);
  } else {
    addMesh(group, new THREE.CylinderGeometry(0.38 * scale, 0.47 * scale, 1.48 * scale, 8), clothing, [0, 1.74 * scale, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.32 * scale, 0.35 * scale, 0.75 * scale, 8), clothing, [0, 2.78 * scale, 0]);
  }

  for (const side of [-1, 1]) {
    addMesh(
      group,
      new THREE.CylinderGeometry(0.13 * scale, 0.14 * scale, 1.55 * scale, 7),
      dark,
      [side * 0.23 * scale, 0.77 * scale, 0]
    );
    addMesh(
      group,
      new THREE.CylinderGeometry(0.1 * scale, 0.1 * scale, 1.35 * scale, 7),
      skin,
      [side * 0.68 * scale, 2.37 * scale, 0],
      [0, 0, side * -0.25]
    );
  }

  addMesh(group, new THREE.SphereGeometry(0.36 * scale, 16, 12), skin, [0, 3.46 * scale, 0]);
  addMesh(group, new THREE.SphereGeometry(0.38 * scale, 16, 12), dark, [0, 3.61 * scale, 0.04 * scale]);
  addMesh(group, new THREE.SphereGeometry(0.36 * scale, 16, 12), skin, [0, 3.48 * scale, -0.04 * scale]);

  group.position.copy(vec(actor));
  group.rotation.y = -actor.rot * RAD;
  group.userData.name = actor.name;
  return group;
}

function makeProp(prop) {
  const group = new THREE.Group();
  const name = (prop.name || "").toLowerCase();
  const w = Math.max(0.5, Number(prop.w) || 3);
  const d = Math.max(0.5, Number(prop.d) || 3);
  const base = new THREE.MeshStandardMaterial({ color: palette.prop, roughness: 0.82 });
  const dark = new THREE.MeshStandardMaterial({ color: "#354651", roughness: 0.9 });
  const cushion = new THREE.MeshStandardMaterial({ color: "#536e80", roughness: 0.95 });

  if (name.includes("round") || name.includes("circle")) {
    addMesh(group, new THREE.CylinderGeometry(Math.max(w, d) / 2, Math.max(w, d) / 2, 0.16, 24), base, [0, 2.25, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.14, 0.19, 2.25, 10), dark, [0, 1.12, 0]);
  } else if (name.includes("table")) {
    addMesh(group, new THREE.BoxGeometry(w, 0.16, d), base, [0, 2.25, 0]);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        addMesh(group, new THREE.BoxGeometry(0.18, 2.25, 0.18), dark, [x * (w / 2 - 0.25), 1.12, z * (d / 2 - 0.25)]);
      }
    }
  } else if (name.includes("sofa") || name.includes("couch")) {
    addMesh(group, new THREE.BoxGeometry(w, 0.75, d), cushion, [0, 0.8, 0]);
    addMesh(group, new THREE.BoxGeometry(w, 1.0, 0.28), base, [0, 1.45, d / 2 - 0.14]);
    addMesh(group, new THREE.BoxGeometry(0.28, 0.9, d), base, [-w / 2 + 0.14, 1.2, 0]);
    addMesh(group, new THREE.BoxGeometry(0.28, 0.9, d), base, [w / 2 - 0.14, 1.2, 0]);
  } else if (name.includes("chair")) {
    addMesh(group, new THREE.BoxGeometry(w, 0.2, d), cushion, [0, 1.1, 0]);
    addMesh(group, new THREE.BoxGeometry(w, 1.05, 0.18), base, [0, 1.6, d / 2 - 0.09]);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        addMesh(group, new THREE.BoxGeometry(0.13, 1.1, 0.13), dark, [x * (w / 2 - 0.15), 0.55, z * (d / 2 - 0.15)]);
      }
    }
  } else if (name.includes("bed")) {
    addMesh(group, new THREE.BoxGeometry(w, 0.55, d), cushion, [0, 0.55, 0]);
    addMesh(group, new THREE.BoxGeometry(w, 1.75, 0.24), base, [0, 1.0, d / 2 - 0.12]);
    addMesh(group, new THREE.BoxGeometry(w * 0.42, 0.22, d * 0.23), new THREE.MeshStandardMaterial({ color: "#e8e2d4", roughness: 1 }), [0, 0.94, -d * 0.23]);
  } else {
    addMesh(group, new THREE.BoxGeometry(w, Math.min(Math.max(d * 0.45, 0.5), 3), d), base, [0, Math.min(Math.max(d * 0.45, 0.5), 3) / 2, 0]);
  }

  group.position.copy(vec(prop));
  group.rotation.y = -prop.rot * RAD;
  group.userData.name = prop.name;
  return group;
}

function makeWallSegment(wall, segment) {
  const start = wallPoint(wall, segment.start);
  const end = wallPoint(wall, segment.end);
  const length = Math.max(0.08, Math.hypot(end.x - start.x, end.y - start.y));
  const height = 8;
  const material = new THREE.MeshStandardMaterial({
    color: wall.style === "translucent" ? "#60717f" : "#c5cbd0",
    roughness: 0.92,
    transparent: wall.style === "translucent",
    opacity: wall.style === "translucent" ? 0.46 : 1,
  });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, Math.max(0.12, Number(wall.thickness) || 0.32)),
    material
  );
  mesh.position.set((start.x + end.x) / 2, height / 2, (start.y + end.y) / 2);
  mesh.rotation.y = -Math.atan2(end.y - start.y, end.x - start.x);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeScene(objects, walls = [], openings = []) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.ink);
  scene.fog = new THREE.Fog(palette.ink, 25, 95);

  const hemisphere = new THREE.HemisphereLight("#c3d5df", "#151a1e", 2.4);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight("#ffe6c2", 3.4);
  key.position.set(-14, 22, 10);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#4b93b7", 1.25);
  fill.position.set(16, 10, -22);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: "#26323b", roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(100, 100, "#4a5d6c", "#344653");
  grid.position.y = 0.01;
  scene.add(grid);

  walls.forEach((wall) => wallSlices(wall, openings).forEach((segment) => scene.add(makeWallSegment(wall, segment))));
  objects.filter((o) => o.type === "prop").forEach((prop) => scene.add(makeProp(prop)));
  objects.filter((o) => o.type === "actor").forEach((actor) => scene.add(makeActor(actor)));
  return scene;
}

function shotCamera(shot, subject, controls) {
  const sensor = { "Super 35": { h: 14 }, "Full Frame": { h: 20.25 }, "Micro 4/3": { h: 9.73 }, "Super 16": { h: 7.41 } }[
    shot.cam.sensor
  ] || { h: 14 };
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(sensor.h / (2 * shot.cam.focal)));
  const target = subject ? vec(subject, Math.max(2.2, (subject.height || 5.9) * 0.56)) : new THREE.Vector3(0, 2.5, 0);
  const base = vec(shot.cam, Math.max(0.5, shot.cam.height || 5.4));
  const baseDirection = base.clone().sub(target);
  const radius = Math.max(3, Math.hypot(baseDirection.x, baseDirection.z)) * (1 + controls.dolly / 100);
  const angle = Math.atan2(baseDirection.x, baseDirection.z) + controls.orbit * RAD;
  const pos = new THREE.Vector3(
    target.x + Math.sin(angle) * radius,
    Math.max(0.4, base.y + controls.raise),
    target.z + Math.cos(angle) * radius
  );
  return { fov, position: pos, target };
}

function drawFallbackPrevis(canvas, shot, objects, walls = []) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || canvas.width || 640));
  const height = Math.max(180, Math.round(rect.height || canvas.height || 360));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isHigh = (shot.cam.height || 5.4) >= 7;
  const isLow = (shot.cam.height || 5.4) <= 3.5;
  const horizon = isHigh ? height * 0.33 : isLow ? height * 0.7 : height * 0.52;
  const subject = subjectForShot(shot, objects);
  ctx.fillStyle = palette.ink;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#26323b";
  ctx.fillRect(0, horizon, width, height - horizon);
  ctx.strokeStyle = "#405260";
  ctx.lineWidth = 1;
  for (let i = -7; i <= 7; i += 1) {
    ctx.beginPath();
    ctx.moveTo(width / 2, horizon);
    ctx.lineTo(width / 2 + i * width * 0.14, height);
    ctx.stroke();
  }
  for (let i = 1; i <= 9; i += 1) {
    const y = horizon + ((height - horizon) * i * i) / 81;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  walls.slice(0, 5).forEach((wall, index) => {
    const x = width * (0.12 + (index * 0.2) % 0.75);
    const y = horizon + (index % 2) * 24;
    const span = Math.min(width * 0.52, Math.max(54, wallLength(wall) * 9));
    ctx.fillStyle = wall.style === "translucent" ? "rgba(194, 204, 210, 0.38)" : "#c5cbd0";
    ctx.fillRect(x, y - 60, Math.max(4, (wall.thickness || 0.32) * 15), 60);
    ctx.fillRect(x, y - 60, span, Math.max(4, (wall.thickness || 0.32) * 15));
  });

  const drawProp = (prop, index) => {
    const x = width * (0.16 + ((index * 0.31) % 0.7));
    const y = horizon + (height - horizon) * (0.56 + (index % 2) * 0.12);
    const w = Math.min(width * 0.32, Math.max(40, prop.w * 13));
    const d = Math.max(18, prop.d * 5);
    ctx.fillStyle = "#6e8392";
    ctx.fillRect(x - w / 2, y - d, w, d);
    ctx.fillStyle = "#475d6d";
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - d);
    ctx.lineTo(x - w / 2 + 12, y - d - 10);
    ctx.lineTo(x + w / 2 + 12, y - d - 10);
    ctx.lineTo(x + w / 2, y - d);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#bfd0da";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(prop.name, x, y + 18);
  };

  objects.filter((object) => object.type === "prop").slice(0, 4).forEach(drawProp);
  objects.filter((object) => object.type === "actor").forEach((actor, index) => {
    const isSubject = subject?.id === actor.id;
    const scale = isSubject ? 1.25 : 0.86;
    const x = isSubject ? width / 2 : width * (index === 0 ? 0.26 : 0.74);
    const floor = height * (isSubject ? 0.82 : 0.78);
    const body = 68 * scale;
    const color = (actor.gender || "female") === "male" ? palette.male : palette.female;
    ctx.fillStyle = "#c98762";
    ctx.beginPath();
    ctx.arc(x, floor - body - 22 * scale, 14 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    if ((actor.gender || "female") === "female") {
      ctx.beginPath();
      ctx.moveTo(x, floor - body);
      ctx.lineTo(x - 27 * scale, floor - 6);
      ctx.lineTo(x + 27 * scale, floor - 6);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x - 20 * scale, floor - body, 40 * scale, body - 7);
    }
    ctx.fillStyle = "#c8d4de";
    ctx.font = `${isSubject ? 14 : 12}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(`${actor.name} · ${(actor.gender || "female") === "male" ? "M" : "F"}`, x, floor + 20);
  });
}

export function renderPrevisFrame({ shot, objects, walls = [], openings = [], width = 640, height = 360 }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const fallbackImage = () => {
    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.width = width;
    fallbackCanvas.height = height;
    drawFallbackPrevis(fallbackCanvas, shot, objects, walls);
    return fallbackCanvas.toDataURL("image/jpeg", 0.9);
  };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return fallbackImage();
  }
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = makeScene(objects, walls, openings);
  const subject = subjectForShot(shot, objects);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 150);
  const framing = shotCamera(shot, subject, { orbit: 0, raise: 0, dolly: 0 });
  camera.fov = THREE.MathUtils.clamp(framing.fov, 12, 95);
  camera.position.copy(framing.position);
  camera.lookAt(framing.target);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  if (renderer.getContext().isContextLost()) {
    renderer.dispose();
    renderer.forceContextLoss?.();
    return fallbackImage();
  }
  const image = canvas.toDataURL("image/jpeg", 0.9);
  scene.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((m) => m.dispose());
    }
  });
  renderer.dispose();
  renderer.forceContextLoss?.();
  return image;
}

export default function PrevisWindow({ shot, objects, walls = [], openings = [], onClose }) {
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const [controls, setControls] = useState({ orbit: 0, raise: 0, dolly: 0 });
  const [fallback, setFallback] = useState(false);
  const subject = useMemo(() => subjectForShot(shot, objects), [shot, objects]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (fallback) {
      const renderFallback = () => drawFallbackPrevis(canvas, shot, objects, walls);
      renderFallback();
      const observer = new ResizeObserver(renderFallback);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    } catch {
      setFallback(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = makeScene(objects, walls, openings);
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 150);

    const render = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const framing = shotCamera(shot, subject, controls);
      camera.fov = THREE.MathUtils.clamp(framing.fov, 12, 95);
      camera.position.copy(framing.position);
      camera.lookAt(framing.target);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      if (renderer.getContext().isContextLost()) setFallback(true);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      scene.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.forceContextLoss?.();
    };
  }, [controls, fallback, objects, walls, openings, shot, subject]);

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setControls((current) => ({
      ...current,
      orbit: THREE.MathUtils.clamp(current.orbit - dx * 0.35, -120, 120),
      raise: THREE.MathUtils.clamp(current.raise + dy * 0.025, -4, 8),
    }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`3D previs for ${shot.slate}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(4, 8, 12, 0.78)", backdropFilter: "blur(5px)" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="w-full max-w-5xl overflow-hidden rounded-lg shadow-2xl"
        style={{ background: palette.panel, border: `1px solid ${palette.rule}` }}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: `1px solid ${palette.rule}` }}>
          <div>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: palette.dim }}>
              3D previs
            </p>
            <h2 className="mt-1 text-lg font-semibold" style={{ color: palette.text }}>
              {shot.slate}{shot.multicam ? ` · Camera ${shot.camLetter}` : ""} · {shot.description}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded text-sm"
            style={{ color: palette.text, border: `1px solid ${palette.rule}`, background: "#111820" }}
          >
            Close
          </button>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="relative min-h-[20rem]" style={{ background: palette.ink }}>
            <canvas
              key={fallback ? "fallback" : "three"}
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="absolute inset-0 h-full w-full touch-none"
              style={{ cursor: drag.current ? "grabbing" : "grab" }}
            />
            {fallback && (
              <div
                className="absolute right-4 top-4 rounded px-3 py-2 text-xs"
                style={{ background: "rgba(12, 18, 25, 0.78)", color: palette.dim, border: `1px solid rgba(146, 164, 177, 0.25)` }}
              >
                Canvas previs mode
              </div>
            )}
            <div
              className="absolute left-4 top-4 rounded px-3 py-2 text-xs"
              style={{ background: "rgba(12, 18, 25, 0.78)", color: palette.dim, border: `1px solid rgba(146, 164, 177, 0.25)` }}
            >
              Drag to orbit and raise the camera.
            </div>
          </div>

          <aside className="space-y-4 p-4" style={{ borderLeft: `1px solid ${palette.rule}` }}>
            <div>
              <p className="text-xs uppercase tracking-wider" style={{ color: palette.dim }}>Shot camera</p>
              <p className="mt-1 text-sm font-semibold" style={{ color: palette.amber }}>
                {shot.cam.focal}mm · {shot.cam.sensor}
              </p>
              <p className="mt-1 text-xs" style={{ color: palette.dim }}>
                {shot.height} · {shot.rel || "unlinked"} · {shot.distance.toFixed(1)} ft
              </p>
            </div>
            <label className="block text-xs" style={{ color: palette.text }}>
              Orbit <span style={{ color: palette.dim }}>{Math.round(controls.orbit)}°</span>
              <input
                aria-label="Orbit camera"
                type="range"
                min="-120"
                max="120"
                value={controls.orbit}
                onChange={(event) => setControls((current) => ({ ...current, orbit: +event.target.value }))}
                className="mt-2 w-full"
              />
            </label>
            <label className="block text-xs" style={{ color: palette.text }}>
              Raise / lower <span style={{ color: palette.dim }}>{controls.raise.toFixed(1)} ft</span>
              <input
                aria-label="Raise or lower camera"
                type="range"
                min="-4"
                max="8"
                step="0.1"
                value={controls.raise}
                onChange={(event) => setControls((current) => ({ ...current, raise: +event.target.value }))}
                className="mt-2 w-full"
              />
            </label>
            <label className="block text-xs" style={{ color: palette.text }}>
              Dolly <span style={{ color: palette.dim }}>{controls.dolly > 0 ? "+" : ""}{controls.dolly}%</span>
              <input
                aria-label="Dolly camera"
                type="range"
                min="-60"
                max="80"
                value={controls.dolly}
                onChange={(event) => setControls((current) => ({ ...current, dolly: +event.target.value }))}
                className="mt-2 w-full"
              />
            </label>
            <button
              type="button"
              onClick={() => setControls({ orbit: 0, raise: 0, dolly: 0 })}
              className="min-h-11 w-full rounded text-sm font-medium"
              style={{ color: palette.text, border: `1px solid ${palette.rule}`, background: "#111820" }}
            >
              Reset to shot camera
            </button>
            <div className="rounded p-3 text-xs" style={{ background: "#111820", color: palette.dim, border: `1px solid ${palette.rule}` }}>
              <p className="font-semibold" style={{ color: palette.text }}>Previs cast</p>
              {objects.filter((object) => object.type === "actor").map((actor) => (
                <p key={actor.id} className="mt-1">
                  {actor.name}: {actor.gender === "male" ? "generic male" : "generic female"}
                </p>
              ))}
              <p className="mt-2">
                {objects.filter((object) => object.type === "prop").length} dimensional set object{objects.filter((object) => object.type === "prop").length === 1 ? "" : "s"} and {walls.length} wall segment{walls.length === 1 ? "" : "s"} in frame.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
