import { request } from "undici";
import { sortNode, limitNode, normalizePath } from "./tree-utils.mjs";

/**
 * Parse repository specification
 * Supports formats:
 * - owner/name[@ref]
 * - https://github.com/owner/name/tree/ref
 * @param {string} spec - Repository specification
 * @returns {{owner: string, name: string, ref?: string}}
 */
function parseRepoSpec(spec) {
  // Handle full GitHub URLs
  try {
    if (spec.startsWith("http://") || spec.startsWith("https://")) {
      const u = new URL(spec);
      const parts = u.pathname.split("/").filter(Boolean);
      const owner = parts[0];
      const name = parts[1];
      let ref = undefined;
      const idx = parts.indexOf("tree");
      if (idx !== -1 && parts[idx + 1]) {
        // Join all parts after 'tree' to support branch names with slashes
        ref = parts.slice(idx + 1).join("/");
      }
      return { owner, name, ref };
    }
  } catch (error) {
    throw new Error(`Invalid GitHub URL: ${spec}`);
  }

  // Handle owner/name[@ref] format
  // Split only on first @ to support branch names containing @
  const atIndex = spec.indexOf("@");
  let owner, name, ref;

  if (atIndex !== -1) {
    const on = spec.substring(0, atIndex);
    ref = spec.substring(atIndex + 1);
    [owner, name] = on.split("/");
  } else {
    [owner, name] = spec.split("/");
  }

  if (!owner || !name) {
    throw new Error(
      "Invalid --repo spec. Use owner/name[@ref] or GitHub URL"
    );
  }

  return { owner, name, ref };
}

/**
 * Sanitize error messages to remove tokens
 * @param {string} message - Error message that might contain tokens
 * @param {string} token - Token to sanitize
 * @returns {string} Sanitized message
 */
function sanitizeError(message, token) {
  if (!token) return message;
  return message.replace(new RegExp(token, "g"), "[TOKEN_REDACTED]");
}

/**
 * Make a GitHub API request
 * @param {string} path - API path
 * @param {Object} options - Options including token
 * @returns {Promise<Object>} API response
 */
async function ghApi(path, { token } = {}) {
  const headers = { "user-agent": "gh-tree" };

  // Use 'token' prefix for classic PATs (most common)
  // GitHub also supports 'Bearer' for GitHub Apps and fine-grained PATs
  if (token) {
    // Auto-detect token type: if it starts with 'ghp_', it's a classic PAT
    // Otherwise, assume it's a fine-grained token or GitHub App token
    if (token.startsWith("ghp_") || token.startsWith("github_pat_")) {
      headers.authorization = `token ${token}`;
    } else {
      headers.authorization = `Bearer ${token}`;
    }
  }

  let response;
  try {
    response = await request(`https://api.github.com${path}`, { headers });
  } catch (error) {
    const sanitized = sanitizeError(error.message, token);
    throw new Error(`GitHub API request failed: ${sanitized}`);
  }

  // Check rate limiting
  const remaining = response.headers["x-ratelimit-remaining"];
  const resetTime = response.headers["x-ratelimit-reset"];

  if (response.statusCode >= 400) {
    let errorMessage = `GitHub API ${path} failed with status ${response.statusCode}`;

    try {
      const body = await response.body.json();
      if (body.message) {
        errorMessage += `: ${body.message}`;
      }

      // Special handling for rate limit errors
      if (response.statusCode === 403 && remaining === "0") {
        const resetDate = new Date(parseInt(resetTime) * 1000);
        errorMessage += ` (Rate limit exceeded. Resets at ${resetDate.toLocaleString()})`;
      }
    } catch {
      // Could not parse response body
    }

    throw new Error(sanitizeError(errorMessage, token));
  }

  // Warn if approaching rate limit
  if (remaining && parseInt(remaining) < 10) {
    const resetDate = new Date(parseInt(resetTime) * 1000);
    console.warn(
      `Warning: GitHub API rate limit low (${remaining} remaining, resets at ${resetDate.toLocaleString()})`
    );
  }

  return response.body.json();
}

/**
 * Build a tree structure from remote GitHub repository
 * Note: Line counting is not supported for remote repositories
 * @param {string} spec - Repository specification
 * @param {Object} options - Options for tree building
 * @returns {Promise<Object>} Tree structure
 */
export async function buildRemoteTree(
  spec,
  { depth = 3, limit = 5, countLines = false } = {}
) {
  const { owner, name, ref } = parseRepoSpec(spec);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  // Warn user if they requested line counts for remote (not supported)
  if (countLines) {
    console.warn(
      "Warning: Line counting is not supported for remote repositories (requires fetching all file contents)"
    );
  }

  // Resolve default branch if no ref specified
  let sha = ref;
  if (!sha) {
    const repo = await ghApi(`/repos/${owner}/${name}`, { token });
    sha = repo.default_branch;
  }

  // Resolve ref to commit SHA and get tree SHA
  const commit = await ghApi(
    `/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}`,
    { token }
  );
  const treeSha = commit.commit.tree.sha;

  // Fetch entire tree recursively
  const treeResp = await ghApi(
    `/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`,
    { token }
  );
  const entries = treeResp.tree || [];

  // Filter for blob (file) entries only
  const files = entries
    .filter((e) => e.type === "blob")
    .map((e) => normalizePath(e.path));

  // Build nested tree structure
  const root = {
    name: `${owner}/${name}@${sha}`,
    type: "dir",
    children: [],
  };

  for (const rel of files) {
    const parts = rel.split("/");
    let parent = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

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
      }
    }
  }

  // Sort children alphabetically (directories first)
  sortNode(root);

  // Apply depth limit and summarization
  limitNode(root, depth, limit, 0);

  return root;
}
