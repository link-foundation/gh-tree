function pad(prefix, isLast) {
  return prefix + (isLast ? "  " : "│ ");
}

export function printTree(tree) {
  const lines = [];
  function printNode(node, prefix = "", isLast = true) {
    const branch = prefix ? (isLast ? "└─" : "├─") : "";
    let label = node.name;
    if (node.type === "file" && typeof node.lines === "number") {
      label += ` (${node.lines})`;
    }
    lines.push(`${prefix}${branch}${label}`);

    if (node.children) {
      node.children.forEach((child, idx) => {
        const last = idx === node.children.length - 1;
        printNode(child, pad(prefix, isLast), last);
      });
    }
  }
  printNode(tree);
  console.log(lines.join("\n"));
}

