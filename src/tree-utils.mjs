/**
 * Shared utilities for tree operations
 */

/**
 * Sorts tree nodes alphabetically with directories first
 * @param {Object} node - Tree node with optional children array
 */
export function sortNode(node) {
  if (!node.children) return;
  node.children.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name)
      : a.type === "dir"
        ? -1
        : 1
  );
  for (const c of node.children) sortNode(c);
}

/**
 * Applies depth limiting and item summarization to tree nodes
 * @param {Object} node - Tree node to limit
 * @param {number} depth - Maximum depth to display
 * @param {number} limit - Number of items to show at head/tail
 * @param {number} level - Current level (internal use)
 */
export function limitNode(node, depth, limit, level = 0) {
  if (!node.children) return;

  // Apply depth limiting
  if (level + 1 >= depth) {
    const filesHere = node.children.filter((c) => c.type === "file");
    const dirsHere = node.children.filter((c) => c.type === "dir");
    if (dirsHere.length) {
      node.children = [
        ...filesHere,
        {
          name: `… ${dirsHere.length} director${dirsHere.length === 1 ? "y" : "ies"} omitted`,
          type: "omitted",
        },
      ];
    } else {
      node.children = filesHere;
    }
  } else {
    for (const c of node.children) limitNode(c, depth, limit, level + 1);
  }

  // Apply item summarization (show head/tail with ellipsis for large lists)
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

/**
 * Normalizes file paths to use forward slashes
 * @param {string} path - Path to normalize
 * @returns {string} Normalized path with forward slashes
 */
export function normalizePath(path) {
  return path.replace(/\\/g, "/");
}
