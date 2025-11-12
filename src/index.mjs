import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { buildLocalTree, isInsideGitRepo } from "./local.mjs";
import { buildRemoteTree } from "./remote.mjs";
import { printTree } from "./print.mjs";

export async function ghTree(argvInput) {
  const argv = yargs(hideBin(argvInput ?? process.argv))
    .scriptName("gh-tree")
    .usage("$0 [path] [options]")
    .positional("path", {
      type: "string",
      describe: "Start path (default: current directory)",
      default: "."
    })
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
    .option("count", {
      type: "boolean",
      default: true,
      describe: "Include line counts for files (use --no-count to disable)"
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON structure instead of pretty tree"
    })
    .help()
    .parseSync();

  const cwd = process.cwd();
  let tree;

  if (argv.repo) {
    tree = await buildRemoteTree(argv.repo, {
      depth: argv.depth,
      limit: argv.limit,
      countLines: argv.count,
    });
  } else {
    const insideGit = await isInsideGitRepo(argv.path || ".");
    tree = await buildLocalTree(argv.path || ".", {
      depth: argv.depth,
      limit: argv.limit,
      countLines: argv.count,
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

