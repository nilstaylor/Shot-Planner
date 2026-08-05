import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../out/index.html", import.meta.url);

test("static export produces a rendered page", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /<title>Shot Planner<\/title>/i);
  assert.match(html, /Shot list/i);
  assert.match(html, /_next\/static/);
});
