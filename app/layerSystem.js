export const DIRECTOR = "DIRECTOR";
export const CINEMATOGRAPHY = "CINEMATOGRAPHY";
export const LAYER_SCHEMA_VERSION = 3;

const TECHNICAL_CATEGORY_FAMILIES = {
  cameras: "CAMERA",
  "camera rigs": "CAMERA",
  "fluorescent fixtures": "LIGHTING",
  "hmi fixtures": "LIGHTING",
  "led fixtures": "LIGHTING",
  "tungsten & practicals": "LIGHTING",
  lighting: "LIGHTING",
  "frames & boards": "LIGHT_CONTROL",
  rags: "LIGHT_CONTROL",
  "rolls & cards": "LIGHT_CONTROL",
  grip: "GRIP_RIGGING",
  "support & rigging": "GRIP_RIGGING",
  rigging: "GRIP_RIGGING",
  movement: "MOVEMENT",
};

export const normalizeLayerContext = (context) =>
  context === CINEMATOGRAPHY || context === "BOTH" ? context : DIRECTOR;

const normalizedCategory = (category) => String(category || "").trim().toLowerCase();
const hasExplicitTarget = (targetMode) => targetMode === DIRECTOR || targetMode === CINEMATOGRAPHY || targetMode === "BOTH";

/* Manifests from earlier releases have no role metadata. Classify those records
   at the asset boundary so the canvas and saved object schema stay untouched. */
export function withStencilRole(stencil) {
  const category = normalizedCategory(stencil.category);
  const inferredFamily = TECHNICAL_CATEGORY_FAMILIES[category];
  const targetMode = hasExplicitTarget(stencil.targetMode)
    ? stencil.targetMode
    : inferredFamily
      ? CINEMATOGRAPHY
      : DIRECTOR;
  return {
    ...stencil,
    targetMode,
    technicalFamily: stencil.technicalFamily || inferredFamily || "BLOCKING",
  };
}

export function stencilPaletteGroup(stencil) {
  const classified = withStencilRole(stencil);
  if (classified.targetMode === DIRECTOR) return "STAGING";
  if (classified.targetMode === "BOTH") return "SHARED";
  if (classified.technicalFamily === "CAMERA") return "CAMERA";
  if (classified.technicalFamily === "LIGHTING") return "LIGHTING";
  if (classified.technicalFamily === "LIGHT_CONTROL") return "LIGHT_CONTROL";
  if (classified.technicalFamily === "MOVEMENT") return "MOVEMENT";
  return "GRIP_RIGGING";
}

export const withLayerDefaults = (object, layerContext = DIRECTOR) => ({
  ...object,
  layerContext: normalizeLayerContext(layerContext),
  isVisible: object.isVisible !== false,
  isLocked: !!object.isLocked,
});

/* Scene files before version 2 contain only base objects. Version 3 adds
   optional camera motionPath records, so no destructive backfill is needed.
   The migration is
   deliberately additive: object IDs, coordinates, rotation, and all existing
   production fields are retained exactly as saved. */
export function migrateSceneDocument(raw) {
  if (!raw || !Array.isArray(raw.objects)) {
    throw new Error("Scene file does not contain an objects array.");
  }
  if (Number(raw.schemaVersion) > LAYER_SCHEMA_VERSION) {
    throw new Error(`This scene uses a newer layer schema (v${raw.schemaVersion}).`);
  }

  const sourceLayerSettings = raw.layerSettings || {};
  return {
    ...raw,
    schemaVersion: LAYER_SCHEMA_VERSION,
    layerSettings: {
      ...sourceLayerSettings,
      cinematographyDisplay: sourceLayerSettings.cinematographyDisplay === "ghost" ? "ghost" : "hide",
    },
    objects: raw.objects.map((object) => withLayerDefaults(object, object.layerContext || DIRECTOR)),
  };
}

export function resolveLayerPresentation(object, mode, cinematographyDisplay) {
  const context = normalizeLayerContext(object.layerContext);
  if (object.isVisible === false) return { render: false, interactive: false, opacity: 0 };
  if (mode === DIRECTOR && context === CINEMATOGRAPHY) {
    return cinematographyDisplay === "ghost"
      ? { render: true, interactive: false, opacity: 0.25 }
      : { render: false, interactive: false, opacity: 0 };
  }
  return { render: true, interactive: !object.isLocked, opacity: 1 };
}

export function stencilIsAvailableInMode(stencil, mode) {
  return mode === CINEMATOGRAPHY || withStencilRole(stencil).targetMode !== CINEMATOGRAPHY;
}
