import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARE_HASH_KEY,
  buildSceneShareUrl,
  decodeSceneShare,
  encodeSceneShare,
  sceneFromShareHash,
} from "../app/sceneShare.js";

const scene = {
  schemaVersion: 2,
  objects: [{ id: "actor-1", type: "actor", x: 4, y: -2, name: "ANNA", layerContext: "DIRECTOR" }],
  walls: [{ id: "wall-1", a: { x: 0, y: 0 }, b: { x: 12, y: 0 } }],
  openings: [],
  layerSettings: { cinematographyDisplay: "ghost" },
  blueprint: { src: "data:image/png;base64,very-large-location-reference" },
};

test("round-trips a compact, editable scene through a portable share link", () => {
  const encoded = encodeSceneShare(scene);
  const decoded = decodeSceneShare(encoded);
  const url = buildSceneShareUrl("https://example.test/Shot-Planner/", scene);

  assert.deepEqual(decoded.objects, scene.objects);
  assert.deepEqual(decoded.walls, scene.walls);
  assert.equal(decoded.layerSettings.cinematographyDisplay, "ghost");
  assert.equal(decoded.blueprint, null);
  assert.match(url, new RegExp(`#${SHARE_HASH_KEY}=`));
  assert.deepEqual(sceneFromShareHash(new URL(url).hash), decoded);
});

test("rejects malformed scene links instead of loading partial data", () => {
  assert.throws(() => decodeSceneShare("not-a-scene"), /incomplete|could not be read/i);
});
