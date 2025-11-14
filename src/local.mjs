import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { sortNode, limitNode } from "./tree-utils.mjs";

export async function isInsideGitRepo(startDir = ".") {
  // Check for .git up the tree (can be directory or file in worktrees/submodules)
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    try {
      const stat = await fs.stat(path.join(dir, ".git"));
      if (stat && (stat.isDirectory() || stat.isFile())) return true;
    } catch {}
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return false;
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;

    // Set timeout to 30 seconds to prevent hanging
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30000);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ code: -1, out, err: err + "\nProcess timed out after 30 seconds" });
      } else {
        resolve({ code, out, err });
      }
    });
  });
}

async function listFilesWithGit(startDir) {
  const { code, out } = await run("git", [
    "ls-files",
    "-co",
    "--exclude-standard",
  ], { cwd: startDir });
  if (code !== 0) return null;
  return out.split(/\r?\n/).filter(Boolean);
}

async function listFilesManually(startDir) {
  const igCache = new Map();
  const rulesCache = new Map();

  async function loadIgnore(dir) {
    if (igCache.has(dir)) return igCache.get(dir);

    // Collect rules from current and parent directories
    const rules = [];
    const parent = path.dirname(dir);
    if (parent !== dir && rulesCache.has(parent)) {
      rules.push(...rulesCache.get(parent));
    } else if (parent !== dir) {
      await loadIgnore(parent); // Ensure parent is loaded
      if (rulesCache.has(parent)) {
        rules.push(...rulesCache.get(parent));
      }
    }

    // Add current directory's .gitignore rules
    try {
      const txt = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
      rules.push(...txt.split(/\r?\n/));
    } catch {}

    // Create ignore instance with all rules
    const ig = ignore();
    if (rules.length > 0) ig.add(rules);

    rulesCache.set(dir, rules);
    igCache.set(dir, ig);
    return ig;
  }

  const files = [];
  async function walk(dir, rel = "") {
    const ig = await loadIgnore(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = entries.map((e) => e.name).filter((n) => n !== ".git");
    const filtered = ig.filter(names);
    for (const name of filtered) {
      const full = path.join(dir, name);
      const relPath = path.join(rel, name);
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        await walk(full, relPath);
      } else if (st.isFile()) {
        files.push(relPath);
      }
    }
  }
  await walk(path.resolve(startDir));
  return files;
}

export async function buildLocalTree(startDir, { depth = 3, limit = 5, countLines = true, useGit = true } = {}) {
  const root = path.resolve(startDir);
  let files = null;
  if (useGit) files = await listFilesWithGit(root);
  if (!files) files = await listFilesManually(root);

  // Build nested structure
  const sep = path.sep;
  const tree = { name: path.basename(root) || root, type: "dir", children: [] };

  // Map dirs to node
  const dirMap = new Map();
  dirMap.set("", tree);

  for (const rel of files) {
    const parts = rel.split(/\\|\//g);
    let curPath = "";
    let parent = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const nextPath = curPath ? curPath + "/" + part : part;
      if (isLast) {
        parent.children.push({ name: part, type: "file", relPath: rel });
      } else {
        let node = (parent.children.find((c) => c.type === "dir" && c.name === part));
        if (!node) {
          node = { name: part, type: "dir", children: [] };
          parent.children.push(node);
        }
        parent = node;
        curPath = nextPath;
      }
    }
  }

  // Sort children alpha
  sortNode(tree);

  // Common binary file extensions to skip
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
    '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.woff', '.woff2', '.ttf', '.eot', '.otf'
  ]);

  function isBinaryFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return binaryExtensions.has(ext);
  }

  // Optionally count lines for files (best-effort, skip big files > 1.5MB and binary files)
  async function countNode(node, curPath = "") {
    if (node.type === "file" && countLines) {
      try {
        const full = path.join(root, node.relPath);
        const st = await fs.stat(full);

        // Skip large files and binary files
        if (st.size > 1_500_000 || isBinaryFile(full)) {
          node.lines = null;
        } else {
          const buf = await fs.readFile(full, "utf8");
          // Count lines correctly: empty file = 0 lines, file with content = number of newlines + 1 (unless ends with newline)
          if (buf === "") {
            node.lines = 0;
          } else {
            // Count newlines and add 1 if file doesn't end with newline
            const lines = buf.split("\n").length;
            node.lines = buf.endsWith("\n") ? lines - 1 : lines;
          }
        }
      } catch {
        node.lines = null;
      }
    }
    if (node.children) {
      for (const c of node.children) await countNode(c, path.join(curPath, node.name));
    }
  }
  await countNode(tree);

  // Apply depth limit and summarization per folder
  limitNode(tree, depth, limit, 0);

  return tree;
}

