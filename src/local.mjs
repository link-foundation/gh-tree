import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { sortNode, limitNode, normalizePath } from "./tree-utils.mjs";

const PROCESS_TIMEOUT = 30000; // 30 seconds timeout for git commands
const MAX_FILE_SIZE = 1_500_000; // 1.5MB

/**
 * Check if we're inside a git repository by looking for .git up the directory tree
 * @param {string} startDir - Directory to start searching from
 * @returns {Promise<boolean>} True if inside a git repo
 */
export async function isInsideGitRepo(startDir = ".") {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    try {
      const gitPath = path.join(dir, ".git");
      const stat = await fs.stat(gitPath);
      // .git can be either a directory (normal repo) or a file (worktree/submodule)
      if (stat && (stat.isDirectory() || stat.isFile())) return true;
    } catch {
      // .git doesn't exist at this level, continue up
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return false;
}

/**
 * Run a command with timeout
 * @param {string} cmd - Command to run
 * @param {Array<string>} args - Command arguments
 * @param {Object} options - Options including cwd and timeout
 * @returns {Promise<{code: number, out: string, err: string}>}
 */
function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`Command timed out after ${options.timeout || PROCESS_TIMEOUT}ms`));
    }, options.timeout || PROCESS_TIMEOUT);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (!timedOut) {
        resolve({ code, out, err });
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * List files using git ls-files (respects .gitignore)
 * @param {string} startDir - Directory to list files from
 * @returns {Promise<string[]|null>} Array of file paths or null if git fails
 */
async function listFilesWithGit(startDir) {
  try {
    const { code, out } = await run(
      "git",
      ["ls-files", "-co", "--exclude-standard"],
      { cwd: startDir }
    );
    if (code !== 0) return null;
    return out.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    // Git command failed or timed out
    return null;
  }
}

/**
 * List files manually by walking directory tree and respecting .gitignore files
 * @param {string} startDir - Directory to list files from
 * @returns {Promise<string[]>} Array of file paths
 */
async function listFilesManually(startDir) {
  const igCache = new Map();

  /**
   * Load .gitignore rules for a directory, inheriting from parent
   * @param {string} dir - Directory to load .gitignore from
   * @returns {Promise<Object>} ignore instance
   */
  async function loadIgnore(dir) {
    if (igCache.has(dir)) return igCache.get(dir);

    const ig = ignore();

    // Inherit parent rules by reading parent's .gitignore
    const parent = path.dirname(dir);
    if (parent !== dir) {
      const parentIg = await loadIgnore(parent);
      // We need to create a new ignore instance and manually add parent patterns
      // Since the ignore library doesn't expose rules publicly, we read parent .gitignore again
      try {
        const parentGitignorePath = path.join(parent, ".gitignore");
        await fs.access(parentGitignorePath);
        const parentTxt = await fs.readFile(parentGitignorePath, "utf8");
        ig.add(parentTxt.split(/\r?\n/));
      } catch {
        // No parent .gitignore file
      }
    }

    // Add current directory's .gitignore rules
    try {
      const txt = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
      ig.add(txt.split(/\r?\n/));
    } catch {
      // No .gitignore file in this directory
    }

    igCache.set(dir, ig);
    return ig;
  }

  const files = [];

  /**
   * Recursively walk directory tree
   * @param {string} dir - Current directory
   * @param {string} rel - Relative path from start
   */
  async function walk(dir, rel = "") {
    const ig = await loadIgnore(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = entries.map((e) => e.name).filter((n) => n !== ".git");
    const filtered = ig.filter(names);

    for (const name of filtered) {
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;

      try {
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          await walk(full, relPath);
        } else if (st.isFile()) {
          files.push(relPath);
        }
      } catch {
        // Skip files we can't stat (permission issues, etc.)
      }
    }
  }

  await walk(path.resolve(startDir));
  return files;
}

/**
 * Check if a file is likely binary by checking for null bytes in first chunk
 * @param {string} filePath - Path to file
 * @returns {Promise<boolean>} True if file appears to be binary
 */
async function isBinaryFile(filePath) {
  try {
    const buffer = Buffer.alloc(512);
    const fd = await fs.open(filePath, "r");
    const { bytesRead } = await fd.read(buffer, 0, 512, 0);
    await fd.close();

    // Check for null bytes which indicate binary content
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true; // Assume binary if we can't read
  }
}

/**
 * Build a tree structure from local files
 * @param {string} startDir - Starting directory
 * @param {Object} options - Options for tree building
 * @returns {Promise<Object>} Tree structure
 */
export async function buildLocalTree(
  startDir,
  { depth = 3, limit = 5, countLines = true, useGit = true } = {}
) {
  const root = path.resolve(startDir);
  let files = null;

  // Try using git first if we're in a repo
  if (useGit) files = await listFilesWithGit(root);
  // Fall back to manual listing if git fails or not in a repo
  if (!files) files = await listFilesManually(root);

  // Build nested structure
  const tree = {
    name: path.basename(root) || root,
    type: "dir",
    children: [],
  };

  // Map to track directory nodes
  const dirMap = new Map();
  dirMap.set("", tree);

  for (const rel of files) {
    // Normalize path separators to forward slashes
    const normalizedRel = normalizePath(rel);
    const parts = normalizedRel.split("/");
    let curPath = "";
    let parent = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nextPath = curPath ? `${curPath}/${part}` : part;

      if (isLast) {
        // Add file node
        parent.children.push({ name: part, type: "file", relPath: rel });
      } else {
        // Find or create directory node
        let node = parent.children.find(
          (c) => c.type === "dir" && c.name === part
        );
        if (!node) {
          node = { name: part, type: "dir", children: [] };
          parent.children.push(node);
        }
        parent = node;
        curPath = nextPath;
      }
    }
  }

  // Sort children alphabetically (directories first)
  sortNode(tree);

  // Optionally count lines for files (skip large files and binaries)
  async function countNode(node) {
    if (node.type === "file" && countLines) {
      try {
        const full = path.join(root, node.relPath);
        const st = await fs.stat(full);

        if (st.size > MAX_FILE_SIZE) {
          node.lines = null; // Skip large files
        } else if (await isBinaryFile(full)) {
          node.lines = null; // Skip binary files
        } else {
          const buf = await fs.readFile(full, "utf8");
          // Count lines: empty file = 0, otherwise count newlines + 1
          node.lines = buf === "" ? 0 : buf.split("\n").length;
        }
      } catch {
        node.lines = null; // Error reading file
      }
    }

    if (node.children) {
      for (const c of node.children) await countNode(c);
    }
  }
  await countNode(tree);

  // Apply depth limit and summarization
  limitNode(tree, depth, limit, 0);

  return tree;
}
