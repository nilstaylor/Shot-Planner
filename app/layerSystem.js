export const DIRECTOR = "DIRECTOR";
export const CINEMATOGRAPHY = "CINEMATOGRAPHY";
export const LAYER_SCHEMA_VERSION = 2;

export const normalizeLayerContext = (context) =>
  context === CINEMATOGRAPHY || context === "BOTH" ? context : DIRECTOR;

export const withLayerDefaults = (object, layerContext = DIRECTOR) => ({
  ...object,
  layerContext: normalizeLayerContext(layerContext),
  isVisible: object.isVisible !== false,
  isLocked: !!object.isLocked,
});

/* Scene files before version 2 contain only base objects. The migration is
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
  return mode === CINEMATOGRAPHY || (stencil.targetMode || DIRECTOR) !== CINEMATOGRAPHY;
}
