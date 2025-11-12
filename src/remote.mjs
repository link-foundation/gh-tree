import { request } from "undici";

function parseRepoSpec(spec) {
  // Accept owner/name[@ref] or full URL https://github.com/owner/name/tree/ref
  try {
    if (spec.startsWith("http://") || spec.startsWith("https://")) {
      const u = new URL(spec);
      const parts = u.pathname.split("/").filter(Boolean);
      const owner = parts[0];
      const name = parts[1];
      let ref = undefined;
      const idx = parts.indexOf("tree");
      if (idx !== -1 && parts[idx + 1]) ref = parts.slice(idx + 1).join("/");
      return { owner, name, ref };
    }
  } catch {}
  const [on, maybeRef] = spec.split("@");
  const [owner, name] = on.split("/");
  const ref = maybeRef;
  if (!owner || !name) throw new Error("Invalid --repo spec. Use owner/name[@ref] or GitHub URL");
  return { owner, name, ref };
}

async function ghApi(path, { token } = {}) {
  const headers = { "user-agent": "gh-tree" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await request(`https://api.github.com${path}`, { headers });
  if (r.statusCode >= 400) throw new Error(`GitHub API ${path} failed: ${r.statusCode}`);
  return r.body.json();
}

export async function buildRemoteTree(spec, { depth = 3, limit = 5, countLines = false } = {}) {
  const { owner, name, ref } = parseRepoSpec(spec);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  // Resolve default branch if no ref
  let sha = ref;
  if (!sha) {
    const repo = await ghApi(`/repos/${owner}/${name}`, { token });
    sha = repo.default_branch;
  }
  // Resolve ref to tree sha
  const commit = await ghApi(`/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}`, { token });
  const treeSha = commit.commit.tree.sha;
  const treeResp = await ghApi(`/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`, { token });
  const entries = treeResp.tree || [];
  const files = entries.filter((e) => e.type === "blob").map((e) => e.path);

  // Build tree structure similar to local
  const root = { name: `${owner}/${name}@${sha}`, type: "dir", children: [] };
  for (const rel of files) {
    const parts = rel.split("/");
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        parent.children.push({ name: part, type: "file", relPath: rel });
      } else {
        let node = parent.children.find((c) => c.type === "dir" && c.name === part);
        if (!node) {
          node = { name: part, type: "dir", children: [] };
          parent.children.push(node);
        }
        parent = node;
      }
    }
  }

  function sortNode(node) {
    if (!node.children) return;
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === "dir" ? -1 : 1)));
    for (const c of node.children) sortNode(c);
  }
  sortNode(root);

  function limitNode(node, level = 0) {
    if (!node.children) return;
    if (level + 1 >= depth) {
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
  limitNode(root, 0);

  return root;
}

