// Minimal smoke test to exercise the CLI entry and local tree build.
import { ghTree } from "../src/index.mjs";

const main = async () => {
  const code = await ghTree(["node", "gh-tree", "--depth", "1", "--no-count", "--json"]);
  if (code !== 0) throw new Error("Non-zero exit code");
  console.log("ok");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

