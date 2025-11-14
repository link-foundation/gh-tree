import { request } from "undici";
import { sortNode, limitNode } from "./tree-utils.mjs";

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
      // Only take the first part after 'tree' as the ref (branch/tag name)
      // Note: URL paths within the tree are not currently supported
      if (idx !== -1 && parts[idx + 1]) ref = parts[idx + 1];
      return { owner, name, ref };
    }
  } catch {}
  // Split only on first @ to handle branch names containing @
  const atIndex = spec.indexOf("@");
  const on = atIndex === -1 ? spec : spec.substring(0, atIndex);
  const maybeRef = atIndex === -1 ? undefined : spec.substring(atIndex + 1);
  const [owner, name] = on.split("/");
  const ref = maybeRef;
  if (!owner || !name) throw new Error("Invalid --repo spec. Use owner/name[@ref] or GitHub URL");
  return { owner, name, ref };
}

async function ghApi(path, { token } = {}) {
  const headers = { "user-agent": "gh-tree" };
  // Use 'token' prefix for classic PATs (most common), 'Bearer' works for fine-grained PATs and GitHub Apps
  if (token) headers.authorization = `token ${token}`;
  const r = await request(`https://api.github.com${path}`, { headers });
  if (r.statusCode >= 400) {
    let errorMsg = `GitHub API ${path} failed: ${r.statusCode}`;

    // Check for rate limiting
    if (r.statusCode === 403) {
      const rateLimitRemaining = r.headers["x-ratelimit-remaining"];
      const rateLimitReset = r.headers["x-ratelimit-reset"];
      if (rateLimitRemaining === "0" && rateLimitReset) {
        const resetTime = new Date(parseInt(rateLimitReset) * 1000);
        errorMsg += ` - Rate limit exceeded. Resets at ${resetTime.toLocaleString()}`;
      }
    }

    try {
      const errorBody = await r.body.json();
      if (errorBody.message) errorMsg += ` - ${errorBody.message}`;
    } catch {}
    throw new Error(errorMsg);
  }
  return r.body.json();
}

export async function buildRemoteTree(spec, { depth = 3, limit = 5, countLines = false } = {}) {
  const { owner, name, ref } = parseRepoSpec(spec);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  // Line counting is not implemented for remote repositories
  if (countLines) {
    console.warn("Warning: Line counting is not supported for remote repositories. Use --no-count to suppress this warning.");
  }

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

  sortNode(root);

  limitNode(root, depth, limit, 0);

  return root;
}

