import assert from "node:assert/strict";
import test from "node:test";

import {
  CINEMATOGRAPHY,
  DIRECTOR,
  LAYER_SCHEMA_VERSION,
  migrateSceneDocument,
  resolveLayerPresentation,
  stencilPaletteGroup,
  stencilIsAvailableInMode,
  withStencilRole,
} from "../app/layerSystem.js";

test("migrates a legacy scene without changing its existing object geometry", () => {
  const legacy = {
    objects: [{ id: "cam-1", type: "camera", x: 8, y: -4, rot: 90, focal: 50 }],
    meta: { scene: "12" },
  };

  const migrated = migrateSceneDocument(legacy);

  assert.equal(migrated.schemaVersion, LAYER_SCHEMA_VERSION);
  assert.equal(migrated.layerSettings.cinematographyDisplay, "hide");
  assert.deepEqual(migrated.objects[0], {
    ...legacy.objects[0],
    layerContext: DIRECTOR,
    isVisible: true,
    isLocked: false,
  });
});

test("preserves modern layer metadata and normalizes unsupported display settings", () => {
  const migrated = migrateSceneDocument({
    schemaVersion: 2,
    layerSettings: { cinematographyDisplay: "invalid", inspectorOpen: true },
    objects: [{ id: "light-1", type: "prop", layerContext: CINEMATOGRAPHY, isVisible: false, isLocked: true }],
  });

  assert.equal(migrated.layerSettings.cinematographyDisplay, "hide");
  assert.equal(migrated.layerSettings.inspectorOpen, true);
  assert.deepEqual(migrated.objects[0], {
    id: "light-1",
    type: "prop",
    layerContext: CINEMATOGRAPHY,
    isVisible: false,
    isLocked: true,
  });
});

test("preserves optional camera and performer movement paths during schema migration", () => {
  const motionPath = [
    { id: "mark-1", x: 0, y: 0, rot: 0, duration: 0 },
    { id: "mark-2", x: 8, y: -4, rot: 45, duration: 2.5 },
  ];
  const migrated = migrateSceneDocument({
    schemaVersion: 2,
    objects: [
      { id: "cam-move", type: "camera", x: 0, y: 0, rot: 0, motionPath },
      { id: "actor-move", type: "actor", x: 4, y: 2, rot: 180, motionPath },
    ],
  });

  assert.deepEqual(migrated.objects[0].motionPath, motionPath);
  assert.deepEqual(migrated.objects[1].motionPath, motionPath);
  assert.equal(migrated.schemaVersion, LAYER_SCHEMA_VERSION);
});

test("applies hard-hide and ghost rendering without allowing inactive cinematography objects to be selected", () => {
  const cameraRig = { id: "rig-1", layerContext: CINEMATOGRAPHY, isVisible: true, isLocked: false };

  assert.deepEqual(resolveLayerPresentation(cameraRig, DIRECTOR, "hide"), {
    render: false,
    interactive: false,
    opacity: 0,
  });
  assert.deepEqual(resolveLayerPresentation(cameraRig, DIRECTOR, "ghost"), {
    render: true,
    interactive: false,
    opacity: 0.25,
  });
  assert.deepEqual(resolveLayerPresentation(cameraRig, CINEMATOGRAPHY, "hide"), {
    render: true,
    interactive: true,
    opacity: 1,
  });
});

test("keeps cinematography stencil categories out of Director mode and exposes them in Cinematography mode", () => {
  const technicalStencil = { targetMode: CINEMATOGRAPHY };
  const directorStencil = { targetMode: DIRECTOR };

  assert.equal(stencilIsAvailableInMode(technicalStencil, DIRECTOR), false);
  assert.equal(stencilIsAvailableInMode(technicalStencil, CINEMATOGRAPHY), true);
  assert.equal(stencilIsAvailableInMode(directorStencil, DIRECTOR), true);
  assert.equal(stencilIsAvailableInMode(directorStencil, CINEMATOGRAPHY), true);
});

test("classifies legacy manifest categories into role-aware palettes without changing declared metadata", () => {
  const legacyLed = withStencilRole({ id: "led/aputure", name: "Aputure 600D", category: "LED Fixtures" });
  const legacySofa = withStencilRole({ id: "furniture/sofa", name: "Sofa", category: "Furniture" });
  const declaredShared = withStencilRole({ id: "custom/shared", category: "Misc", targetMode: "BOTH", technicalFamily: "MARKER" });

  assert.deepEqual(legacyLed.targetMode, CINEMATOGRAPHY);
  assert.deepEqual(legacyLed.technicalFamily, "LIGHTING");
  assert.equal(stencilPaletteGroup(legacyLed), "LIGHTING");
  assert.equal(legacySofa.targetMode, DIRECTOR);
  assert.equal(stencilPaletteGroup(legacySofa), "STAGING");
  assert.equal(declaredShared.targetMode, "BOTH");
  assert.equal(declaredShared.technicalFamily, "MARKER");
});
