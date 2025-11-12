# gh-tree

Show a tree of files from a local Git repository or a remote GitHub repository, similar to `tree`, with line counts and `.gitignore` support.

Features (PoC):
- Defaults to current git repo (local filesystem); supports `--repo owner/name[@ref]` for remote.
- Shows number of lines for text files by default (like `wc -l`).
- Applies `.gitignore` rules (local: via git; remote: best-effort PoC without ignore).
- Limits output to 3 levels by default (`--depth`), and summarizes large folders showing first/last 5 entries with an ellipsis (`--limit`).
- Usable as a CLI and as a library function.

Install (Node.js):
- Global: `npm i -g` (from repo root) then run `gh-tree`.
- Local dev: `node bin/gh-tree.mjs`.

Usage:
- Local repo (default): `gh-tree` or `gh-tree path/to/repo`
- Remote repo: `gh-tree --repo link-foundation/gh-tree@main`
- Options:
  - `--depth <n>`: maximum depth (default 3)
  - `--limit <n>`: head/tail limit per folder (default 5)
  - `--no-count`: disable line counts
  - `--json`: output JSON structure

Library:
```js
import { ghTree } from 'gh-tree';
await ghTree(["node", "gh-tree", "./path", "--depth", "2"]);
```

Notes:
- Local `.gitignore` is honored via `git ls-files -co --exclude-standard` when in a git repo; otherwise a basic `.gitignore` parser is used.
- Remote mode currently does not evaluate `.gitignore` rules (PoC simplification).
