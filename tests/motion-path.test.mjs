import assert from "node:assert/strict";
import test from "node:test";

import {
  bezierSegmentFor,
  interpolateHeading,
  motionPathDuration,
  motionPathSvg,
  sampleMotionPath,
} from "../app/motionPath.js";

const MARKS = [
  { id: "m1", x: 0, y: 0, rot: 350, duration: 0 },
  { id: "m2", x: 10, y: 0, rot: 10, duration: 2 },
  { id: "m3", x: 10, y: 10, rot: 90, duration: 4 },
];

test("builds smooth cubic Bézier segments from sequential camera marks", () => {
  const first = bezierSegmentFor(MARKS, 0);
  const second = bezierSegmentFor(MARKS, 1);

  assert.deepEqual(first.start, MARKS[0]);
  assert.deepEqual(first.end, MARKS[1]);
  assert.notDeepEqual(first.control1, first.start);
  assert.notDeepEqual(second.control2, second.end);
  assert.match(motionPathSvg(MARKS), /^M 0 0 C /);
});

test("samples position from per-mark timing and wraps heading through north", () => {
  assert.equal(motionPathDuration(MARKS), 6);
  assert.equal(interpolateHeading(350, 10, 0.5), 0);

  const midpoint = sampleMotionPath(MARKS, 1 / 6);
  assert.equal(midpoint.segmentIndex, 0);
  assert.ok(midpoint.x > 0 && midpoint.x < 10);
  assert.equal(midpoint.rot, 0);

  const finish = sampleMotionPath(MARKS, 1);
  assert.equal(finish.x, 10);
  assert.equal(finish.y, 10);
  assert.equal(finish.rot, 90);
});

test("supports a one-mark path without introducing undefined geometry", () => {
  assert.deepEqual(sampleMotionPath([{ id: "m1", x: 3, y: -2, rot: 45 }], 0.6), {
    id: "m1",
    x: 3,
    y: -2,
    rot: 45,
    segmentIndex: 0,
    segmentProgress: 0,
  });
});
