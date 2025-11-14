import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { buildLocalTree, isInsideGitRepo } from "./local.mjs";
import { buildRemoteTree } from "./remote.mjs";
import { printTree } from "./print.mjs";

/**
 * Main entry point for gh-tree CLI and library
 * @param {Array<string>} argvInput - Command line arguments (defaults to process.argv)
 * @returns {Promise<number>} Exit code
 */
export async function ghTree(argvInput) {
  const argv = yargs(hideBin(argvInput ?? process.argv))
    .scriptName("gh-tree")
    .usage("$0 [path] [options]")
    .command("$0 [path]", "Show tree of files from local or remote repository", (yargs) => {
      yargs.positional("path", {
        type: "string",
        describe: "Start path (default: current directory)",
        default: ".",
      });
    })
    .option("repo", {
      type: "string",
      describe: "Remote repo spec (owner/name[@ref]) or URL",
    })
    .option("depth", {
      type: "number",
      default: 3,
      describe: "Max depth to display",
    })
    .option("limit", {
      type: "number",
      default: 5,
      describe: "Show first/last N items per folder with ellipsis",
    })
    .option("no-count", {
      type: "boolean",
      default: false,
      describe: "Disable line counts for files",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON structure instead of pretty tree",
    })
    .check((argv) => {
      // Validate depth
      if (argv.depth !== undefined) {
        if (!Number.isInteger(argv.depth) || argv.depth < 1) {
          throw new Error("depth must be a positive integer");
        }
      }
      // Validate limit
      if (argv.limit !== undefined) {
        if (!Number.isInteger(argv.limit) || argv.limit < 1) {
          throw new Error("limit must be a positive integer");
        }
      }
      return true;
    })
    .help()
    .parseSync();

  let tree;

  try {
    if (argv.repo) {
      // Remote repository mode
      tree = await buildRemoteTree(argv.repo, {
        depth: argv.depth,
        limit: argv.limit,
        countLines: !argv["no-count"],
      });
    } else {
      // Local repository mode
      const startPath = argv.path;
      const insideGit = await isInsideGitRepo(startPath);
      tree = await buildLocalTree(startPath, {
        depth: argv.depth,
        limit: argv.limit,
        countLines: !argv["no-count"],
        useGit: insideGit,
      });
    }

    // Output tree
    if (argv.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      printTree(tree);
    }

    return 0;
  } catch (error) {
    // Provide consistent error handling
    console.error(`Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    return 1;
  }
}

export default ghTree;
