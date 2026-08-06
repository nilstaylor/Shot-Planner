import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../out/index.html", import.meta.url);

test("static export produces a rendered page", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /<title>Shot Planner<\/title>/i);
  assert.match(html, /Add camera/i);
  assert.match(html, /Set design/i);
  assert.match(html, /Wall tool/i);
  assert.match(html, /button-cinematography-mode/i);
  assert.match(html, /button-cinematography-display/i);
  assert.match(html, /overhead blocking (?:&amp;|&) shot lists/i);
  assert.match(html, /Shot list/i);
  assert.match(html, /Print \/ save PDF/i);
  assert.match(html, /Export CSV/i);
  assert.doesNotMatch(html, /Open 3D preview/i);
  assert.doesNotMatch(html, /Include 3D previs frames in PDF/i);
  assert.match(html, /_next\/static/);
});
