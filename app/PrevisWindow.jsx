"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { appearanceForActor, aspectRatioFor, PREVIS_ASPECT_RATIOS } from "./previsCast";
import { motionPathDuration, sampleMotionPath } from "./motionPath";

const RAD = Math.PI / 180;

const palette = {
  night: "#08111b",
  midnight: "#0d1a26",
  panel: "#122332",
  panelHi: "#183145",
  rule: "#29475c",
  text: "#e5eef3",
  dim: "#93a8b7",
  amber: "#f1af4c",
  cyan: "#68d8db",
  blue: "#476f91",
  burgundy: "#84506d",
  skin: "#d89a73",
  hair: "#202934",
  floor: "#243440",
  prop: "#7d96a7",
  wood: "#725944",
  sofa: "#456a74",
};

const vec = (object, height = 0) => new THREE.Vector3(Number(object.x) || 0, height, Number(object.y) || 0);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toFixed = (value, digits = 1) => Number(value || 0).toFixed(digits);
const motionMarksForCamera = (camera) => (Array.isArray(camera?.motionPath) ? camera.motionPath : []);
const localMotionProgress = (object, globalProgress = 0, timelineDuration = 0) => {
  const duration = motionPathDuration(motionMarksForCamera(object));
  if (!timelineDuration || !duration) return globalProgress;
  return clamp((globalProgress * timelineDuration) / duration, 0, 1);
};
const cameraAtMotionProgress = (camera, progress = 0, timelineDuration = 0) => {
  const marks = motionMarksForCamera(camera);
  if (marks.length < 2) return camera;
  const pose = sampleMotionPath(marks, localMotionProgress(camera, progress, timelineDuration));
  return pose ? { ...camera, ...pose } : camera;
};
const animatePerformersAtProgress = (objects, progress = 0, timelineDuration = 0) =>
  objects.map((object) => {
    if (object.type !== "actor") return object;
    const marks = motionMarksForCamera(object);
    if (marks.length < 2) return object;
    const pose = sampleMotionPath(marks, localMotionProgress(object, progress, timelineDuration));
    return pose ? { ...object, ...pose } : object;
  });
const subjectForShot = (shot, objects) =>
  objects.find((object) => object.id === shot.cam?.linkTo || object.id === shot.subject?.id) ||
  shot.subject ||
  objects.find((object) => object.type === "actor") ||
  null;
const wallLength = (wall) => Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
const wallPoint = (wall, t) => ({
  x: wall.a.x + (wall.b.x - wall.a.x) * t,
  y: wall.a.y + (wall.b.y - wall.a.y) * t,
});

const sensorHeights = {
  "Super 35": 14,
  "Full Frame": 20.25,
  "Micro 4/3": 9.73,
  "Super 16": 7.41,
};

const framingPresets = [
  { id: "shot", label: "Shot camera", controls: { orbit: 0, raise: 0, dolly: 0, focus: 0.84 } },
  { id: "low", label: "Low angle", controls: { orbit: 0, raise: -2.7, dolly: -12, focus: 0.78 } },
  { id: "eye", label: "Eye line", controls: { orbit: 0, raise: 0, dolly: 0, focus: 0.84 } },
  { id: "high", label: "High angle", controls: { orbit: 0, raise: 4.8, dolly: 10, focus: 0.66 } },
  { id: "overhead", label: "Overhead", controls: { orbit: 0, raise: 10, dolly: 35, focus: 0.18 } },
];

const defaultControls = (shot) => {
  const savedView = shot?.cam?.previsView || {};
  return {
    orbit: clamp(Number(savedView.orbit) || 0, -155, 155),
    raise: clamp(Number(savedView.raise) || 0, -4, 11),
    dolly: clamp(Number(savedView.dolly) || 0, -60, 80),
    focal: clamp(Number(savedView.focal ?? shot?.cam?.focal) || 35, 18, 135),
    focus: clamp(Number(savedView.focus) || 0.84, 0.15, 0.9),
    aspect: shot?.cam?.previsAspect || "2.39",
    motionProgress: 0,
  };
};

const cameraFieldsForControls = (controls, preset) => ({
  focal: +Number(controls.focal).toFixed(1),
  previsAspect: controls.aspect,
  previsPreset: preset,
  previsView: {
    orbit: +Number(controls.orbit).toFixed(2),
    raise: +Number(controls.raise).toFixed(2),
    dolly: +Number(controls.dolly).toFixed(2),
    focal: +Number(controls.focal).toFixed(1),
    focus: +Number(controls.focus).toFixed(3),
  },
});

const previewFrame = (width, height, aspectId) => {
  const aspect = aspectRatioFor(aspectId).value;
  if (width / height > aspect) {
    const frameWidth = Math.round(height * aspect);
    return { x: Math.round((width - frameWidth) / 2), y: 0, width: frameWidth, height, aspect };
  }
  const frameHeight = Math.round(width / aspect);
  return { x: 0, y: Math.round((height - frameHeight) / 2), width, height: frameHeight, aspect };
};

const shotScaleFromDescription = (description = "") => {
  const text = String(description).toUpperCase();
  return ["ECU", "BCU", "CU", "MCU", "MS", "MLS", "WS", "EWS"].find((code) => new RegExp(`\\b${code}\\b`).test(text)) || "MS";
};

const frameHeightForShot = (description = "") => {
  const frameHeights = {
    ECU: 0.9,
    BCU: 2.7,
    CU: 3.3,
    MCU: 4.1,
    MS: 5.1,
    MLS: 6.4,
    WS: 8.2,
    EWS: 12,
  };
  return frameHeights[shotScaleFromDescription(description)] || frameHeights.MS;
};

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0,
    transparent: !!options.transparent,
    opacity: options.opacity ?? 1,
  });
}

function colorVariant(color, multiplier = 1) {
  return new THREE.Color(color).multiplyScalar(multiplier).getStyle();
}

function addMesh(group, geometry, meshMaterial, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinderBetween(group, start, end, radius, meshMaterial, radialSegments = 10) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments), meshMaterial);
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addTaperedCylinderBetween(group, start, end, startRadius, endRadius, meshMaterial, radialSegments = 12) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(endRadius, startRadius, direction.length(), radialSegments),
    meshMaterial
  );
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function makeActor(actor, isSubject = false) {
  const group = new THREE.Group();
  const appearance = appearanceForActor(actor);
  const height = Math.max(4.2, appearance.height);
  const scale = height / 5.9;
  const silhouette = appearance.build === "broad" ? 1.16 : appearance.build === "lean" ? 0.88 : 1;
  const garment = material(appearance.wardrobe.color, { roughness: 0.85 });
  const garmentDark = material(appearance.wardrobe.accent, { roughness: 0.86 });
  const skin = material(appearance.skin.color, { roughness: 0.94 });
  const skinShade = material(colorVariant(appearance.skin.color, 0.78), { roughness: 0.96 });
  const hair = material(appearance.hairColor.color, { roughness: 0.96 });
  const hairHighlight = material(colorVariant(appearance.hairColor.color, 1.28), { roughness: 0.9 });
  const shoe = material("#151d25", { roughness: 0.92 });
  const accent = material(palette.amber, { roughness: 0.45, metalness: 0.1 });
  const garmentHighlight = material(colorVariant(appearance.wardrobe.color, 1.16), { roughness: 0.78 });
  const eyeWhite = material("#e9eef0", { roughness: 0.6 });
  const iris = material("#314553", { roughness: 0.42, metalness: 0.05 });
  const eyeSocket = material(colorVariant(appearance.skin.color, 0.62), { roughness: 0.96 });
  const brow = material(appearance.hairColor.color, { roughness: 0.9 });
  const lip = material(appearance.skin.id === "deep" ? "#9b5b57" : "#a85e59", { roughness: 0.74 });

  // Rounded anatomical proportions read as people at both close and wide previs distances.
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.CapsuleGeometry(0.11 * scale, 0.26 * scale, 7, 12), shoe, [side * 0.16 * scale, 0.14 * scale, 0.09 * scale], [0, 0, Math.PI / 2]);
    addTaperedCylinderBetween(
      group,
      new THREE.Vector3(side * 0.16 * scale, 0.22 * scale, 0),
      new THREE.Vector3(side * 0.17 * scale, 1.35 * scale, -0.015 * scale),
      0.105 * scale * silhouette,
      0.14 * scale * silhouette,
      garmentDark,
      14
    );
    addTaperedCylinderBetween(
      group,
      new THREE.Vector3(side * 0.17 * scale, 1.35 * scale, -0.015 * scale),
      new THREE.Vector3(side * 0.15 * scale, 2.45 * scale, 0),
      0.15 * scale * silhouette,
      0.18 * scale * silhouette,
      garmentDark,
      14
    );
    addMesh(group, new THREE.SphereGeometry(0.145 * scale * silhouette, 16, 12), garmentDark, [side * 0.17 * scale, 1.35 * scale, -0.015 * scale]);
  }
  addMesh(group, new THREE.SphereGeometry(0.35 * scale * silhouette, 18, 14), garment, [0, 2.38 * scale, 0]);
  const torso = addMesh(
    group,
    new THREE.CapsuleGeometry(0.43 * scale * silhouette, 0.92 * scale, 10, 18),
    garment,
    [0, 3.34 * scale, 0]
  );
  torso.scale.set(1, 1, 0.8);
  addMesh(group, new THREE.SphereGeometry(0.44 * scale * silhouette, 18, 14), garment, [0, 3.92 * scale, 0]);
  addMesh(group, new THREE.BoxGeometry(0.09 * scale, 1.0 * scale, 0.025 * scale), garmentHighlight, [0, 3.42 * scale, -0.36 * scale]);
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.SphereGeometry(0.185 * scale, 14, 12), garment, [side * 0.44 * scale * silhouette, 3.94 * scale, 0]);
    addTaperedCylinderBetween(
      group,
      new THREE.Vector3(side * 0.46 * scale * silhouette, 3.87 * scale, 0),
      new THREE.Vector3(side * 0.64 * scale * silhouette, 2.95 * scale, -0.03 * scale),
      0.14 * scale,
      0.105 * scale,
      garment,
      14
    );
    addMesh(group, new THREE.SphereGeometry(0.125 * scale, 14, 12), garment, [side * 0.64 * scale * silhouette, 2.95 * scale, -0.03 * scale]);
    addTaperedCylinderBetween(
      group,
      new THREE.Vector3(side * 0.64 * scale * silhouette, 2.95 * scale, -0.03 * scale),
      new THREE.Vector3(side * 0.7 * scale * silhouette, 2.42 * scale, -0.1 * scale),
      0.095 * scale,
      0.075 * scale,
      skin,
      12
    );
    addMesh(group, new THREE.SphereGeometry(0.11 * scale, 14, 12), skin, [side * 0.7 * scale * silhouette, 2.35 * scale, -0.1 * scale]);
  }
  addMesh(group, new THREE.CapsuleGeometry(0.11 * scale, 0.16 * scale, 8, 12), skin, [0, 4.43 * scale, 0]);
  const headY = 4.84 * scale;
  const head = addMesh(group, new THREE.SphereGeometry(0.365 * scale, 28, 22), skin, [0, headY, 0]);
  head.scale.set(0.93, 1.12, 0.94);
  const jaw = addMesh(group, new THREE.SphereGeometry(0.285 * scale, 22, 16), skin, [0, 4.67 * scale, -0.012 * scale]);
  jaw.scale.set(0.92, 0.62, 0.86);
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.SphereGeometry(0.07 * scale, 14, 12), skin, [side * 0.345 * scale, headY, 0]);
    addMesh(group, new THREE.SphereGeometry(0.034 * scale, 10, 8), skinShade, [side * 0.365 * scale, headY, -0.01 * scale]);
  }
  const faceZ = -0.345 * scale;
  for (const side of [-1, 1]) {
    const socket = addMesh(group, new THREE.SphereGeometry(0.072 * scale, 14, 10), eyeSocket, [side * 0.12 * scale, 4.91 * scale, -0.315 * scale]);
    socket.scale.set(1.2, 0.58, 0.34);
    const eye = addMesh(group, new THREE.SphereGeometry(0.052 * scale, 14, 10), eyeWhite, [side * 0.12 * scale, 4.9 * scale, faceZ]);
    eye.scale.set(1.08, 0.72, 0.48);
    addMesh(group, new THREE.SphereGeometry(0.026 * scale, 12, 10), iris, [side * 0.12 * scale, 4.9 * scale, -0.382 * scale]);
    addMesh(group, new THREE.BoxGeometry(0.13 * scale, 0.024 * scale, 0.022 * scale), brow, [side * 0.12 * scale, 5.02 * scale, -0.36 * scale], [0, 0, side * -0.14]);
  }
  addMesh(group, new THREE.ConeGeometry(0.055 * scale, 0.12 * scale, 10), skinShade, [0, 4.82 * scale, -0.375 * scale], [-Math.PI / 2, 0, 0]);
  addMesh(group, new THREE.SphereGeometry(0.043 * scale, 12, 10), skin, [0, 4.78 * scale, -0.382 * scale]);
  addMesh(group, new THREE.BoxGeometry(0.13 * scale, 0.022 * scale, 0.022 * scale), lip, [0, 4.65 * scale, -0.365 * scale]);
  addMesh(group, new THREE.BoxGeometry(0.08 * scale, 0.02 * scale, 0.018 * scale), skinShade, [0, 4.56 * scale, -0.35 * scale]);
  if (appearance.hairStyle === "long" || appearance.hairStyle === "braids") {
    addMesh(group, new THREE.SphereGeometry(0.39 * scale, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, headY, 0.06 * scale]);
    if (appearance.hairStyle === "long") {
      addMesh(group, new THREE.CapsuleGeometry(0.18 * scale, 0.74 * scale, 6, 12), hair, [0, 4.38 * scale, 0.13 * scale]);
      addMesh(group, new THREE.CapsuleGeometry(0.06 * scale, 0.58 * scale, 6, 10), hairHighlight, [0.27 * scale, 4.4 * scale, 0.07 * scale]);
    } else {
      for (const side of [-1, 1]) {
        addCylinderBetween(group, new THREE.Vector3(side * 0.22 * scale, 4.69 * scale, 0.1 * scale), new THREE.Vector3(side * 0.28 * scale, 3.87 * scale, 0.12 * scale), 0.047 * scale, hair, 7);
      }
    }
  } else if (appearance.hairStyle === "bun") {
    addMesh(group, new THREE.SphereGeometry(0.375 * scale, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.48), hair, [0, headY, 0.035 * scale]);
    addMesh(group, new THREE.SphereGeometry(0.15 * scale, 12, 10), hair, [0, 5.05 * scale, 0.19 * scale]);
  } else if (appearance.hairStyle === "curly") {
    [[-0.2, 0.04], [0, 0.12], [0.2, 0.04], [-0.12, -0.15], [0.12, -0.15]].forEach(([x, z]) => {
      addMesh(group, new THREE.SphereGeometry(0.18 * scale, 10, 8), hair, [x * scale, headY + 0.05 * scale, z * scale]);
    });
    addMesh(group, new THREE.SphereGeometry(0.1 * scale, 10, 8), hairHighlight, [-0.18 * scale, 5.1 * scale, -0.02 * scale]);
  } else if (appearance.hairStyle === "wave") {
    addMesh(group, new THREE.SphereGeometry(0.38 * scale, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, headY, 0.035 * scale]);
    addMesh(group, new THREE.SphereGeometry(0.17 * scale, 10, 8), hair, [0.25 * scale, 4.73 * scale, -0.08 * scale]);
    addMesh(group, new THREE.CapsuleGeometry(0.035 * scale, 0.25 * scale, 5, 8), hairHighlight, [-0.17 * scale, 5.08 * scale, -0.17 * scale], [0, 0, -0.38]);
  } else {
    const capHeight = appearance.hairStyle === "buzz" ? Math.PI * 0.34 : Math.PI * 0.48;
    addMesh(group, new THREE.SphereGeometry(0.375 * scale, 18, 12, 0, Math.PI * 2, 0, capHeight), hair, [0, headY, 0.035 * scale]);
    if (appearance.hairStyle !== "buzz") {
      addMesh(group, new THREE.BoxGeometry(0.22 * scale, 0.04 * scale, 0.08 * scale), hairHighlight, [-0.12 * scale, 5.1 * scale, -0.22 * scale], [0, 0, -0.18]);
    }
  }
  if (appearance.wardrobe.id === "formal") {
    addMesh(group, new THREE.BoxGeometry(0.08 * scale, 0.62 * scale, 0.08 * scale), accent, [0, 3.72 * scale, -0.43 * scale]);
    for (const side of [-1, 1]) {
      addMesh(group, new THREE.BoxGeometry(0.12 * scale, 0.48 * scale, 0.035 * scale), garmentHighlight, [side * 0.19 * scale * silhouette, 3.78 * scale, -0.38 * scale], [0, 0, side * 0.28]);
    }
  } else if (appearance.wardrobe.id === "outerwear") {
    addMesh(group, new THREE.BoxGeometry(0.68 * scale * silhouette, 0.12 * scale, 0.52 * scale), garmentDark, [0, 3.9 * scale, 0]);
    addMesh(group, new THREE.TorusGeometry(0.27 * scale, 0.045 * scale, 8, 18, Math.PI), garmentHighlight, [0, 4.12 * scale, -0.17 * scale], [0, 0, Math.PI]);
  } else if (appearance.wardrobe.id === "workwear") {
    addMesh(group, new THREE.BoxGeometry(0.32 * scale, 0.36 * scale, 0.045 * scale), garmentDark, [0.22 * scale * silhouette, 3.35 * scale, -0.43 * scale]);
    addMesh(group, new THREE.BoxGeometry(0.18 * scale, 0.05 * scale, 0.035 * scale), garmentHighlight, [0.22 * scale * silhouette, 3.5 * scale, -0.46 * scale]);
  } else if (appearance.wardrobe.id === "evening") {
    addMesh(group, new THREE.TorusGeometry(0.19 * scale, 0.028 * scale, 6, 18, Math.PI), garmentHighlight, [0, 4.08 * scale, -0.17 * scale], [0, 0, Math.PI]);
  } else if (appearance.wardrobe.id === "casual") {
    addMesh(group, new THREE.TorusGeometry(0.16 * scale, 0.022 * scale, 6, 16, Math.PI), garmentDark, [0, 4.08 * scale, -0.17 * scale], [0, 0, Math.PI]);
  }
  if (isSubject) {
    addMesh(group, new THREE.TorusGeometry(0.7 * scale, 0.035 * scale, 6, 40), accent, [0, 0.035, 0], [Math.PI / 2, 0, 0]);
  }

  group.position.copy(vec(actor));
  group.rotation.y = -(Number(actor.rot) || 0) * RAD;
  group.userData = { kind: "actor", label: actor.name || appearance.profile.label || "Performer" };
  return group;
}

function makeProp(prop) {
  const group = new THREE.Group();
  const name = (prop.name || "set object").toLowerCase();
  const width = Math.max(0.6, Number(prop.w) || 3);
  const depth = Math.max(0.6, Number(prop.d) || 3);
  const base = material(palette.prop, { roughness: 0.7 });
  const dark = material("#324753", { roughness: 0.8 });
  const wood = material(palette.wood, { roughness: 0.84 });
  const upholstery = material(palette.sofa, { roughness: 0.95 });
  const lamp = material("#f6d59a", { roughness: 0.35, metalness: 0.15 });

  if (name.includes("round") || name.includes("circle")) {
    addMesh(group, new THREE.CylinderGeometry(Math.max(width, depth) / 2, Math.max(width, depth) / 2, 0.16, 32), wood, [0, 2.3, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.13, 0.2, 2.28, 12), dark, [0, 1.14, 0]);
  } else if (name.includes("table") || name.includes("desk")) {
    addMesh(group, new THREE.BoxGeometry(width, 0.16, depth), wood, [0, 2.28, 0]);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        addMesh(group, new THREE.BoxGeometry(0.15, 2.28, 0.15), dark, [x * (width / 2 - 0.18), 1.14, z * (depth / 2 - 0.18)]);
      }
    }
  } else if (name.includes("sofa") || name.includes("couch")) {
    addMesh(group, new THREE.BoxGeometry(width, 0.7, depth), upholstery, [0, 0.82, 0]);
    addMesh(group, new THREE.BoxGeometry(width, 1.08, 0.25), dark, [0, 1.52, depth / 2 - 0.13]);
    addMesh(group, new THREE.BoxGeometry(0.26, 0.88, depth), dark, [-width / 2 + 0.13, 1.2, 0]);
    addMesh(group, new THREE.BoxGeometry(0.26, 0.88, depth), dark, [width / 2 - 0.13, 1.2, 0]);
  } else if (name.includes("chair")) {
    addMesh(group, new THREE.BoxGeometry(width, 0.18, depth), upholstery, [0, 1.1, 0]);
    addMesh(group, new THREE.BoxGeometry(width, 1.15, 0.16), dark, [0, 1.66, depth / 2 - 0.08]);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        addMesh(group, new THREE.BoxGeometry(0.11, 1.1, 0.11), dark, [x * (width / 2 - 0.13), 0.55, z * (depth / 2 - 0.13)]);
      }
    }
  } else if (name.includes("bed")) {
    addMesh(group, new THREE.BoxGeometry(width, 0.5, depth), upholstery, [0, 0.55, 0]);
    addMesh(group, new THREE.BoxGeometry(width, 1.65, 0.22), dark, [0, 1.0, depth / 2 - 0.11]);
    addMesh(group, new THREE.BoxGeometry(width * 0.45, 0.18, depth * 0.22), material("#d9e0dd"), [0, 0.9, -depth * 0.24]);
  } else if (name.includes("light") || name.includes("led") || name.includes("diffusion")) {
    addMesh(group, new THREE.CylinderGeometry(0.07, 0.11, 4.2, 10), dark, [0, 2.1, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24), dark, [0, 0.04, 0]);
    addMesh(group, new THREE.BoxGeometry(Math.max(1.4, width), Math.max(0.7, depth * 0.35), 0.16), lamp, [0, 4.15, 0], [0, 0.35, 0]);
  } else if (name.includes("camera") || name.includes("dolly")) {
    addMesh(group, new THREE.CylinderGeometry(0.24, 0.3, 3.4, 12), dark, [0, 1.7, 0]);
    addMesh(group, new THREE.BoxGeometry(0.9, 0.5, 0.55), base, [0, 3.55, 0]);
    addMesh(group, new THREE.CylinderGeometry(0.22, 0.22, 0.52, 16), dark, [0, 3.55, -0.45], [Math.PI / 2, 0, 0]);
  } else {
    const height = clamp(depth * 0.5, 0.6, 3);
    addMesh(group, new THREE.BoxGeometry(width, height, depth), base, [0, height / 2, 0]);
    addMesh(group, new THREE.BoxGeometry(width * 0.9, 0.06, depth * 0.9), dark, [0, height + 0.035, 0]);
  }

  group.position.copy(vec(prop));
  group.rotation.y = -(Number(prop.rot) || 0) * RAD;
  group.userData = { kind: "prop", label: prop.name || "Set object", width, depth };
  return group;
}

function wallSlices(wall, openings) {
  const length = Math.max(wallLength(wall), 0.01);
  const gaps = openings
    .filter((opening) => opening.wallId === wall.id)
    .map((opening) => {
      const half = (Number(opening.width) || 0) / (2 * length);
      return { start: clamp(opening.t - half, 0, 1), end: clamp(opening.t + half, 0, 1) };
    })
    .sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = 0;
  gaps.forEach((gap) => {
    if (gap.start > cursor + 0.002) segments.push({ start: cursor, end: gap.start });
    cursor = Math.max(cursor, gap.end);
  });
  if (cursor < 0.998) segments.push({ start: cursor, end: 1 });
  return segments;
}

function makeWallSegment(wall, segment) {
  const start = wallPoint(wall, segment.start);
  const end = wallPoint(wall, segment.end);
  const length = Math.max(0.08, Math.hypot(end.x - start.x, end.y - start.y));
  const height = 8;
  const translucent = wall.style === "translucent";
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, Math.max(0.12, Number(wall.thickness) || 0.32)),
    material(translucent ? "#6b8291" : "#c8d0d1", { roughness: 0.93, transparent: translucent, opacity: translucent ? 0.48 : 1 })
  );
  mesh.position.set((start.x + end.x) / 2, height / 2, (start.y + end.y) / 2);
  mesh.rotation.y = -Math.atan2(end.y - start.y, end.x - start.x);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { kind: "wall", label: "Wall" };
  return mesh;
}

function makeOpeningFrame(opening, wall) {
  const point = wallPoint(wall, opening.t);
  const width = Math.max(1, Number(opening.width) || 3);
  const group = new THREE.Group();
  const frameMaterial = material("#3a4d59", { roughness: 0.75 });
  addMesh(group, new THREE.BoxGeometry(0.1, 6.8, 0.2), frameMaterial, [-width / 2, 3.4, 0]);
  addMesh(group, new THREE.BoxGeometry(0.1, 6.8, 0.2), frameMaterial, [width / 2, 3.4, 0]);
  addMesh(group, new THREE.BoxGeometry(width + 0.15, 0.1, 0.2), frameMaterial, [0, 6.75, 0]);
  group.position.copy(vec(point));
  group.rotation.y = -Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  return group;
}

function boundsForScene(objects, walls) {
  const points = [
    ...objects.map((object) => ({ x: Number(object.x) || 0, y: Number(object.y) || 0 })),
    ...walls.flatMap((wall) => [wall.a, wall.b]),
  ];
  if (!points.length) return { center: new THREE.Vector3(0, 0, 0), size: 26 };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.y));
  const maxZ = Math.max(...points.map((point) => point.y));
  return {
    center: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
    size: clamp(Math.max(maxX - minX, maxZ - minZ) + 18, 24, 92),
  };
}

function makeScene(objects, walls = [], openings = [], subjectId) {
  const scene = new THREE.Scene();
  const bounds = boundsForScene(objects, walls);
  scene.background = new THREE.Color(palette.night);
  scene.fog = new THREE.Fog(palette.night, bounds.size * 0.65, bounds.size * 2.5);

  scene.add(new THREE.HemisphereLight("#c8e5f0", "#071018", 1.7));
  scene.add(new THREE.AmbientLight("#d6edf5", 0.35));
  const key = new THREE.SpotLight("#ffe1bd", 1180, 75, 0.62, 0.42, 1.18);
  key.position.copy(bounds.center).add(new THREE.Vector3(-10, 24, 12));
  key.target.position.copy(bounds.center);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight("#b8d8e6", 1.1);
  fill.position.copy(bounds.center).add(new THREE.Vector3(-16, 9, -14));
  scene.add(fill);
  const rim = new THREE.DirectionalLight("#5ca8d8", 1.7);
  rim.position.copy(bounds.center).add(new THREE.Vector3(14, 10, -20));
  scene.add(rim);
  const practical = new THREE.PointLight("#d88751", 28, 22, 2);
  practical.position.copy(bounds.center).add(new THREE.Vector3(0, 7, -4));
  scene.add(practical);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.size, bounds.size),
    material(palette.floor, { roughness: 0.94 })
  );
  floor.position.copy(bounds.center);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(bounds.size, Math.round(bounds.size), "#4a6574", "#2f4958");
  grid.position.copy(bounds.center);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.48;
  scene.add(grid);

  walls.forEach((wall) => wallSlices(wall, openings).forEach((segment) => scene.add(makeWallSegment(wall, segment))));
  openings.forEach((opening) => {
    const wall = walls.find((candidate) => candidate.id === opening.wallId);
    if (wall) scene.add(makeOpeningFrame(opening, wall));
  });
  objects.filter((object) => object.type === "prop").forEach((prop) => scene.add(makeProp(prop)));
  const actorMeshes = new Map();
  objects.filter((object) => object.type === "actor").forEach((actor) => {
    const actorMesh = makeActor(actor, actor.id === subjectId);
    actorMeshes.set(actor.id, actorMesh);
    scene.add(actorMesh);
  });
  return { scene, bounds, actorMeshes };
}

function disposeScene(scene) {
  scene.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((item) => item.dispose());
    }
  });
}

function shotCamera(shot, subject, controls, timelineDuration = 0) {
  const focal = clamp(Number(controls.focal) || Number(shot.cam.focal) || 35, 18, 135);
  const sensorHeight = sensorHeights[shot.cam.sensor] || 14;
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(sensorHeight / (2 * focal)));
  const subjectHeight = Math.max(4, Number(subject?.height) || 5.9);
  const camera = cameraAtMotionProgress(shot.cam, controls.motionProgress, timelineDuration);
  const focus = typeof controls.focus === "number" ? controls.focus : 0.84;
  const cameraHeight = Math.max(0.35, Number(camera?.height) || Number(shot.cam?.height) || 5.2);
  const cameraPosition = new THREE.Vector3(Number(camera?.x) || 0, cameraHeight, Number(camera?.y) || 0);
  const subjectTarget = subject
    ? vec(subject, clamp(subjectHeight * focus, 0.6, subjectHeight - 0.25))
    : new THREE.Vector3(0, 2.7, 0);
  const trackToSubject = Boolean(shot.cam?.aim && shot.cam?.linkTo && subject);
  const heading = (Number(camera?.rot) || 0) * RAD;
  const manualTarget = new THREE.Vector3(
    cameraPosition.x + Math.sin(heading) * 10,
    // Keep the plan’s heading as the horizontal eyeline, while using the
    // chosen subject only for a natural vertical point of interest. This
    // preserves manual camera direction without starting every preview on a
    // flat, horizon-only line that pushes the performer out of frame.
    subject ? subjectTarget.y : cameraHeight + (focus - 0.84) * 5,
    cameraPosition.z - Math.cos(heading) * 10
  );
  // The 2D plan is the source of truth. A camera only tracks a performer when
  // Track To is explicitly enabled; otherwise its rot heading becomes the 3D eyeline.
  const target = trackToSubject ? subjectTarget : manualTarget;
  const plannedRadius = Math.hypot(cameraPosition.x - target.x, cameraPosition.z - target.z);
  const baseRadius = plannedRadius || 10;
  const radius = Math.max(2.5, baseRadius * (1 + (Number(controls.dolly) || 0) / 100));
  const baseDirection = new THREE.Vector3(cameraPosition.x - target.x, 0, cameraPosition.z - target.z);
  if (baseDirection.lengthSq() < 0.01) {
    baseDirection.set(Math.sin(heading || Math.PI), 0, Math.cos(heading || Math.PI));
  }
  const angle = Math.atan2(baseDirection.x, baseDirection.z) + (Number(controls.orbit) || 0) * RAD;
  const position = new THREE.Vector3(
    target.x + Math.sin(angle) * radius,
    Math.max(0.35, cameraHeight + (Number(controls.raise) || 0)),
    target.z + Math.cos(angle) * radius
  );
  return { fov: clamp(fov, 12, 95), position, target, focal, distance: position.distanceTo(target) };
}

function projectPoint(point, framing, width, height) {
  const forward = framing.target.clone().sub(framing.position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const relative = point.clone().sub(framing.position);
  const depth = relative.dot(forward);
  if (depth < 0.15) return null;
  const scale = height / (2 * Math.tan((framing.fov * RAD) / 2));
  return {
    x: width / 2 + (relative.dot(right) * scale) / depth,
    y: height / 2 - (relative.dot(up) * scale) / depth,
    depth,
  };
}

function polygon(ctx, points, fill, stroke) {
  if (points.some((point) => !point)) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// A geometric fallback that uses the real object, camera, and wall coordinates. It
// is intentionally a useful scout-frame, not a disconnected decorative illustration.
function drawFallbackPrevis(canvas, shot, objects, walls = [], openings = [], controls = defaultControls(shot), timelineDuration = 0) {
  const rect = canvas.getBoundingClientRect();
  const outerWidth = Math.max(320, Math.round(rect.width || canvas.width || 960));
  const outerHeight = Math.max(180, Math.round(rect.height || canvas.height || 540));
  canvas.width = outerWidth;
  canvas.height = outerHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const frame = previewFrame(outerWidth, outerHeight, controls.aspect);
  const { width, height } = frame;
  const subject = subjectForShot(shot, objects);
  const framing = shotCamera(shot, subject, controls, timelineDuration);
  const bounds = boundsForScene(objects, walls);
  const rawProject = (point) => projectPoint(point, framing, width, height);
  const subjectHeight = Math.max(4.2, Number(subject?.height) || 5.9);
  const rawSubjectFeet = subject ? rawProject(vec(subject, 0.05)) : null;
  const rawSubjectHead = subject ? rawProject(vec(subject, subjectHeight * 0.86)) : null;
  const rawBodyHeight = rawSubjectFeet && rawSubjectHead ? Math.abs(rawSubjectFeet.y - rawSubjectHead.y) : 0;
  const stabilizedScale = rawBodyHeight
    ? clamp(clamp(height * 0.46, 132, 360) / rawBodyHeight, 0.2, 3.2)
    : 1;
  const project = (point) => {
    const raw = rawProject(point);
    if (!raw || !rawSubjectFeet || !rawSubjectHead) return raw;
    return {
      ...raw,
      x: width / 2 + (raw.x - rawSubjectFeet.x) * stabilizedScale,
      y: height * 0.78 + (raw.y - rawSubjectFeet.y) * stabilizedScale,
    };
  };
  const subjectAnchor = subject ? vec(subject) : new THREE.Vector3();
  const fallbackForward = framing.target.clone().sub(framing.position).setY(0).normalize();
  const fallbackRight = new THREE.Vector3().crossVectors(fallbackForward, new THREE.Vector3(0, 1, 0)).normalize();
  const composedActorPoints = (actor) => {
    const relative = vec(actor).sub(subjectAnchor);
    const lateral = relative.dot(fallbackRight);
    const depth = relative.dot(fallbackForward);
    const subjectActor = actor.id === subject?.id;
    const figureHeight = clamp(
      height * (subjectActor ? 0.47 : 0.31) * (1 - clamp(depth / 48, -0.18, 0.3)),
      subjectActor ? 150 : 92,
      subjectActor ? 310 : 220
    );
    const x = clamp(width / 2 + lateral * (width / Math.max(16, bounds.size * 0.78)), width * 0.12, width * 0.88);
    const feetY = clamp(height * 0.79 + depth * 7, height * 0.62, height * 0.9);
    return {
      feet: { x, y: feetY },
      shoulders: { x, y: feetY - figureHeight * 0.6 },
      head: { x, y: feetY - figureHeight },
    };
  };

  ctx.fillStyle = "#02060a";
  ctx.fillRect(0, 0, outerWidth, outerHeight);
  ctx.save();
  ctx.translate(frame.x, frame.y);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0b1c2b");
  gradient.addColorStop(0.62, "#122637");
  gradient.addColorStop(1, "#263d49");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const half = bounds.size / 2;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(119, 168, 187, 0.25)";
  for (let i = -half; i <= half; i += 2) {
    const a = project(new THREE.Vector3(bounds.center.x + i, 0.01, bounds.center.z - half));
    const b = project(new THREE.Vector3(bounds.center.x + i, 0.01, bounds.center.z + half));
    if (a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const c = project(new THREE.Vector3(bounds.center.x - half, 0.01, bounds.center.z + i));
    const d = project(new THREE.Vector3(bounds.center.x + half, 0.01, bounds.center.z + i));
    if (c && d) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
  }

  const items = [];
  walls.forEach((wall) => {
    wallSlices(wall, openings).forEach((segment) => {
      const start = wallPoint(wall, segment.start);
      const end = wallPoint(wall, segment.end);
      const average = new THREE.Vector3((start.x + end.x) / 2, 4, (start.y + end.y) / 2);
      items.push({
        depth: average.distanceTo(framing.position),
        draw: () => {
          const a = project(new THREE.Vector3(start.x, 0, start.y));
          const b = project(new THREE.Vector3(end.x, 0, end.y));
          const c = project(new THREE.Vector3(end.x, 8, end.y));
          const d = project(new THREE.Vector3(start.x, 8, start.y));
          polygon(ctx, [a, b, c, d], wall.style === "translucent" ? "rgba(167, 205, 216, 0.28)" : "#c2c9cb", "#5b6c75");
        },
      });
    });
  });
  objects.filter((object) => object.type === "prop").forEach((prop) => {
    const width = Math.max(0.6, Number(prop.w) || 3);
    const depth = Math.max(0.6, Number(prop.d) || 3);
    const height = clamp(depth * 0.45, 0.75, 3);
    const yaw = -(Number(prop.rot) || 0) * RAD;
    const corners = [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ].map(([x, z]) => new THREE.Vector3(prop.x + x * Math.cos(yaw) - z * Math.sin(yaw), 0, prop.y + x * Math.sin(yaw) + z * Math.cos(yaw)));
    items.push({
      depth: vec(prop, height / 2).distanceTo(framing.position),
      draw: () => {
        const top = corners.map((corner) => project(corner.clone().setY(height)));
        const bottom = corners.map((corner) => project(corner));
        polygon(ctx, [bottom[0], bottom[1], top[1], top[0]], "#496675", "#2f4651");
        polygon(ctx, [bottom[1], bottom[2], top[2], top[1]], "#3b5665", "#2f4651");
        polygon(ctx, top, "#7894a4", "#b3c5cc");
      },
    });
  });
  objects.filter((object) => object.type === "actor").forEach((actor) => {
    const appearance = appearanceForActor(actor);
    const actorHeight = Math.max(4.2, appearance.height);
    items.push({
      depth: vec(actor, actorHeight / 2).distanceTo(framing.position),
      priority: actor.id === subject?.id ? 2 : 1,
      draw: () => {
        const rawFeet = project(vec(actor, 0.05));
        const rawShoulders = project(vec(actor, actorHeight * 0.67));
        const rawHead = project(vec(actor, actorHeight * 0.86));
        const rawFigureHeight = rawFeet && rawHead ? Math.abs(rawFeet.y - rawHead.y) : 0;
        const composed = composedActorPoints(actor);
        const useComposed = actor.id === subject?.id || !rawFeet || !rawShoulders || !rawHead || rawFigureHeight < 50 || rawFigureHeight > height * 0.72;
        const feet = useComposed ? composed.feet : rawFeet;
        const shoulders = useComposed ? composed.shoulders : rawShoulders;
        const head = useComposed ? composed.head : rawHead;
        // Preserve the actual camera-side placement, while keeping human figures
        // legible and compositionally useful when a software canvas is the renderer.
        const bodyHeight = clamp(Math.abs(feet.y - head.y), 66, height * (actor.id === subject?.id ? 0.56 : 0.38));
        const baseY = clamp(feet.y, height * 0.5, height * 0.9);
        const headY = baseY - bodyHeight;
        const shoulderY = headY + bodyHeight * 0.26;
        const torsoBottom = baseY - bodyHeight * 0.32;
        const silhouette = appearance.build === "broad" ? 1.16 : appearance.build === "lean" ? 0.88 : 1;
        const torsoWidth = clamp(bodyHeight * (appearance.gender === "male" ? 0.24 : 0.21) * silhouette, 17, 82);
        const headRadius = clamp(bodyHeight * 0.09, 8, 28);
        const x = clamp(head.x, width * 0.1, width * 0.9);
        const garment = appearance.wardrobe.color;
        const garmentShadow = appearance.wardrobe.accent;
        const selected = actor.id === subject?.id;
        const alpha = selected ? 1 : 0.72;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(3, 10, 16, 0.42)";
        ctx.beginPath();
        ctx.ellipse(x, baseY + 5, torsoWidth * 0.7, Math.max(4, torsoWidth * 0.15), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = selected ? palette.amber : "#d9ebf1";
        ctx.lineWidth = selected ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x - torsoWidth * 0.42, torsoBottom);
        ctx.lineTo(x - torsoWidth * 0.22, baseY);
        ctx.moveTo(x + torsoWidth * 0.42, torsoBottom);
        ctx.lineTo(x + torsoWidth * 0.22, baseY);
        ctx.stroke();
        ctx.fillStyle = garmentShadow;
        ctx.fillRect(x - torsoWidth * 0.34, torsoBottom - bodyHeight * 0.26, torsoWidth * 0.68, bodyHeight * 0.28);
        ctx.fillStyle = garment;
        ctx.beginPath();
        ctx.roundRect(
          x - torsoWidth * (appearance.gender === "female" ? 0.46 : 0.5),
          shoulderY,
          torsoWidth * (appearance.gender === "female" ? 0.92 : 1),
          torsoBottom - shoulderY,
          torsoWidth * 0.18
        );
        ctx.fill();
        ctx.strokeStyle = selected ? palette.amber : "#d9ebf1";
        ctx.lineWidth = selected ? 2.2 : 1;
        ctx.beginPath();
        ctx.moveTo(x - torsoWidth * 0.42, shoulderY + bodyHeight * 0.08);
        ctx.lineTo(x - torsoWidth * 0.72, torsoBottom - bodyHeight * 0.03);
        ctx.moveTo(x + torsoWidth * 0.42, shoulderY + bodyHeight * 0.08);
        ctx.lineTo(x + torsoWidth * 0.72, torsoBottom - bodyHeight * 0.03);
        ctx.stroke();
        ctx.fillStyle = appearance.skin.color;
        ctx.beginPath();
        ctx.arc(x, headY + headRadius * 1.15, headRadius, 0, Math.PI * 2);
        ctx.fill();
        if (headRadius >= 10) {
          ctx.fillStyle = "#edf2f1";
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(x + side * headRadius * 0.34, headY + headRadius * 1.11, headRadius * 0.16, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#334856";
            ctx.beginPath();
            ctx.arc(x + side * headRadius * 0.34, headY + headRadius * 1.11, headRadius * 0.075, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#edf2f1";
          }
          ctx.fillStyle = appearance.skin.color;
          ctx.beginPath();
          ctx.ellipse(x, headY + headRadius * 1.34, headRadius * 0.09, headRadius * 0.13, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = appearance.skin.id === "deep" ? "#9b5b57" : "#a85e59";
          ctx.lineWidth = Math.max(1, headRadius * 0.06);
          ctx.beginPath();
          ctx.moveTo(x - headRadius * 0.2, headY + headRadius * 1.58);
          ctx.lineTo(x + headRadius * 0.2, headY + headRadius * 1.58);
          ctx.stroke();
        }
        ctx.fillStyle = appearance.hairColor.color;
        ctx.beginPath();
        ctx.arc(x, headY + headRadius, headRadius * (appearance.hairStyle === "curly" ? 1.2 : 1.05), Math.PI, Math.PI * 2);
        ctx.lineTo(x + headRadius, headY + headRadius * 1.2);
        ctx.lineTo(x - headRadius, headY + headRadius * 1.2);
        ctx.closePath();
        ctx.fill();
        if (appearance.hairStyle === "long" || appearance.hairStyle === "braids") {
          ctx.fillRect(x - headRadius * 0.92, headY + headRadius * 0.7, headRadius * 1.84, bodyHeight * 0.16);
        }
        if (appearance.hairStyle === "bun") {
          ctx.beginPath();
          ctx.arc(x, headY + headRadius * 0.25, headRadius * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (selected) {
          ctx.strokeStyle = palette.amber;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.ellipse(x, baseY + 6, torsoWidth * 0.92, Math.max(8, torsoWidth * 0.24), 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = selected ? palette.amber : "#e6f2f5";
        ctx.font = `${selected ? "700" : "600"} 12px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(actor.name || "Performer", x, Math.max(22, headY - headRadius * 0.85));
        ctx.restore();
      },
    });
  });
  items.sort((a, b) => (a.priority || 0) - (b.priority || 0) || b.depth - a.depth).forEach((item) => item.draw());

  ctx.strokeStyle = "rgba(241, 175, 76, 0.42)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  [width / 3, (width / 3) * 2].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  });
  [height / 3, (height / 3) * 2].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(241, 175, 76, 0.72)";
  ctx.strokeRect(16, 16, width - 32, height - 32);
  ctx.restore();
  ctx.restore();
}

export function renderPrevisFrame({ shot, objects, walls = [], openings = [], width = 640, height = 360 }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const fallbackImage = () => {
    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.width = width;
    fallbackCanvas.height = height;
    drawFallbackPrevis(fallbackCanvas, shot, objects, walls, openings);
    return fallbackCanvas.toDataURL("image/jpeg", 0.92);
  };
  let renderer;
  let scene;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const subject = subjectForShot(shot, objects);
    const sceneState = makeScene(objects, walls, openings, subject?.id);
    scene = sceneState.scene;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    const framing = shotCamera(shot, subject, defaultControls(shot));
    const frame = previewFrame(width, height, defaultControls(shot).aspect);
    camera.fov = framing.fov;
    camera.aspect = frame.aspect;
    camera.position.copy(framing.position);
    camera.lookAt(framing.target);
    camera.updateProjectionMatrix();
    renderer.setScissorTest(false);
    renderer.setClearColor("#02060a", 1);
    renderer.clear();
    renderer.setScissorTest(true);
    renderer.setViewport(frame.x, frame.y, frame.width, frame.height);
    renderer.setScissor(frame.x, frame.y, frame.width, frame.height);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    if (renderer.getContext().isContextLost()) throw new Error("WebGL context lost");
    const image = canvas.toDataURL("image/jpeg", 0.92);
    disposeScene(scene);
    renderer.dispose();
    renderer.forceContextLoss?.();
    return image;
  } catch {
    if (scene) disposeScene(scene);
    renderer?.dispose();
    renderer?.forceContextLoss?.();
    return fallbackImage();
  }
}

export default function PrevisWindow({
  shot,
  objects,
  walls = [],
  openings = [],
  onBeginCameraUpdate,
  onUpdateCamera,
  onClose,
}) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const controlsRef = useRef(defaultControls(shot));
  const dragRef = useRef(null);
  const motionFrameRef = useRef(null);
  const [controls, setControls] = useState(() => defaultControls(shot));
  const [frameBox, setFrameBox] = useState(null);
  const [fallback, setFallback] = useState(false);
  const [activePreset, setActivePreset] = useState(() => shot?.cam?.previsPreset || "shot");
  const [motionPlaying, setMotionPlaying] = useState(false);
  const persistTransactionRef = useRef(false);
  const subject = useMemo(() => subjectForShot(shot, objects), [shot, objects]);
  const actorCount = objects.filter((object) => object.type === "actor").length;
  const propCount = objects.filter((object) => object.type === "prop").length;
  const motionMarks = motionMarksForCamera(shot?.cam);
  const motionDuration = motionPathDuration(motionMarks);
  const movingPerformers = objects.filter((object) => object.type === "actor" && motionMarksForCamera(object).length > 1);
  const performerDuration = Math.max(0, ...movingPerformers.map((actor) => motionPathDuration(motionMarksForCamera(actor))));
  const choreographyDuration = Math.max(motionDuration, performerDuration);
  const hasMotionPath = choreographyDuration > 0;
  const animatedObjects = useMemo(
    () => animatePerformersAtProgress(objects, controls.motionProgress, choreographyDuration),
    [choreographyDuration, objects, controls.motionProgress]
  );
  const animatedSubject = useMemo(() => subjectForShot(shot, animatedObjects), [shot, animatedObjects]);
  const framing = useMemo(
    () => shotCamera(shot, animatedSubject, controls, choreographyDuration),
    [choreographyDuration, shot, animatedSubject, controls]
  );

  useEffect(() => {
    const next = defaultControls(shot);
    controlsRef.current = next;
    setControls(next);
    setActivePreset(shot?.cam?.previsPreset || "shot");
    setMotionPlaying(false);
  }, [shot?.cam?.id]);

  useEffect(() => {
    controlsRef.current = controls;
    runtimeRef.current?.render();
  }, [controls]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measureFrame = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (!width || !height) return;
      const next = previewFrame(width, height, controls.aspect);
      setFrameBox((current) => (
        current &&
        current.x === next.x &&
        current.y === next.y &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next
      ));
    };
    const observer = new ResizeObserver(measureFrame);
    observer.observe(stage);
    measureFrame();
    return () => observer.disconnect();
  }, [controls.aspect]);

  useEffect(() => {
    if (!motionPlaying || !hasMotionPath) return undefined;

    const startedAt = performance.now() - controlsRef.current.motionProgress * choreographyDuration * 1000;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / (choreographyDuration * 1000));
      setControls((current) => ({ ...current, motionProgress: progress }));
      if (progress >= 1) {
        motionFrameRef.current = null;
        setMotionPlaying(false);
        return;
      }
      motionFrameRef.current = requestAnimationFrame(tick);
    };

    motionFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (motionFrameRef.current) cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    };
  }, [choreographyDuration, hasMotionPath, motionPlaying]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (motionFrameRef.current) cancelAnimationFrame(motionFrameRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const fallbackRender = () => {
      const motionObjects = animatePerformersAtProgress(objects, controlsRef.current.motionProgress, choreographyDuration);
      return drawFallbackPrevis(canvas, shot, motionObjects, walls, openings, controlsRef.current, choreographyDuration);
    };

    if (fallback) {
      fallbackRender();
      const observer = new ResizeObserver(fallbackRender);
      observer.observe(canvas);
      runtimeRef.current = { render: fallbackRender };
      return () => {
        observer.disconnect();
        if (runtimeRef.current?.render === fallbackRender) runtimeRef.current = null;
      };
    }

    let renderer;
    let sceneState;
    let observer;
    const onContextLost = (event) => {
      event.preventDefault();
      setFallback(true);
    };
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      sceneState = makeScene(objects, walls, openings, subject?.id);
      const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
      const render = () => {
        const { width, height } = canvas.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setScissorTest(false);
        renderer.setClearColor("#02060a", 1);
        renderer.clear();
        const frame = previewFrame(width, height, controlsRef.current.aspect);
        // Render into the actual selected cinema frame, not the surrounding
        // workspace canvas. The guide, live viewport, and exported image now
        // share one aspect calculation.
        renderer.setScissorTest(true);
        renderer.setViewport(frame.x, frame.y, frame.width, frame.height);
        renderer.setScissor(frame.x, frame.y, frame.width, frame.height);
        camera.aspect = frame.aspect;
        const motionObjects = animatePerformersAtProgress(objects, controlsRef.current.motionProgress, choreographyDuration);
        sceneState.actorMeshes.forEach((actorMesh, actorId) => {
          const actor = motionObjects.find((object) => object.id === actorId);
          if (!actor) return;
          actorMesh.position.copy(vec(actor));
          actorMesh.rotation.y = -(Number(actor.rot) || 0) * RAD;
        });
        const nextFraming = shotCamera(shot, subjectForShot(shot, motionObjects), controlsRef.current, choreographyDuration);
        camera.fov = nextFraming.fov;
        camera.position.copy(nextFraming.position);
        camera.lookAt(nextFraming.target);
        camera.updateProjectionMatrix();
        renderer.render(sceneState.scene, camera);
        renderer.setScissorTest(false);
      };
      canvas.addEventListener("webglcontextlost", onContextLost, false);
      observer = new ResizeObserver(render);
      observer.observe(canvas);
      runtimeRef.current = { render };
      render();
    } catch {
      setFallback(true);
    }
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      observer?.disconnect();
      if (runtimeRef.current) runtimeRef.current = null;
      if (sceneState?.scene) disposeScene(sceneState.scene);
      renderer?.dispose();
    };
  }, [choreographyDuration, fallback, objects, walls, openings, shot, subject]);

  const beginCameraUpdate = () => {
    if (persistTransactionRef.current || !shot?.cam?.id) return;
    persistTransactionRef.current = true;
    onBeginCameraUpdate?.(shot.cam.id);
  };

  const finishCameraUpdate = () => {
    persistTransactionRef.current = false;
  };

  const updateControls = (fields, preset = "custom") => {
    const next = { ...controlsRef.current, ...fields };
    controlsRef.current = next;
    setActivePreset(preset);
    setControls(next);
    if (shot?.cam?.id) onUpdateCamera?.(shot.cam.id, cameraFieldsForControls(next, preset), false);
  };

  const applyPreset = (preset) => {
    setMotionPlaying(false);
    beginCameraUpdate();
    updateControls(preset.controls, preset.id);
    finishCameraUpdate();
  };

  const chooseAspect = (format) => {
    beginCameraUpdate();
    updateControls({ aspect: format.id }, activePreset);
    finishCameraUpdate();
  };

  const toggleMotionPlayback = () => {
    if (!hasMotionPath) return;
    if (motionPlaying) {
      setMotionPlaying(false);
      return;
    }
    if (controlsRef.current.motionProgress >= 0.999) {
      setControls((current) => ({ ...current, motionProgress: 0 }));
    }
    setMotionPlaying(true);
  };

  const onPointerDown = (event) => {
    setMotionPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    if (!dx && !dy) return;
    beginCameraUpdate();
    updateControls({
      orbit: clamp(controlsRef.current.orbit - dx * 0.32, -155, 155),
      raise: clamp(controlsRef.current.raise + dy * 0.025, -4, 11),
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
    finishCameraUpdate();
  };

  const activeAspect = aspectRatioFor(controls.aspect);
  const previewStageStyle = frameBox
    ? { left: frameBox.x, top: frameBox.y, width: frameBox.width, height: frameBox.height }
    : { inset: 0 };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`3D previs for ${shot.slate}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      style={{ background: "rgba(2, 7, 12, 0.86)", backdropFilter: "blur(10px)" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex max-h-[96vh] w-full max-w-[82rem] flex-col overflow-hidden rounded-xl shadow-2xl"
        style={{ background: palette.panel, border: `1px solid ${palette.rule}` }}
      >
        <header className="flex items-start justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4" style={{ borderBottom: `1px solid ${palette.rule}` }}>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em]" style={{ color: palette.cyan }}>
              Cinematic previs · live camera study
            </p>
            <h2 className="mt-1 truncate text-base font-semibold sm:text-xl" style={{ color: palette.text }}>
              {shot.slate}{shot.multicam ? ` · Camera ${shot.camLetter}` : ""} · {shot.description}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close 3D preview"
            onClick={onClose}
            className="min-h-10 shrink-0 rounded-md px-3 text-sm font-medium"
            style={{ color: palette.text, border: `1px solid ${palette.rule}`, background: palette.night }}
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div ref={stageRef} className="relative min-h-[21rem] overflow-hidden bg-[#02060a] lg:min-h-[34rem]" data-testid="previs-render-stage">
            <div className="absolute overflow-hidden" style={previewStageStyle} data-testid="previs-aspect-frame">
              <canvas
                key={fallback ? "cinematic-canvas" : "three-renderer"}
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="absolute inset-0 h-full w-full touch-none"
                style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
                data-testid="canvas-3d-previs"
              />
              <div className="pointer-events-none absolute inset-6 border" style={{ borderColor: "rgba(241, 175, 76, 0.5)" }} />
              <div className="pointer-events-none absolute inset-x-6 top-1/3 border-t border-dashed" style={{ borderColor: "rgba(241, 175, 76, 0.3)" }} />
              <div className="pointer-events-none absolute inset-x-6 bottom-1/3 border-t border-dashed" style={{ borderColor: "rgba(241, 175, 76, 0.3)" }} />
              <div className="pointer-events-none absolute inset-y-6 left-1/3 border-l border-dashed" style={{ borderColor: "rgba(241, 175, 76, 0.3)" }} />
              <div className="pointer-events-none absolute inset-y-6 right-1/3 border-l border-dashed" style={{ borderColor: "rgba(241, 175, 76, 0.3)" }} />
              <div className="absolute left-4 top-4 rounded-md px-3 py-2 text-[11px] font-semibold tracking-wide" style={{ background: "rgba(5, 15, 23, 0.8)", color: palette.cyan, border: "1px solid rgba(104, 216, 219, 0.35)" }}>
                {fallback ? "CINEMATIC CANVAS" : "LIVE 3D"} · {activeAspect.label} · {activePreset === "custom" ? "CUSTOM VIEW" : activePreset.toUpperCase()}
              </div>
              <div className="absolute bottom-4 left-4 rounded-md px-3 py-2 text-xs" style={{ background: "rgba(5, 15, 23, 0.82)", color: palette.dim, border: `1px solid ${palette.rule}` }}>
                Drag to orbit and crane · Lens {Math.round(controls.focal)}mm · Focus {Math.round(controls.focus * 100)}%
              </div>
            </div>
          </div>

          <aside className="max-h-[42vh] overflow-y-auto p-4 lg:max-h-none" style={{ borderLeft: `1px solid ${palette.rule}` }}>
            <section>
              <p className="text-xs uppercase tracking-[0.17em]" style={{ color: palette.dim }}>Camera package</p>
              <p className="mt-1 text-lg font-semibold" style={{ color: palette.amber }}>{Math.round(controls.focal)}mm · {shot.cam.sensor}</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: palette.dim }}>
                {shot.height} · {shot.rel || "unlinked"} · {toFixed(framing.distance)} ft to focus
              </p>
            </section>

            {hasMotionPath && (
              <section
                className="mt-5 rounded-md p-3"
                style={{ background: "rgba(104, 216, 219, 0.08)", border: "1px solid rgba(104, 216, 219, 0.32)" }}
                data-testid="previs-motion-controls"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.17em]" style={{ color: palette.cyan }}>
                      {motionMarks.length > 1 ? "Shot choreography" : "Performer blocking"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: palette.dim }}>
                      {motionMarks.length > 1 ? `${motionMarks.length} camera marks · ` : ""}
                      {movingPerformers.length ? `${movingPerformers.length} moving performer${movingPerformers.length === 1 ? "" : "s"} · ` : ""}
                      {choreographyDuration.toFixed(1)}s · {shot.cam?.aim && shot.cam?.linkTo ? "Track To active" : motionMarks.length > 1 ? "mark pan active" : "blocking preview"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleMotionPlayback}
                    data-testid="button-previs-motion-play"
                    className="min-h-8 shrink-0 rounded px-2.5 text-xs font-semibold"
                    style={{ color: palette.cyan, border: "1px solid rgba(104, 216, 219, 0.48)", background: "rgba(5, 15, 23, 0.55)" }}
                  >
                    {motionPlaying ? "Pause" : controls.motionProgress >= 0.999 ? "Replay" : "Play"}
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={controls.motionProgress}
                  onChange={(event) => {
                    setMotionPlaying(false);
                    setControls((current) => ({ ...current, motionProgress: Number(event.target.value) }));
                  }}
                  aria-label="Camera movement preview progress"
                  data-testid="input-previs-motion-scrubber"
                  className="mt-3 w-full accent-cyan-300"
                />
                <div className="mt-1 flex justify-between text-[10px] tabular-nums" style={{ color: palette.dim }}>
                  <span>Mark 1</span>
                  <span>{Math.round(controls.motionProgress * 100)}%</span>
                  <span>Final mark</span>
                </div>
              </section>
            )}

            <section className="mt-5">
              <p className="text-xs uppercase tracking-[0.17em]" style={{ color: palette.dim }}>Angle study</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {framingPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    data-testid={`button-previs-${preset.id}`}
                    className="min-h-9 rounded px-2 text-left text-xs font-medium"
                    style={{
                      color: activePreset === preset.id ? palette.amber : palette.text,
                      background: activePreset === preset.id ? "rgba(241, 175, 76, 0.13)" : palette.night,
                      border: `1px solid ${activePreset === preset.id ? palette.amber : palette.rule}`,
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-5">
              <p className="text-xs uppercase tracking-[0.17em]" style={{ color: palette.dim }}>Cinematic format</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PREVIS_ASPECT_RATIOS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    onClick={() => chooseAspect(format)}
                    data-testid={`button-previs-aspect-${format.id}`}
                    aria-pressed={controls.aspect === format.id}
                    className="min-h-9 rounded px-2 text-left text-xs font-medium"
                    style={{
                      color: controls.aspect === format.id ? palette.cyan : palette.text,
                      background: controls.aspect === format.id ? "rgba(104, 216, 219, 0.13)" : palette.night,
                      border: `1px solid ${controls.aspect === format.id ? palette.cyan : palette.rule}`,
                    }}
                  >
                    {format.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: palette.dim }}>
                Every adjustment is saved to this camera and carries into reopened and exported previs frames.
              </p>
            </section>

            <section className="mt-5 space-y-4">
              <label className="block text-xs" style={{ color: palette.text }}>
                Lens focal <span style={{ color: palette.dim }}>{Math.round(controls.focal)}mm</span>
                <input
                  aria-label="Lens focal length"
                  type="range"
                  min="18"
                  max="135"
                  value={controls.focal}
                  onPointerDown={beginCameraUpdate}
                  onKeyDown={beginCameraUpdate}
                  onPointerUp={finishCameraUpdate}
                  onKeyUp={finishCameraUpdate}
                  onBlur={finishCameraUpdate}
                  onChange={(event) => updateControls({ focal: +event.target.value })}
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-xs" style={{ color: palette.text }}>
                Orbit <span style={{ color: palette.dim }}>{Math.round(controls.orbit)}°</span>
                <input
                  aria-label="Orbit camera"
                  type="range"
                  min="-155"
                  max="155"
                  value={controls.orbit}
                  onPointerDown={beginCameraUpdate}
                  onKeyDown={beginCameraUpdate}
                  onPointerUp={finishCameraUpdate}
                  onKeyUp={finishCameraUpdate}
                  onBlur={finishCameraUpdate}
                  onChange={(event) => updateControls({ orbit: +event.target.value })}
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-xs" style={{ color: palette.text }}>
                Raise / lower <span style={{ color: palette.dim }}>{toFixed(controls.raise)} ft</span>
                <input
                  aria-label="Raise or lower camera"
                  type="range"
                  min="-4"
                  max="11"
                  step="0.1"
                  value={controls.raise}
                  onPointerDown={beginCameraUpdate}
                  onKeyDown={beginCameraUpdate}
                  onPointerUp={finishCameraUpdate}
                  onKeyUp={finishCameraUpdate}
                  onBlur={finishCameraUpdate}
                  onChange={(event) => updateControls({ raise: +event.target.value })}
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-xs" style={{ color: palette.text }}>
                Dolly <span style={{ color: palette.dim }}>{controls.dolly > 0 ? "+" : ""}{Math.round(controls.dolly)}%</span>
                <input
                  aria-label="Dolly camera"
                  type="range"
                  min="-60"
                  max="80"
                  value={controls.dolly}
                  onPointerDown={beginCameraUpdate}
                  onKeyDown={beginCameraUpdate}
                  onPointerUp={finishCameraUpdate}
                  onKeyUp={finishCameraUpdate}
                  onBlur={finishCameraUpdate}
                  onChange={(event) => updateControls({ dolly: +event.target.value })}
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-xs" style={{ color: palette.text }}>
                Focus height <span style={{ color: palette.dim }}>{Math.round(controls.focus * 100)}%</span>
                <input
                  aria-label="Focus height"
                  type="range"
                  min="0.15"
                  max="0.9"
                  step="0.01"
                  value={controls.focus}
                  onPointerDown={beginCameraUpdate}
                  onKeyDown={beginCameraUpdate}
                  onPointerUp={finishCameraUpdate}
                  onKeyUp={finishCameraUpdate}
                  onBlur={finishCameraUpdate}
                  onChange={(event) => updateControls({ focus: +event.target.value })}
                  className="mt-2 w-full"
                />
              </label>
            </section>

            <button
              type="button"
              onClick={() => applyPreset(framingPresets[0])}
              className="mt-5 min-h-10 w-full rounded-md text-sm font-medium"
              style={{ color: palette.text, border: `1px solid ${palette.rule}`, background: palette.night }}
            >
              Reset to shot camera
            </button>
            <p className="mt-2 text-center text-[11px]" style={{ color: palette.cyan }} data-testid="status-previs-camera-save">
              Saved to Camera {shot.camLetter || shot.cam?.name || ""}
            </p>

            <section className="mt-4 rounded-md p-3 text-xs" style={{ background: palette.night, color: palette.dim, border: `1px solid ${palette.rule}` }}>
              <p className="font-semibold" style={{ color: palette.text }}>Scene intelligence</p>
              <p className="mt-2">{actorCount} performer{actorCount === 1 ? "" : "s"} · {propCount} set object{propCount === 1 ? "" : "s"} · {walls.length} wall segment{walls.length === 1 ? "" : "s"}</p>
              {objects.filter((object) => object.type === "actor").map((actor) => (
                <p key={actor.id} className="mt-1">
                  <span style={{ color: actor.id === subject?.id ? palette.amber : palette.text }}>{actor.name}</span>: {appearanceForActor(actor).profile.label} · {appearanceForActor(actor).wardrobe.label}
                </p>
              ))}
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}
