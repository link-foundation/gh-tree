// Minimal smoke test to exercise the CLI entry and local tree build.
import { test, assert } from "test-anywhere";
import { ghTree } from "../src/index.mjs";

test("CLI entry with local tree build", async () => {
  const code = await ghTree(["node", "gh-tree", "--depth", "1", "--no-count", "--json"]);
  assert.equal(code, 0, "Should exit with code 0");
});

