# ADR-041: Cross-Platform Compatibility

## Status
Accepted

## Context
RenRe Kit is a developer tool that should work on the three major platforms: macOS, Linux, and Windows. Several architectural decisions (signal handling, file paths, process management) currently assume Unix-like systems. We need explicit cross-platform rules to prevent platform-specific bugs.

## Decision

### Supported Platforms
| Platform | Architecture | Priority |
|----------|-------------|----------|
| macOS | arm64 (Apple Silicon), x64 | Primary |
| Linux | x64 | Primary |
| Windows | x64 | Secondary (v1.1+) |

### Platform Abstraction Rules

#### File Paths
- **Always** use `path.join()` / `path.resolve()` — never string concatenation with `/`
- **Always** use `os.homedir()` — never hardcode `~` or `$HOME`
- Store paths in `server.json` and `projects/*.json` using the OS-native separator
- When comparing paths, normalize with `path.normalize()` first

#### Data Directory
```
macOS/Linux: ~/.renre-kit/
Windows:     C:\Users\{user}\.renre-kit\
```
Resolved via `path.join(os.homedir(), '.renre-kit')`.

#### Process Management
| Operation | Implementation |
|-----------|---------------|
| Check if PID exists | `process.kill(pid, 0)` — works on all platforms |
| Graceful shutdown | Register `SIGINT`, `SIGTERM`, and `SIGBREAK` (Windows-specific) |
| Force kill | `process.kill(pid, 'SIGKILL')` on Unix, `process.kill(pid)` on Windows |
| Detached spawn | `child_process.spawn(cmd, args, { detached: true, stdio: 'ignore' })` + `.unref()` — works cross-platform |
| Process name verification | Unix: `ps -p {pid} -o command=` / Windows: `wmic process where ProcessId={pid} get CommandLine` |

#### Shell Execution
- `worker-service.cjs` is invoked via `node` — not via shell — so no shell compatibility issues
- MCP stdio commands are spawned via `child_process.spawn()` (not `exec`) — no shell interpolation
- Never use shell-specific syntax (`&&`, `||`, `;`) in programmatic process spawning

#### File Permissions
- Unix: `fs.chmodSync(serverPidPath, 0o600)` for sensitive files (`server.pid`, `server.json`)
- Windows: Skip `chmod` when `process.platform === 'win32'` — rely on user profile directory ACLs
- Wrap in a helper: `setFilePermissions(path, mode)` that is a no-op on Windows

#### Line Endings
- All generated files (hook JSON, config files) use `\n` — not `os.EOL`
- Git attributes: `.gitattributes` with `* text=auto` in scaffold template

#### better-sqlite3 (Native Module)
- `better-sqlite3` ships prebuilt binaries for macOS (arm64, x64), Linux (x64), and Windows (x64)
- No special handling needed — npm install resolves the correct binary
- CI must test all three platforms to catch native module issues

### CLI Output
- Use `picocolors` (already in stack) — handles Windows terminal color support
- `@clack/prompts` supports Windows terminals
- Avoid Unicode symbols that don't render on Windows cmd.exe — use ASCII fallbacks:
  - `✓` → `√` or `[OK]` on Windows
  - `✗` → `x` or `[FAIL]` on Windows
  - Detection: `process.platform === 'win32' && !process.env.WT_SESSION` (Windows Terminal supports Unicode)

### CI/CD Test Matrix
```yaml
strategy:
  matrix:
    os: [macos-latest, ubuntu-latest, windows-latest]
    node: [20, 22]
```

All tests must pass on all matrix entries before merge.

## Consequences

### Positive
- RenRe Kit works for developers on any major platform
- Platform-specific bugs caught in CI before release
- Helper utilities centralize platform differences

### Negative
- Windows support adds testing surface and edge cases
- Some features may behave slightly differently on Windows (file permissions, signal handling)
- Native module (better-sqlite3) must be tested on all platforms

### Mitigations
- Platform abstraction helpers (`setFilePermissions`, `getPlatformSignals`) centralize platform branches
- CI matrix ensures all platforms are continuously tested
- Windows is secondary priority — known limitations documented rather than blocking release
