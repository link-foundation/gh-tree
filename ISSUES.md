# Code Review Issues

This document lists potential bugs, consistency issues, and improvements identified during code review of the gh-tree repository.

## 🔴 Critical Issues

### 1. Git Worktree Detection Failure (src/local.mjs:13-14)
**Severity:** High
**Location:** `src/local.mjs:13-14`

**Issue:** The `.git` directory check assumes `.git` is always a directory, but in git worktrees and submodules, `.git` is a file containing a reference to the actual git directory.

```javascript
const stat = await fs.stat(path.join(dir, ".git"));
if (stat && stat.isDirectory()) return true;
```

**Impact:** The tool will fail to detect git repositories for worktrees, falling back to manual file listing which may produce different results.

**Recommendation:** Check for both `stat.isDirectory()` and `stat.isFile()`.

---

### 2. GitHub API Authentication Method (src/remote.mjs:26)
**Severity:** Medium
**Location:** `src/remote.mjs:26`

**Issue:** Uses `Bearer` token authentication, but GitHub Personal Access Tokens (classic) should use the `token` prefix, not `Bearer`. While `Bearer` works for some token types (GitHub Apps, fine-grained PATs), it's inconsistent with traditional usage.

```javascript
if (token) headers.authorization = `Bearer ${token}`;
```

**Impact:** May cause authentication failures with certain token types.

**Recommendation:** Use `token ${token}` for classic PATs or detect token type, or document that only Bearer-compatible tokens are supported.

---

### 3. Private API Property Access (src/local.mjs:52)
**Severity:** Medium
**Location:** `src/local.mjs:52`

**Issue:** Accesses private `_rules` property of the `ignore` library which is an implementation detail.

```javascript
if (parentIg) ig.add(parentIg._rules?.map((r) => r.origin) || []);
```

**Impact:** Code will break if the `ignore` library changes its internal structure in future versions.

**Recommendation:** Use the library's public API or find an alternative approach to inherit parent rules.

---

## 🟡 Bugs & Logic Errors

### 4. Unused `cwd` Variable (src/index.mjs:43)
**Severity:** Low
**Location:** `src/index.mjs:43`

**Issue:** Variable `cwd` is declared but never used.

```javascript
const cwd = process.cwd();
```

**Recommendation:** Remove unused variable.

---

### 5. Redundant Default Value Handling (src/index.mjs:53-54)
**Severity:** Low
**Location:** `src/index.mjs:53-54`

**Issue:** Uses `argv.path || "."` when `argv.path` already has a default value of `"."` from yargs configuration (line 14).

```javascript
const insideGit = await isInsideGitRepo(argv.path || ".");
tree = await buildLocalTree(argv.path || ".", {
```

**Recommendation:** Remove `|| "."` fallback as it's redundant.

---

### 6. Branch Name Parsing with @ Symbol (src/remote.mjs:17-19)
**Severity:** Medium
**Location:** `src/remote.mjs:17-19`

**Issue:** Splits repo spec by `@` to separate branch name, but Git branch names can legally contain `@` characters.

```javascript
const [on, maybeRef] = spec.split("@");
```

**Impact:** A spec like `owner/repo@feature@work` would incorrectly parse the ref as just `feature`.

**Recommendation:** Use `split('@')` with limit parameter: `spec.split('@', 2)` to only split on the first `@`, or use `lastIndexOf('@')` for the split point.

---

### 7. Line Count Accepts Parameter But Not Implemented for Remote (src/remote.mjs:32)
**Severity:** Low
**Location:** `src/remote.mjs:32`

**Issue:** `buildRemoteTree` accepts `countLines` parameter but never uses it. Line counting is only implemented for local repositories.

```javascript
export async function buildRemoteTree(spec, { depth = 3, limit = 5, countLines = false } = {}) {
```

**Impact:** Users might expect line counts for remote repos but won't get them. Silent feature mismatch.

**Recommendation:** Either implement line counting for remote (fetch blob contents) or document the limitation and warn users when `--no-count` is used with `--repo`.

---

### 8. Binary File Handling (src/local.mjs:136)
**Severity:** Medium
**Location:** `src/local.mjs:136`

**Issue:** Attempts to read all files as UTF-8 without checking if they're binary files.

```javascript
const buf = await fs.readFile(full, "utf8");
```

**Impact:** Binary files will cause errors or be read incorrectly, though the try-catch will set `lines = null`.

**Recommendation:** Skip binary files by checking file extension or magic bytes before attempting to read, or catch specific encoding errors.

---

### 9. Line Count Logic for Files Without Trailing Newline (src/local.mjs:137)
**Severity:** Low
**Location:** `src/local.mjs:137`

**Issue:** Counts lines by splitting on `\n`. This is mostly correct but the edge case behavior isn't explicit.

```javascript
node.lines = buf === "" ? 0 : buf.split("\n").length;
```

For a file containing `"line1\nline2"` (no trailing newline), this returns 2 (correct).
For a file containing `"line1\n"` (with trailing newline), this returns 2 (arguably should be 1).

**Impact:** Off-by-one line counts for files with trailing newlines (matches most text editors' behavior though).

**Recommendation:** Document the behavior or adjust logic to match specific line-counting convention.

---

### 10. No Process Timeout (src/local.mjs:22-30)
**Severity:** Medium
**Location:** `src/local.mjs:22-30`

**Issue:** The `run()` function spawns a child process with no timeout.

**Impact:** If `git ls-files` hangs, the entire application hangs indefinitely.

**Recommendation:** Add a timeout and kill the process if it exceeds a reasonable duration.

---

### 11. Positional Argument Not Working (src/index.mjs:11-15)
**Severity:** High
**Location:** `src/index.mjs:11-15`

**Issue:** Yargs positional argument is configured with `.positional()` but without a corresponding `.command()`. Positional arguments in yargs only work within command definitions, not at the root level like this.

```javascript
.positional("path", {
  type: "string",
  describe: "Start path (default: current directory)",
  default: "."
})
```

**Impact:** Running `gh-tree ./src` will NOT set `argv.path` to `"./src"`. The positional argument is ignored. Users must use `gh-tree --path ./src` instead, which is not the typical CLI UX.

**Recommendation:** Use `yargs(...)` with `.command()` or remove `.positional()` and use `argv._[0]` to access the first positional argument.

---

## 🔵 Consistency Issues

### 12. Path Separator Inconsistency (src/local.mjs:98 vs src/remote.mjs:52)
**Severity:** Medium
**Locations:**
- `src/local.mjs:98`
- `src/remote.mjs:52`

**Issue:** Local tree building splits paths by both `\` and `/`:

```javascript
// local.mjs:98
const parts = rel.split(/\\|\//g);
```

But remote tree building only splits by `/`:

```javascript
// remote.mjs:52
const parts = rel.split("/");
```

Also, local normalizes to `/` when building paths (line 104):
```javascript
const nextPath = curPath ? curPath + "/" + part : part;
```

**Impact:** Inconsistent behavior between local and remote modes, though in practice remote repos always use `/`.

**Recommendation:** Use consistent path handling, possibly with `path.sep` or normalize all paths to forward slashes.

---

### 13. Code Duplication: Sorting and Limiting Logic
**Severity:** Medium
**Locations:**
- `src/local.mjs:120-124` and `src/remote.mjs:70-74` (sortNode)
- `src/local.mjs:150-180` and `src/remote.mjs:77-104` (limitNode)

**Issue:** The `sortNode()` and `limitNode()` functions are duplicated between local.mjs and remote.mjs with identical implementations.

**Impact:** Maintenance burden - bug fixes must be applied twice. Inconsistency risk if one gets updated and not the other.

**Recommendation:** Extract shared functions to a common utility module (e.g., `src/tree-utils.mjs`).

---

### 14. License Inconsistency
**Severity:** Low
**Location:** `package.json:37`

**Issue:** The package.json declares `"license": "MIT"` but the initial commit message and README history reference "Unlicense" (public domain).

**Impact:** Legal ambiguity about the actual license.

**Recommendation:** Verify intended license and ensure LICENSE file, package.json, and README are consistent.

---

### 15. Inconsistent Error Handling Patterns
**Severity:** Low
**Locations:** Multiple

**Issue:** Different error handling approaches across modules:
- `local.mjs`: Uses try-catch with silent failures (returns null)
- `remote.mjs`: Throws errors
- `index.mjs`: No error handling (relies on caller)

**Impact:** Inconsistent error propagation makes debugging harder.

**Recommendation:** Establish consistent error handling pattern across the codebase.

---

## 🟢 Potential Improvements

### 16. Missing Input Validation
**Severity:** Low
**Location:** `src/index.mjs:20-28`

**Issue:** No validation on `depth` and `limit` parameters. Users could pass negative numbers, zero, or non-integers.

**Recommendation:** Add validation to ensure positive integers.

---

### 17. Poor Error Messages from GitHub API
**Severity:** Low
**Location:** `src/remote.mjs:28`

**Issue:** GitHub API errors only include status code, not the response body which often contains helpful error details.

```javascript
if (r.statusCode >= 400) throw new Error(`GitHub API ${path} failed: ${r.statusCode}`);
```

**Recommendation:** Parse and include response body in error message.

---

### 18. No Rate Limit Handling
**Severity:** Medium
**Location:** `src/remote.mjs:24-29`

**Issue:** No handling for GitHub API rate limits. When rate limited, the API returns 403 with rate limit info in headers.

**Impact:** Poor user experience when hitting rate limits - no indication of when they can retry.

**Recommendation:** Check `X-RateLimit-Remaining` header and provide helpful error messages when rate limited.

---

### 19. Exit Code Check Redundancy
**Severity:** Low
**Location:** `bin/gh-tree.mjs:7`

**Issue:** Checks `typeof code === "number"` but `ghTree()` always returns 0 or throws an error, never returning undefined.

```javascript
if (typeof code === "number") process.exit(code);
```

**Recommendation:** Simplify to `process.exit(code)` or document why the check exists.

---

### 20. Test Coverage Gaps
**Severity:** Medium
**Location:** `tests/smoke.test.mjs`

**Issue:** The smoke test only verifies:
- Exit code is 0
- Local mode with basic flags

Missing tests for:
- Remote mode functionality
- Error cases (invalid repos, network failures)
- Edge cases (empty repos, binary files, large files)
- Line counting accuracy
- Depth and limit functionality
- .gitignore rule handling
- Output validation (JSON structure, tree formatting)

**Recommendation:** Add comprehensive test suite covering all functionality and edge cases.

---

### 21. No Token Sanitization in Error Logs
**Severity:** Medium (Security)
**Location:** `src/remote.mjs:24-29`

**Issue:** If the GitHub API call fails, error messages might inadvertently log authorization headers or URLs containing tokens.

**Impact:** Potential token exposure in logs.

**Recommendation:** Sanitize error messages to remove tokens before throwing.

---

### 22. Missing URL Tree Path Parsing Edge Case
**Severity:** Low
**Location:** `src/remote.mjs:13`

**Issue:** When parsing GitHub URLs like `https://github.com/owner/repo/tree/branch/path/to/file`, the code joins everything after "tree" as the ref, but doesn't handle the tree path portion.

```javascript
if (idx !== -1 && parts[idx + 1]) ref = parts.slice(idx + 1).join("/");
```

**Impact:** Currently treats entire path as branch name, which may work if GitHub API resolves it, but semantically incorrect. The API might return unexpected results.

**Recommendation:** Parse only the ref (branch/tag name) and handle the path portion separately, or document that tree paths in URLs are not supported.

---

## 📊 Summary

- **Critical Issues:** 3
- **Bugs & Logic Errors:** 8
- **Consistency Issues:** 4
- **Potential Improvements:** 8

**Total Issues Identified:** 23

---

## Recommendations Priority

### High Priority (Fix First)
1. Issue #11: Positional argument not working
2. Issue #1: Git worktree detection failure
3. Issue #6: Branch name parsing with @ symbol
4. Issue #2: GitHub API authentication method

### Medium Priority
5. Issue #3: Private API property access (breaking change risk)
6. Issue #13: Code duplication
7. Issue #10: No process timeout
8. Issue #12: Path separator inconsistency
9. Issue #18: No rate limit handling
10. Issue #21: Token sanitization in errors

### Low Priority (Nice to Have)
11. Remaining issues (cleanup, documentation, test coverage)

---

*Code review completed on 2025-11-14*
