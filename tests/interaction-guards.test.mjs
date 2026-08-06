import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const boardUrl = new URL("../app/BlockingBoard.jsx", import.meta.url);
const previsUrl = new URL("../app/PrevisWindow.jsx", import.meta.url);

test("wall drawing completes by default and chains only when explicitly requested", async () => {
  const source = await readFile(boardUrl, "utf8");

  assert.match(source, /const placeWallPoint = \(point, keepChain = false\)/);
  assert.match(source, /if \(keepChain\) \{\s*setWallDraft\(next\)/);
  assert.match(source, /endWallDrawing\(\);/);
  assert.match(source, /placeWallPoint\(point, e\.shiftKey \|\| wallChainMode\);/);
  assert.match(source, /Connected chain: \{wallChainMode \? "on" : "off"\}/);
  assert.match(source, /Hold Shift, or enable Connected chain, to continue/);
});

test("3D preview only orbits with a deliberate active primary-pointer drag", async () => {
  const source = await readFile(previsUrl, "utf8");

  assert.match(source, /if \(event\.button !== 0 \|\| event\.isPrimary === false\) return;/);
  assert.match(source, /pointerId: event\.pointerId/);
  assert.match(source, /if \(!activeDrag\.active && Math\.hypot\(dx, dy\) < 5\) return;/);
  assert.match(source, /orbit: clamp\(activeDrag\.origin\.orbit - dx \* 0\.24, -155, 155\)/);
  assert.match(source, /raise: clamp\(activeDrag\.origin\.raise \+ dy \* 0\.022, -4, 11\)/);
  assert.match(source, /onLostPointerCapture=\{onPointerUp\}/);
  assert.match(source, /window\.addEventListener\("blur", abandonPointerDrag\)/);
  assert.match(source, /if \(\(event\.buttons & 1\) === 0\)/);
  assert.match(source, /canvas\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(source, /canvas\.removeEventListener\("wheel", onWheel\)/);
  assert.match(source, /dolly: clamp\(controlsRef\.current\.dolly \+ event\.deltaY \* 0\.055, -60, 80\)/);
});

test("3D preview begins level unless a vertical aim or tracked target is explicit", async () => {
  const source = await readFile(previsUrl, "utf8");

  assert.match(source, /tilt: clamp\(Number\(savedView\.tilt\) \|\| 0, -45, 45\)/);
  assert.match(source, /tilt: \+Number\(controls\.tilt\)\.toFixed\(2\)/);
  assert.match(source, /cameraHeight \+ verticalAimOffset/);
  assert.match(source, /const trackedTarget = subjectTarget\.clone\(\);/);
  assert.match(source, /trackedTarget\.y \+= verticalAimOffset/);
  assert.match(source, /Reset neutral shot camera/);
  assert.match(source, /function applyCinematicComposition\(camera, frame\)/);
  assert.match(source, /camera\.setViewOffset\(frame\.width, frame\.height, 0, verticalOffset, frame\.width, frame\.height\)/);
});

test("cinematic format changes derive the visible frame from the current format in the same render", async () => {
  const source = await readFile(previsUrl, "utf8");

  assert.match(source, /const \[stageSize, setStageSize\] = useState\(null\)/);
  assert.match(source, /const displayFrame = stageSize && previewFrame\(stageSize\.width, stageSize\.height, controls\.aspect\)/);
  assert.match(source, /const previewStageStyle = displayFrame/);
  assert.doesNotMatch(source, /const \[frameBox, setFrameBox\] = useState\(null\)/);
});

test("a newly added camera starts aimed at the nearest performer in the overhead plan", async () => {
  const source = await readFile(boardUrl, "utf8");

  assert.match(source, /const defaultCameraOffset = 20/);
  assert.match(source, /linkTo: nearestActor\?\.id \|\| null/);
  assert.match(source, /aim: Boolean\(nearestActor\)/);
  assert.match(source, /if \(nearestActor\) o\.rot = Math\.round\(headingOf\(nearestActor\.x - o\.x, nearestActor\.y - o\.y\)\)/);
});

test("the active planner excludes 3D previs controls and export frames", async () => {
  const source = await readFile(boardUrl, "utf8");

  assert.doesNotMatch(source, /PrevisWindow|renderPrevisFrame|previewShot|includePrevisInPrint/);
  assert.doesNotMatch(source, /Open 3D previs|Open 3D preview|3D previs frames/);
  assert.doesNotMatch(source, /from "\.\/previsCast"/);
  assert.match(source, /overhead blocking & shot lists/);
  assert.match(source, /Each overhead camera becomes a production-ready setup/);
  assert.match(source, /setPane\("object"\)/);
});

test("context-menu actions remain available while outside clicks close the menu", async () => {
  const source = await readFile(boardUrl, "utf8");

  assert.match(source, /const contextMenuRef = useRef\(null\)/);
  assert.match(source, /const closeMenuOnOutsidePointerDown = \(event\) => \{\s*if \(contextMenuRef\.current\?\.contains\(event\.target\)\) return;\s*setContextMenu\(null\);/);
  assert.match(source, /window\.addEventListener\("pointerdown", closeMenuOnOutsidePointerDown\)/);
  assert.match(source, /ref=\{contextMenuRef\}\s+role="menu"/);
  assert.match(source, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
});
