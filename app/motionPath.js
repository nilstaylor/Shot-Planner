/*
  Camera movement paths are intentionally plain data attached to a camera:
  [{ id, x, y, rot, duration }].

  The first mark is the camera's origin. Every later mark represents the
  duration of the travel from its preceding mark. The curve is a Catmull-Rom
  to cubic Bézier conversion, so a user only needs to place intuitive marks
  while the renderer receives conventional cubic Bézier control points.
*/

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

export const normalizeHeading = (heading) => ((finite(heading) % 360) + 360) % 360;

export const interpolateHeading = (from, to, progress) => {
  const delta = ((normalizeHeading(to) - normalizeHeading(from) + 540) % 360) - 180;
  return normalizeHeading(normalizeHeading(from) + delta * clamp(progress, 0, 1));
};

export const normalizeMotionMark = (mark, fallback = {}) => ({
  id: mark?.id || fallback.id || "mark",
  x: finite(mark?.x, finite(fallback.x)),
  y: finite(mark?.y, finite(fallback.y)),
  rot: normalizeHeading(mark?.rot ?? fallback.rot ?? 0),
  duration: Math.max(0, finite(mark?.duration, fallback.duration ?? 1.5)),
});

export const motionPathDuration = (marks) =>
  Math.max(
    0,
    (Array.isArray(marks) ? marks : []).slice(1).reduce((total, mark) => total + Math.max(0, finite(mark.duration, 1.5)), 0)
  );

export const bezierSegmentFor = (marks, segmentIndex) => {
  const path = Array.isArray(marks) ? marks : [];
  const start = path[segmentIndex];
  const end = path[segmentIndex + 1];
  if (!start || !end) return null;

  const before = path[Math.max(0, segmentIndex - 1)] || start;
  const after = path[Math.min(path.length - 1, segmentIndex + 2)] || end;
  return {
    start,
    end,
    control1: {
      x: start.x + (end.x - before.x) / 6,
      y: start.y + (end.y - before.y) / 6,
    },
    control2: {
      x: end.x - (after.x - start.x) / 6,
      y: end.y - (after.y - start.y) / 6,
    },
  };
};

const cubicPoint = (segment, progress) => {
  const t = clamp(progress, 0, 1);
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * segment.start.x +
      3 * mt * mt * t * segment.control1.x +
      3 * mt * t * t * segment.control2.x +
      t * t * t * segment.end.x,
    y:
      mt * mt * mt * segment.start.y +
      3 * mt * mt * t * segment.control1.y +
      3 * mt * t * t * segment.control2.y +
      t * t * t * segment.end.y,
  };
};

export const motionPathSvg = (marks) => {
  const path = Array.isArray(marks) ? marks : [];
  if (path.length < 2) return "";
  const commands = [`M ${path[0].x} ${path[0].y}`];
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = bezierSegmentFor(path, index);
    commands.push(
      `C ${segment.control1.x} ${segment.control1.y}, ${segment.control2.x} ${segment.control2.y}, ${segment.end.x} ${segment.end.y}`
    );
  }
  return commands.join(" ");
};

export const sampleMotionPath = (marks, progress) => {
  const path = Array.isArray(marks) ? marks : [];
  if (!path.length) return null;
  if (path.length === 1) return { ...path[0], segmentIndex: 0, segmentProgress: 0 };

  const duration = motionPathDuration(path);
  if (duration <= 0) {
    const segmentIndex = Math.min(path.length - 2, Math.floor(clamp(progress, 0, 0.999999) * (path.length - 1)));
    const localProgress = clamp(progress, 0, 1) * (path.length - 1) - segmentIndex;
    const segment = bezierSegmentFor(path, segmentIndex);
    return {
      ...cubicPoint(segment, localProgress),
      rot: interpolateHeading(segment.start.rot, segment.end.rot, localProgress),
      segmentIndex,
      segmentProgress: localProgress,
    };
  }

  const elapsed = clamp(progress, 0, 1) * duration;
  let cursor = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = bezierSegmentFor(path, index);
    const span = Math.max(0, finite(segment.end.duration, 1.5));
    if (elapsed <= cursor + span || index === path.length - 2) {
      const localProgress = span <= 0 ? 1 : clamp((elapsed - cursor) / span, 0, 1);
      return {
        ...cubicPoint(segment, localProgress),
        rot: interpolateHeading(segment.start.rot, segment.end.rot, localProgress),
        segmentIndex: index,
        segmentProgress: localProgress,
      };
    }
    cursor += span;
  }

  const end = path.at(-1);
  return { ...end, segmentIndex: path.length - 2, segmentProgress: 1 };
};
