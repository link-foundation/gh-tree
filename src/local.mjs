import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore from "ignore";

export async function isInsideGitRepo(startDir = ".") {
  // Check for .git up the tree
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    try {
      const stat = await fs.stat(path.join(dir, ".git"));
      if (stat && stat.isDirectory()) return true;
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
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => resolve({ code, out, err }));
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
  async function loadIgnore(dir) {
    if (igCache.has(dir)) return igCache.get(dir);
    const ig = ignore();
    // Inherit parent rules
    const parent = path.dirname(dir);
    if (parent !== dir) {
      const parentIg = await loadIgnore(parent);
      if (parentIg) ig.add(parentIg._rules?.map((r) => r.origin) || []);
    }
    try {
      const txt = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
      ig.add(txt.split(/\r?\n/));
    } catch {}
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
  function sortNode(node) {
    if (!node.children) return;
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === "dir" ? -1 : 1)));
    for (const c of node.children) sortNode(c);
  }
  sortNode(tree);

  // Optionally count lines for files (best-effort, skip big files > 1.5MB)
  async function countNode(node, curPath = "") {
    if (node.type === "file" && countLines) {
      try {
        const full = path.join(root, node.relPath);
        const st = await fs.stat(full);
        if (st.size > 1_500_000) {
          node.lines = null;
        } else {
          const buf = await fs.readFile(full, "utf8");
          node.lines = buf === "" ? 0 : buf.split("\n").length;
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
  function limitNode(node, level = 0) {
    if (!node.children) return;
    if (level + 1 >= depth) {
      // Only keep files at this level; collapse deeper dirs as summary
      const filesHere = node.children.filter((c) => c.type === "file");
      const dirsHere = node.children.filter((c) => c.type === "dir");
      if (dirsHere.length) {
        node.children = [
          ...filesHere,
          { name: `… ${dirsHere.length} director${dirsHere.length === 1 ? "y" : "ies"} omitted`, type: "omitted" }
        ];
      } else {
        node.children = filesHere;
      }
    } else {
      for (const c of node.children) limitNode(c, level + 1);
    }

    // Summarize many entries
    const n = node.children.length;
    if (n > limit * 2 + 1) {
      const head = node.children.slice(0, limit);
      const tail = node.children.slice(n - limit);
      const omitted = n - head.length - tail.length;
      node.children = [
        ...head,
        { name: `… ${omitted} omitted …`, type: "omitted" },
        ...tail,
      ];
    }
  }
  limitNode(tree, 0);

  return tree;
}

