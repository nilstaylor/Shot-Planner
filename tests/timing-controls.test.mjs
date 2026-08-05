import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const boardUrl = new URL("../app/BlockingBoard.jsx", import.meta.url);

test("keeps planning time manual and optional", async () => {
  const source = await readFile(boardUrl, "utf8");

  assert.match(source, /Planning minutes \(optional\)/);
  assert.match(source, /placeholder="You decide"/);
  assert.match(source, /est:\s*""/);
  assert.doesNotMatch(source, /est:\s*20/);
  assert.doesNotMatch(source, /totalEst/);
});
