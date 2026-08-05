# Cinematography Layer System

## Incremental Technical Design Document and Refactoring Plan

**Status:** Proposed  
**Audience:** Product engineering, canvas-engineering, and QA teams  
**Scope:** Add a Director/Cinematography layer system to an existing live 2D director-blocking application without replacing its canvas engine, object model, or core selection behavior.

## Executive Summary

The existing application has one visual canvas context containing staging objects, selection logic, and a base asset palette. The Cinematography Layer System introduces technical planning objects such as cameras, FOV guides, lighting instruments, grip, truss, diffusion, and rigging while preserving the current director-blocking workflow.

The implementation must be an additive refactor. Existing `CanvasObject` fields and rendering routines remain authoritative. Layer membership, visibility, locking, context ownership, and cross-layer dependencies live in a sidecar document record and a decoupled runtime controller. The canvas engine receives filtered render and hit-test inputs, but its existing primitive drawing and drag handlers remain unchanged.

The compatibility contract is:

1. Existing saved scenes load without user action.
2. All legacy objects are assigned to the base Director layer.
3. With the feature flag disabled, runtime behavior is functionally identical to the current release.
4. With the feature enabled, Director Mode remains the default and never allows accidental editing of hidden, locked, or inactive cinematography objects.
5. A Cinematography object may reference a Director object, but the Director object remains valid if the technical object is hidden, locked, or removed.

---

## Problem and Design Goals

### Problem

Directors need a simple space for staging actors, scenery, and movement. Cinematographers and key crew need a denser technical pass containing cameras, FOV, lights, stands, track, diffusion, and rigging. Mixing those objects into one undifferentiated canvas creates visual clutter and permits accidental changes during staging.

The current application already has a functioning single-canvas engine. Replacing it with a new scene graph or library would create unnecessary regression risk. The layer system therefore needs to wrap existing object arrays and event pipelines rather than rewrite them.

### Goals

- Preserve the existing object schema, drawing primitives, object ordering, selection, drag, and persistence behavior.
- Add a persistent Director/Cinematography layer stack that supports visibility, lock state, opacity policy, and z-order bands.
- Assign all legacy scene objects to the Director base layer automatically and deterministically.
- Permit cross-layer references, such as a camera target linked to an actor, without introducing cyclic dependencies or cross-mode mutation.
- Filter the existing render loop and hit-test pipeline through a small, testable adapter.
- Extend the stencil registry through optional metadata, leaving legacy assets visible and usable.
- Ship behind a feature flag with repeatable migration and regression tests.

### Non-goals

- Replacing SVG, HTML5 Canvas, WebGL, Flutter `CustomPainter`, Fabric.js, Konva.js, or the current renderer.
- Introducing collaborative editing, real-time conflict resolution, or server-side document locking.
- Building a full dependency graph evaluator for arbitrary object constraints in the first release.
- Converting every existing staging asset to a technical asset taxonomy manually before launch.
- Changing existing object IDs, base coordinates, rotation conventions, camera behavior, or saved-scene export names.

---

## Architectural Principles

### Sidecar metadata over base-object mutation

Keep the existing base object type unchanged. Store layer-related information in a document-level sidecar map keyed by object ID. This avoids broad edits to existing constructors, serializers, renderers, and selection code.

### Adapters at engine boundaries

Layer behavior belongs at three boundaries only:

1. Document loading and saving.
2. Render-input preparation.
3. Hit-test and mutation admission.

The engine continues to draw a provided ordered object list and process approved events using existing routines.

### Director Mode is a safe base context

The Director layer is always present, visible, and available unless a user intentionally locks it. In Director Mode, cinematography elements are either hidden or ghosted but are never selectable by default.

### Cross-layer references are directional

Technical objects may reference staging objects. For example, a camera may target an actor, and a key light may target a camera setup or a performer. A Director object must not require a cinematography object to render, select, or save.

### Migration must be idempotent

Opening an already-migrated document must produce the same document. Re-saving and reopening must not duplicate layers, mutate IDs, or accumulate migration metadata.

---

## Existing and Target Document Shapes

### Legacy document shape

The current live app can continue to use a document shape similar to this:

```ts
interface LegacySceneDocument {
  objects: CanvasObject[];
  line?: LineOfActionState;
  meta?: SceneMetadata;
}

interface CanvasObject {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  rot: number;
  // Existing type-specific fields remain unchanged.
  [key: string]: unknown;
}
```

The migration must accept missing `line`, `meta`, and type-specific fields, because older scene files may not contain newer properties.

### Target document shape

The target shape adds a versioned sidecar. `objects` remains the existing array, preserving current draw order and serialization behavior.

```ts
type CanvasMode = "DIRECTOR" | "CINEMATOGRAPHY";
type LayerVisibilityPolicy = "VISIBLE" | "GHOSTED" | "HIDDEN";
type LayerId = "director-base" | "cinematography" | string;

interface LayerDefinition {
  id: LayerId;
  name: string;
  context: CanvasMode;
  order: number;
  defaultVisibility: LayerVisibilityPolicy;
  defaultLocked: boolean;
  opacityWhenGhosted: number;
  selectableWhenGhosted: false;
}

interface LayerStackDocument {
  version: 1;
  layers: LayerDefinition[];
}

interface ObjectLayerRecord {
  objectId: string;
  layerId: LayerId;
  context: CanvasMode;
  zIndex: number;
  visibilityOverride?: LayerVisibilityPolicy;
  locked?: boolean;
  tags?: string[];
}

type ReferenceKind =
  | "CAMERA_TARGET"
  | "LIGHT_TARGET"
  | "FOV_SUBJECT"
  | "RIG_ANCHOR"
  | "ANNOTATION_TARGET";

interface CrossLayerReference {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  kind: ReferenceKind;
  enabled: boolean;
  options?: Record<string, unknown>;
}

interface LayeredSceneDocument extends LegacySceneDocument {
  schemaVersion: 2;
  layerStack: LayerStackDocument;
  objectLayers: Record<string, ObjectLayerRecord>;
  crossLayerReferences: CrossLayerReference[];
}
```

### Why use a sidecar `objectLayers` map?

The sidecar map lets existing object creation and draw code remain stable. A legacy object such as an actor can continue to be created as:

```ts
const actor = newActor(x, y, "ANNA");
```

The layer controller can separately register it:

```ts
layerStore.assignObject(actor.id, "director-base");
```

This minimizes risk because old objects do not require a mandatory `layerId` field, and old tools do not fail when they receive unmodified `CanvasObject` values.

### Optional interface extension for new code

New modules may use a view model that combines the base object and its sidecar metadata without changing persisted base-object fields:

```ts
interface LayeredCanvasObject {
  object: CanvasObject;
  layer: ObjectLayerRecord;
  effectiveLayer: LayerDefinition;
  effectiveVisibility: LayerVisibilityPolicy;
  effectiveLocked: boolean;
}
```

---

## Layer Definitions and Ownership Rules

### Initial layer stack

The first release should ship with two persistent system layers:

| Layer ID | Context | Purpose | Default state |
|---|---|---|---|
| `director-base` | `DIRECTOR` | Actors, set walls, doors, windows, basic set props, blocking paths, line-of-action guides | Visible and editable |
| `cinematography` | `CINEMATOGRAPHY` | Cameras, FOV visualizers, lighting, stands, dolly track, cranes, diffusion, flags, truss, technical annotations | Visible in Cinematography Mode; ghosted or hidden in Director Mode |

Additional optional layers can be introduced later, such as `sound`, `vfx`, `safety`, or `art-department`. They must use the same sidecar metadata and controller interfaces.

### Object ownership

#### Objects created in Director Mode

- Default assignment: `director-base`.
- Allowed types: actors, generic set pieces, walls, doors, windows, simple markers, blocking paths.
- Existing objects always remain on this layer after migration.
- They remain selectable in both modes unless explicitly locked.

#### Objects created in Cinematography Mode

- Default assignment: `cinematography`.
- Allowed types: camera, FOV overlay, light fixture, C-stand, flag, diffusion frame, dolly, track, crane, jib, truss, grip annotation.
- They are hidden or ghosted when the Director pass is active, based on the current visibility policy.
- They may reference Director-layer objects, but should not mutate them directly.

#### Explicit reassignment

Users may reassign an object only through an explicit layer command. Reassignment must:

1. Create an undoable mutation.
2. Preserve the object ID and base properties.
3. Validate whether the target layer permits the object’s context.
4. Preserve all valid cross-layer references.
5. Disable invalid references rather than deleting them silently.

### Ownership validation

```ts
const permittedContextByObjectType: Record<string, CanvasMode | "BOTH"> = {
  actor: "DIRECTOR",
  prop: "BOTH",
  wall: "DIRECTOR",
  door: "DIRECTOR",
  window: "DIRECTOR",
  camera: "CINEMATOGRAPHY",
  fov: "CINEMATOGRAPHY",
  light: "CINEMATOGRAPHY",
  cStand: "CINEMATOGRAPHY",
  dollyTrack: "CINEMATOGRAPHY",
  truss: "CINEMATOGRAPHY",
};

function canAssignToLayer(object: CanvasObject, layer: LayerDefinition): boolean {
  const permitted = permittedContextByObjectType[object.type] ?? "BOTH";
  return permitted === "BOTH" || permitted === layer.context;
}
```

`prop` is intentionally `BOTH`. A sofa or table can live in the Director layer for staging or the Cinematography layer when it represents a temporary practical, bounce, camera platform, or technical stand-in. The explicit user action determines ownership.

---

## Schema Migration and Backward Compatibility

### Version detection

Document loading should not depend only on `schemaVersion`. Older scenes have no version property, and experimental exports may contain partial data. Use structural detection:

```ts
function isLayeredDocument(value: unknown): value is LayeredSceneDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<LayeredSceneDocument>;
  return (
    document.schemaVersion === 2 &&
    !!document.layerStack &&
    !!document.objectLayers &&
    Array.isArray(document.crossLayerReferences)
  );
}
```

### Migration behavior

| Input state | Load behavior |
|---|---|
| Legacy document with `objects` only | Create the two default layers and assign every object to `director-base`. |
| Legacy document with unknown object fields | Preserve all fields; attach sidecar records only. |
| Layered document missing one object-layer record | Preserve the scene and create a `director-base` record for that object. |
| Layered document with an object-layer record for a missing object | Drop the orphan record and log a non-fatal migration warning. |
| Layered document missing system layers | Merge in missing system layers while retaining valid custom layers. |
| Unknown future schema version | Reject with a user-facing “newer version” error; do not overwrite the document. |

### Migration handler

```ts
const DIRECTOR_LAYER: LayerDefinition = {
  id: "director-base",
  name: "Director",
  context: "DIRECTOR",
  order: 0,
  defaultVisibility: "VISIBLE",
  defaultLocked: false,
  opacityWhenGhosted: 0.28,
  selectableWhenGhosted: false,
};

const CINEMATOGRAPHY_LAYER: LayerDefinition = {
  id: "cinematography",
  name: "Cinematography",
  context: "CINEMATOGRAPHY",
  order: 100,
  defaultVisibility: "VISIBLE",
  defaultLocked: false,
  opacityWhenGhosted: 0.22,
  selectableWhenGhosted: false,
};

const DEFAULT_LAYER_STACK: LayerStackDocument = {
  version: 1,
  layers: [DIRECTOR_LAYER, CINEMATOGRAPHY_LAYER],
};

export function migrateSceneDocument(input: unknown): LayeredSceneDocument {
  if (!input || typeof input !== "object") {
    throw new Error("Scene file is not a JSON object.");
  }

  const legacy = input as Partial<LegacySceneDocument & LayeredSceneDocument>;
  if (!Array.isArray(legacy.objects)) {
    throw new Error("Scene file does not contain an objects array.");
  }

  if (typeof legacy.schemaVersion === "number" && legacy.schemaVersion > 2) {
    throw new Error(`Scene file uses unsupported schema version ${legacy.schemaVersion}.`);
  }

  const objects = legacy.objects as CanvasObject[];
  const existingLayers = legacy.layerStack?.layers ?? [];
  const layerById = new Map(existingLayers.map((layer) => [layer.id, layer]));
  const mergedLayers = [
    layerById.get(DIRECTOR_LAYER.id) ?? DIRECTOR_LAYER,
    layerById.get(CINEMATOGRAPHY_LAYER.id) ?? CINEMATOGRAPHY_LAYER,
    ...existingLayers.filter(
      (layer) => layer.id !== DIRECTOR_LAYER.id && layer.id !== CINEMATOGRAPHY_LAYER.id
    ),
  ];

  const previousRecords = legacy.objectLayers ?? {};
  const objectLayers = Object.fromEntries(
    objects.map((object, index) => {
      const prior = previousRecords[object.id];
      const validLayerId = mergedLayers.some((layer) => layer.id === prior?.layerId)
        ? prior.layerId
        : DIRECTOR_LAYER.id;

      return [
        object.id,
        {
          objectId: object.id,
          layerId: validLayerId,
          context:
            mergedLayers.find((layer) => layer.id === validLayerId)?.context ??
            DIRECTOR_LAYER.context,
          zIndex: Number.isFinite(prior?.zIndex) ? prior.zIndex : index,
          visibilityOverride: prior?.visibilityOverride,
          locked: prior?.locked ?? false,
          tags: prior?.tags ?? [],
        } satisfies ObjectLayerRecord,
      ];
    })
  );

  const objectIds = new Set(objects.map((object) => object.id));
  const crossLayerReferences = (legacy.crossLayerReferences ?? []).filter(
    (reference) =>
      objectIds.has(reference.sourceObjectId) && objectIds.has(reference.targetObjectId)
  );

  return {
    objects,
    line: legacy.line,
    meta: legacy.meta,
    schemaVersion: 2,
    layerStack: { version: 1, layers: mergedLayers },
    objectLayers,
    crossLayerReferences,
  };
}
```

### Migration persistence policy

Do not force an immediate save after migration. Keep the in-memory document upgraded, display a subtle “Layer-ready scene” state if useful, and write schema version 2 only when the user next saves. This avoids changing files simply because they were opened.

### Rollback fallback

The save command should retain the original legacy format only while the feature flag is disabled. Once a user has explicitly created a cinematography-layer object, saving a v2 document is required because v1 has nowhere to persist the sidecar metadata.

For defense in depth, the export dialog may offer:

- **Save scene (layer-aware JSON):** default v2 scene file.
- **Export director-only legacy scene:** optional, lossy export that retains Director-layer objects and existing legacy fields only.

---

## Decoupled Layer State Controller

### Runtime state

Runtime layer state is not stored directly in the canvas-object state. It belongs in a small independent store, reducer, Zustand store, Redux slice, or React context.

```ts
interface LayerRuntimeState {
  featureEnabled: boolean;
  activeMode: CanvasMode;
  directorModeCinematographyPolicy: "HIDE" | "GHOST";
  layerVisibility: Record<LayerId, LayerVisibilityPolicy>;
  layerLockState: Record<LayerId, boolean>;
  activeLayerId: LayerId;
}

type LayerAction =
  | { type: "SET_MODE"; mode: CanvasMode }
  | { type: "SET_ACTIVE_LAYER"; layerId: LayerId }
  | { type: "SET_LAYER_VISIBILITY"; layerId: LayerId; visibility: LayerVisibilityPolicy }
  | { type: "SET_LAYER_LOCK"; layerId: LayerId; locked: boolean }
  | { type: "SET_DIRECTOR_CINEMATOGRAPHY_POLICY"; policy: "HIDE" | "GHOST" }
  | { type: "SET_FEATURE_ENABLED"; enabled: boolean };
```

### Controller reducer

```ts
export function reduceLayerState(
  state: LayerRuntimeState,
  action: LayerAction
): LayerRuntimeState {
  switch (action.type) {
    case "SET_FEATURE_ENABLED":
      return {
        ...state,
        featureEnabled: action.enabled,
        activeMode: action.enabled ? state.activeMode : "DIRECTOR",
        activeLayerId: action.enabled ? state.activeLayerId : "director-base",
      };

    case "SET_MODE":
      return {
        ...state,
        activeMode: action.mode,
        activeLayerId:
          action.mode === "DIRECTOR" ? "director-base" : "cinematography",
      };

    case "SET_ACTIVE_LAYER":
      return { ...state, activeLayerId: action.layerId };

    case "SET_LAYER_VISIBILITY":
      return {
        ...state,
        layerVisibility: { ...state.layerVisibility, [action.layerId]: action.visibility },
      };

    case "SET_LAYER_LOCK":
      return {
        ...state,
        layerLockState: { ...state.layerLockState, [action.layerId]: action.locked },
      };

    case "SET_DIRECTOR_CINEMATOGRAPHY_POLICY":
      return { ...state, directorModeCinematographyPolicy: action.policy };

    default:
      return state;
  }
}
```

### Effective state resolution

The renderer and hit-test middleware should not read UI state ad hoc. They should ask one resolver for the effective visibility and locking state.

```ts
interface EffectiveLayerState {
  visibility: LayerVisibilityPolicy;
  locked: boolean;
  selectable: boolean;
  opacity: number;
}

export function resolveEffectiveLayerState(
  layer: LayerDefinition,
  runtime: LayerRuntimeState,
  objectRecord: ObjectLayerRecord
): EffectiveLayerState {
  if (!runtime.featureEnabled) {
    return {
      visibility: "VISIBLE",
      locked: false,
      selectable: true,
      opacity: 1,
    };
  }

  const manualVisibility =
    objectRecord.visibilityOverride ??
    runtime.layerVisibility[layer.id] ??
    layer.defaultVisibility;
  const manualLocked =
    objectRecord.locked ??
    runtime.layerLockState[layer.id] ??
    layer.defaultLocked;

  const directorHidesCinematography =
    runtime.activeMode === "DIRECTOR" && layer.context === "CINEMATOGRAPHY";

  const visibility = directorHidesCinematography
    ? runtime.directorModeCinematographyPolicy === "HIDE"
      ? "HIDDEN"
      : "GHOSTED"
    : manualVisibility;

  return {
    visibility,
    locked: manualLocked,
    selectable: visibility === "VISIBLE" && !manualLocked,
    opacity: visibility === "GHOSTED" ? layer.opacityWhenGhosted : 1,
  };
}
```

---

## Canvas Engine Integration

### Integration point

The existing engine likely resembles:

```ts
for (const object of objects) {
  drawObject(ctx, object);
}
```

Do not edit every existing `drawActor`, `drawCamera`, `drawProp`, or `drawWall` routine. Instead, replace the input preparation step:

```ts
const renderItems = buildLayeredRenderList(scene.objects, scene, layerRuntime);
for (const item of renderItems) {
  drawObject(ctx, item.object, { alpha: item.opacity });
}
```

`drawObject` remains the existing routine. If it does not accept options today, wrap alpha changes around it:

```ts
ctx.save();
ctx.globalAlpha *= item.opacity;
drawObject(ctx, item.object);
ctx.restore();
```

### Render sorting

Existing array order is treated as the baseline. Layer `order` separates Director and Cinematography draw bands. Sidecar `zIndex` refines ordering inside each layer.

```ts
interface RenderItem {
  object: CanvasObject;
  layer: LayerDefinition;
  opacity: number;
  zIndex: number;
  legacyOrder: number;
}

export function buildLayeredRenderList(
  objects: CanvasObject[],
  document: LayeredSceneDocument,
  runtime: LayerRuntimeState
): RenderItem[] {
  const layersById = new Map(
    document.layerStack.layers.map((layer) => [layer.id, layer])
  );

  return objects
    .map((object, legacyOrder) => {
      const record = document.objectLayers[object.id];
      const layer = layersById.get(record?.layerId) ?? DIRECTOR_LAYER;
      const effective = resolveEffectiveLayerState(layer, runtime, record);

      if (effective.visibility === "HIDDEN") return null;

      return {
        object,
        layer,
        opacity: effective.opacity,
        zIndex: record?.zIndex ?? legacyOrder,
        legacyOrder,
      } satisfies RenderItem;
    })
    .filter((item): item is RenderItem => item !== null)
    .sort(
      (a, b) =>
        a.layer.order - b.layer.order ||
        a.zIndex - b.zIndex ||
        a.legacyOrder - b.legacyOrder
    );
}
```

### Visibility modes

#### Hard hide

Hard hide removes all cinematography objects from the render list when Director Mode is active. It is the recommended default for clean staging reviews, screenshots, and performance-sensitive mobile devices.

Characteristics:

- Not drawn.
- Not hit-testable.
- Not focusable through keyboard or accessibility object lists.
- Cross-layer references continue to resolve in data but have no visible technical source.

#### Ghosted

Ghosting keeps cinematography elements visible at a reduced alpha, but never selectable in Director Mode. It is useful when a director wants awareness of camera and lighting constraints without accidental technical edits.

Characteristics:

- Rendered with layer-defined alpha, such as `0.22`.
- Pointer, keyboard, box-select, and lasso selection ignore these objects.
- Bounding boxes and hover affordances are not drawn.
- Export policy must be explicit: Director-only exports should use hard hide even if the live canvas uses ghosting.

### UI insertion points

Insert the feature at stable, minimal touchpoints:

1. **Top toolbar:** a compact `Director | Cinematography` mode switch. It changes only runtime layer state.
2. **Layer panel:** an optional collapsible section above or beside the existing asset/stencil panel showing visibility and lock controls.
3. **Asset drawer:** receives `activeMode` as a filter input.
4. **Existing object inspector:** shows a read-only layer badge and an explicit “Move to layer” action only when the feature flag is enabled.
5. **Save/open path:** call `migrateSceneDocument` on load and serialize `LayeredSceneDocument` on save.

No existing tool must change its own implementation in the initial migration. Tools receive an `activeLayerId` only through the central object-creation adapter.

---

## Hit-Test Interception and Mutation Guardrails

### Selection admission policy

An object may be considered by the current selection pipeline only when:

1. It is present in the renderable object list.
2. Its effective visibility is `VISIBLE`.
3. Its effective lock state is `false`.
4. Its layer context matches the active mode, unless a future explicit cross-layer inspection mode is enabled.
5. It is not a ghosted object.

### Middleware wrapper

The existing raw hit-test routine should remain unchanged. Wrap it:

```ts
type Point = { x: number; y: number };

interface HitCandidate {
  object: CanvasObject;
  distance?: number;
}

type RawHitTest = (point: Point, objects: CanvasObject[]) => HitCandidate[];

export function createLayerAwareHitTest(
  rawHitTest: RawHitTest,
  document: LayeredSceneDocument,
  runtime: LayerRuntimeState
) {
  const layersById = new Map(
    document.layerStack.layers.map((layer) => [layer.id, layer])
  );

  return function hitTest(point: Point, objects: CanvasObject[]): HitCandidate[] {
    if (!runtime.featureEnabled) {
      return rawHitTest(point, objects);
    }

    const eligible = objects.filter((object) => {
      const record = document.objectLayers[object.id];
      const layer = layersById.get(record?.layerId) ?? DIRECTOR_LAYER;
      const effective = resolveEffectiveLayerState(layer, runtime, record);

      return (
        effective.selectable &&
        layer.context === runtime.activeMode
      );
    });

    return rawHitTest(point, eligible);
  };
}
```

### Protect mutation paths, not just selection

Do not rely on hit-test filtering alone. Keyboard delete, multi-select, inspector edits, drag commits, duplicate, and alignment commands must pass a central mutation guard.

```ts
export function canMutateObject(
  objectId: string,
  document: LayeredSceneDocument,
  runtime: LayerRuntimeState
): boolean {
  if (!runtime.featureEnabled) return true;

  const record = document.objectLayers[objectId];
  const layer =
    document.layerStack.layers.find((candidate) => candidate.id === record?.layerId) ??
    DIRECTOR_LAYER;
  const effective = resolveEffectiveLayerState(layer, runtime, record);

  return effective.selectable && layer.context === runtime.activeMode;
}
```

Every existing mutation command should call this once at its boundary:

```ts
function moveObject(objectId: string, nextPosition: Point) {
  if (!canMutateObject(objectId, sceneDocument, layerRuntime)) return;
  existingMoveObject(objectId, nextPosition);
}
```

### Multi-select and marquee selection

Filter candidates before applying the marquee geometry. This prevents a ghosted camera bounding box from being captured simply because it overlaps the drag rectangle.

```ts
const eligible = getInteractiveObjects(scene.objects, sceneDocument, layerRuntime);
const selectedIds = marqueeIntersect(eligible, marqueeBounds).map((object) => object.id);
```

### Pointer capture

If a user begins a drag on an eligible Director object and changes to Cinematography Mode mid-drag:

1. Complete or cancel the active interaction before changing mode.
2. Prefer canceling the drag and restoring the pre-drag snapshot.
3. Apply the new mode after pointer capture is released.

This avoids an object switching to non-interactive status while it is actively being mutated.

---

## Cross-Layer References

### Reference model

References live in `crossLayerReferences`, not inside base objects. This avoids coupling existing render functions to a new schema.

Example:

```ts
const cameraTarget: CrossLayerReference = {
  id: "ref-cameraA-anna",
  sourceObjectId: "camera-a",
  targetObjectId: "actor-anna",
  kind: "CAMERA_TARGET",
  enabled: true,
  options: {
    framing: "MS",
    keepAim: true,
  },
};
```

### Resolution rules

- References resolve from the current scene document, regardless of whether either layer is hidden.
- A hidden technical source continues to update in memory when its target moves, but it does not render.
- A locked source can retain and render its dependency but cannot be manually dragged.
- If the target is deleted, retain the reference in a disabled error state until the source is edited or the user removes the link. This preserves undo history and avoids silent data loss.
- Reject direct cycles for first-release reference kinds. For example, Camera A targets Actor A, but Actor A cannot target Camera A.

### Example: Camera tracks an actor

```ts
function resolveCameraAim(
  camera: CanvasObject,
  document: LayeredSceneDocument,
  objectsById: Map<string, CanvasObject>
): number | null {
  const reference = document.crossLayerReferences.find(
    (candidate) =>
      candidate.enabled &&
      candidate.kind === "CAMERA_TARGET" &&
      candidate.sourceObjectId === camera.id
  );
  const target = reference && objectsById.get(reference.targetObjectId);
  if (!target) return null;

  return Math.atan2(target.y - camera.y, target.x - camera.x);
}
```

This function can be called by the existing camera renderer or FOV guide before drawing. It does not modify the actor or require the camera layer to be visible.

---

## Asset Catalog Taxonomy Extension

### Existing registry compatibility

Existing stencil entries must continue to work without change. Add optional `layerMeta` to new records and apply a `BOTH` default to legacy assets.

```ts
type TargetMode = "DIRECTOR" | "CINEMATOGRAPHY" | "BOTH";

interface ExistingStencilDefinition {
  id: string;
  name: string;
  category: string;
  w: number;
  d: number;
  file?: string;
  tint?: "light" | "none";
}

interface StencilLayerMeta {
  targetMode: TargetMode;
  defaultLayerId?: LayerId;
  technicalFamily?:
    | "CAMERA"
    | "LIGHTING"
    | "GRIP"
    | "RIGGING"
    | "MOVEMENT"
    | "FOV"
    | "BLOCKING";
  searchTags?: string[];
  supportsTargetReference?: boolean;
}

interface LayerAwareStencilDefinition extends ExistingStencilDefinition {
  layerMeta?: StencilLayerMeta;
}
```

### Recommended catalog taxonomy

| Target mode | Family | Example assets |
|---|---|---|
| `DIRECTOR` | Cast | Generic male/female, child, seated, crowd group |
| `DIRECTOR` | Architecture | Walls, doors, windows, stairs, room markers |
| `DIRECTOR` | Set and props | Table, sofa, bed, desk, practical furniture |
| `DIRECTOR` | Blocking | Actor path, mark, eyeline, entrance/exit |
| `CINEMATOGRAPHY` | Camera | A/B camera, handheld, sticks, gimbal, drone |
| `CINEMATOGRAPHY` | FOV | Lens cone, frame boundary, camera target |
| `CINEMATOGRAPHY` | Lighting | Key, fill, practical, softbox, Fresnel, tube |
| `CINEMATOGRAPHY` | Grip | C-stand, flag, cutter, floppy, apple box |
| `CINEMATOGRAPHY` | Movement | Dolly, slider, track, crane, jib |
| `CINEMATOGRAPHY` | Rigging | Truss, diffusion, overhead, safety line |
| `BOTH` | Shared | Tape mark, measurement, annotation, reference image |

### Dynamic palette filter

The current palette can continue to group by `category`. Filter the source list before existing search and category grouping logic.

```ts
function getStencilTargetMode(stencil: LayerAwareStencilDefinition): TargetMode {
  return stencil.layerMeta?.targetMode ?? "BOTH";
}

export function filterStencilPalette(
  stencils: LayerAwareStencilDefinition[],
  activeMode: CanvasMode,
  query: string
): LayerAwareStencilDefinition[] {
  const normalizedQuery = query.trim().toLowerCase();

  return stencils.filter((stencil) => {
    const targetMode = getStencilTargetMode(stencil);
    const fitsMode = targetMode === "BOTH" || targetMode === activeMode;
    if (!fitsMode) return false;

    if (!normalizedQuery) return true;

    const haystack = [
      stencil.name,
      stencil.category,
      stencil.layerMeta?.technicalFamily,
      ...(stencil.layerMeta?.searchTags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}
```

### Placement adapter

New asset placement should be centralized:

```ts
function inferPlacementLayer(
  stencil: LayerAwareStencilDefinition,
  runtime: LayerRuntimeState
): LayerId {
  return (
    stencil.layerMeta?.defaultLayerId ??
    (runtime.activeMode === "CINEMATOGRAPHY" ? "cinematography" : "director-base")
  );
}

function placeStencil(stencil: LayerAwareStencilDefinition, position: Point) {
  const object = existingPlaceStencil(stencil, position);
  layerStore.assignObject(object.id, inferPlacementLayer(stencil, layerRuntime));
  return object;
}
```

This is the only required change to the existing asset placement path.

---

## Refactoring Plan

### Phase A: Establish contracts without visual behavior changes

1. Add TypeScript types for layered documents and the migration utility.
2. Run `migrateSceneDocument` after legacy JSON loads.
3. Save v2 documents only after an explicit save action.
4. Keep `featureEnabled` false by default.
5. Add tests proving that object arrays, coordinates, rotations, and existing render output are unchanged.

### Phase B: Add the runtime layer controller

1. Create a standalone layer store/reducer.
2. Initialize it with Director Mode, visible `director-base`, and feature disabled.
3. Do not expose UI controls yet.
4. Use the controller in non-invasive diagnostics to record what would be filtered.

### Phase C: Insert render and hit-test wrappers

1. Wrap object-list preparation before the existing renderer.
2. Wrap raw hit testing before existing selection code.
3. Keep feature disabled in production while tests run.
4. Validate that disabled mode calls the original renderer and raw hit test with their original arguments.

### Phase D: Enable internal feature flag and toolbar overlay

1. Add `Director | Cinematography` to the toolbar.
2. Add an unobtrusive Layers panel with visibility, ghost/hide, and lock controls.
3. Gate it with `cinematographyLayersEnabled`.
4. Make Director Mode the default for every migrated scene.

### Phase E: Add taxonomy metadata and technical stencils

1. Extend the stencil manifest parser to accept optional `layerMeta`.
2. Default missing metadata to `BOTH`.
3. Add Camera, Lighting, Grip, Movement, and Rigging categories.
4. Use the palette filter before existing category grouping and search.

### Phase F: Cross-layer links

1. Add camera-to-actor and FOV-to-subject reference creation.
2. Resolve targets at render time; do not bake coordinates unless required for export.
3. Add orphan-reference diagnostics and UI recovery actions.

### Phase G: Controlled rollout

1. Enable for internal users and selected test projects.
2. Measure migration errors, hit-test rejections, and save/load round trips.
3. Enable ghosting only after hard-hide mode is stable.
4. Enable feature by default after regression criteria pass.

---

## Feature Flag and Rollout Plan

### Flag structure

```ts
interface FeatureFlags {
  cinematographyLayersEnabled: boolean;
  cinematographyGhostModeEnabled: boolean;
  crossLayerReferencesEnabled: boolean;
}
```

### Release gates

| Stage | Flags | Audience | Objective |
|---|---|---|---|
| 0 | All false | Production | Baseline behavior only |
| 1 | Layer flag true | Local and CI | Migration and adapter tests |
| 2 | Layer flag true | Internal users | Director/Cinematography switching, hard hide |
| 3 | Ghost and reference flags true | Selected beta projects | Ghosting and cross-layer camera targets |
| 4 | Layer flag true by default | General users | Broad rollout |

### Telemetry

Track only product-safe aggregate events:

- `layer_document_migrated`
- `layer_document_migration_failed`
- `layer_mode_switched`
- `layer_visibility_changed`
- `layer_hit_test_rejected`
- `layer_cross_reference_created`
- `layer_cross_reference_orphaned`
- `layer_save_v2`

Do not log raw scene names, asset names, coordinate data, or user-entered production notes unless the application’s privacy model explicitly permits it.

---

## Test Strategy and Acceptance Criteria

### Migration tests

- Given a legacy JSON document, when it loads, then every legacy object has a `director-base` sidecar record and no object coordinates or properties change.
- Given a migrated v2 document, when it loads twice, then the resulting `layerStack`, `objectLayers`, and references are structurally identical.
- Given a v2 document with a missing sidecar record, when it loads, then only that object receives a Director-layer fallback.
- Given a document with a future schema version, when it loads, then the app rejects it without overwriting the source file.

### Render tests

- Given the feature flag is off, when the canvas renders, then the renderer receives the same object ordering as the pre-layer implementation.
- Given Director Mode with hard hide, when the canvas renders, then no Cinematography object reaches the existing draw routine.
- Given Director Mode with ghosting, when the canvas renders, then technical objects are drawn at their configured alpha and no selection affordances appear.
- Given Cinematography Mode, when the canvas renders, then Director and Cinematography objects use deterministic layer and z-index ordering.

### Interaction tests

- Given a hidden or ghosted technical object, when the user clicks, marquee-selects, tabs, or presses Delete, then the object is never selected or mutated.
- Given a locked layer, when the user drags or edits an object in that layer, then the command is rejected and the canvas state remains unchanged.
- Given a Director actor linked to a camera, when the actor moves, then the camera target resolves to the new actor position without altering the actor’s layer assignment.
- Given an actor linked to a camera, when the camera layer is hidden, then the actor remains visible and editable in Director Mode.

### Asset tests

- Given a legacy stencil with no metadata, when either mode is active, then the stencil remains visible in the palette.
- Given a cinematography stencil, when Director Mode is active, then it is absent from the palette unless an explicit “show all assets” debugging option is enabled.
- Given a lighting stencil tagged with `searchTags`, when the Cinematography palette is searched, then it appears for matching category and tag queries.

### Manual regression checklist

- Create, drag, rotate, resize, delete, undo, save, and reopen existing Director objects with the feature flag off.
- Open a pre-layer scene, save it, and reopen the v2 scene.
- Toggle modes while cameras, actors, props, walls, and FOV guides are present.
- Switch between hard hide and ghosting in Director Mode.
- Verify pointer capture behavior when mode changes during a drag.
- Verify PDF/export behavior explicitly for Director-only and full technical views.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Existing object tools accidentally assume all objects are selectable | Enforce `canMutateObject` at command boundaries and add feature-off regression tests. |
| Persisted document growth from sidecar records | Store concise records keyed by object ID; avoid duplicate base fields. |
| Ghosted objects intercept input | Exclude ghosted nodes before raw hit testing and disable their DOM/SVG pointer events where applicable. |
| Camera links create broken behavior when targets are hidden | Resolve references from data, not from render visibility. |
| Inconsistent z-order between old and new scenes | Preserve legacy array order as the final sort tiebreaker. |
| Migration writes files unexpectedly | Migrate in memory and persist only on an explicit user save. |
| New technical catalog overwhelms directors | Filter by active mode and preserve the current director-first palette as the default. |

---

## Implementation Checklist

- [ ] Introduce `LayeredSceneDocument`, `LayerDefinition`, `ObjectLayerRecord`, and `CrossLayerReference`.
- [ ] Implement and unit-test `migrateSceneDocument`.
- [ ] Add a feature-flagged `LayerRuntimeState` store.
- [ ] Replace direct render-array access with `buildLayeredRenderList`.
- [ ] Wrap raw hit testing with `createLayerAwareHitTest`.
- [ ] Add `canMutateObject` to drag, delete, inspector, duplicate, align, and keyboard command boundaries.
- [ ] Extend stencil manifests with optional `layerMeta`.
- [ ] Filter the existing asset drawer before existing search/category grouping.
- [ ] Add toolbar mode switch and Layers panel behind the feature flag.
- [ ] Implement hard hide first, then ghosting, then cross-layer references.
- [ ] Add save/open migration regression coverage and feature-off snapshot tests.

## Recommended First Ship

Ship the following narrow vertical slice first:

1. Sidecar migration and v2 persistence.
2. Director and Cinematography system layers.
3. Director Mode hard hide.
4. Layer-aware hit-test filtering.
5. Mode-specific stencil palette filtering.
6. Camera-to-actor target references.

This delivers meaningful separation between staging and technical planning while changing only document loading, render-input preparation, hit-test admission, asset filtering, and two small UI insertion points. It does not require a rewrite of the current canvas engine.
