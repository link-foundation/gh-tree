import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { buildLocalTree, isInsideGitRepo } from "./local.mjs";
import { buildRemoteTree } from "./remote.mjs";
import { printTree } from "./print.mjs";

export async function ghTree(argvInput) {
  const argv = yargs(hideBin(argvInput ?? process.argv))
    .scriptName("gh-tree")
    .usage("$0 [path] [options]")
    .option("repo", {
      type: "string",
      describe: "Remote repo spec (owner/name[@ref]) or URL"
    })
    .option("depth", {
      type: "number",
      default: 3,
      describe: "Max depth to display"
    })
    .option("limit", {
      type: "number",
      default: 5,
      describe: "Show first/last N items per folder with ellipsis"
    })
    .option("no-count", {
      type: "boolean",
      default: false,
      describe: "Disable line counts for files"
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON structure instead of pretty tree"
    })
    .help()
    .parseSync();

  // Handle positional path argument
  const path = argv._[0] || ".";

  // Validate depth and limit parameters
  if (argv.depth <= 0 || !Number.isInteger(argv.depth)) {
    throw new Error("--depth must be a positive integer");
  }
  if (argv.limit <= 0 || !Number.isInteger(argv.limit)) {
    throw new Error("--limit must be a positive integer");
  }

  let tree;

  if (argv.repo) {
    tree = await buildRemoteTree(argv.repo, {
      depth: argv.depth,
      limit: argv.limit,
      countLines: !argv["no-count"],
    });
  } else {
    const insideGit = await isInsideGitRepo(path);
    tree = await buildLocalTree(path, {
      depth: argv.depth,
      limit: argv.limit,
      countLines: !argv["no-count"],
      useGit: insideGit,
    });
  }

  if (argv.json) {
    console.log(JSON.stringify(tree, null, 2));
  } else {
    printTree(tree);
  }

  return 0;
}

export default ghTree;

