// Shared tree manipulation utilities

export function sortNode(node) {
  if (!node.children) return;
  node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === "dir" ? -1 : 1)));
  for (const c of node.children) sortNode(c);
}

export function limitNode(node, depth, limit, level = 0) {
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
    for (const c of node.children) limitNode(c, depth, limit, level + 1);
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
