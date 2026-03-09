# ADR-020: Manifest Validation on Extension Install

## Status
Accepted

## Context
Extensions are downloaded from external sources (marketplace repos, local paths). A broken or malformed extension could crash the worker service or leave the project in a bad state. We need to validate extensions before they are installed.

## Decision

### Validation runs at install time
When `renre-kit marketplace add` downloads an extension, the CLI validates the package before writing to `extensions.json` or copying hooks/skills. If validation fails, the install is aborted and the downloaded files are cleaned up.

### Validation Rules

#### Required (install fails if missing)
| Check | Rule |
|-------|------|
| `manifest.json` exists | File must be present and valid JSON |
| Required fields | `name`, `version`, `displayName`, `description`, `author` |
| Name format | Lowercase, alphanumeric, hyphens only (`/^[a-z0-9-]+$/`) |
| Version format | Valid semver |

#### Conditional (checked only if declared in manifest)
| Manifest Field | Validation |
|---------------|------------|
| `backend.entrypoint` | File exists (e.g., `backend/index.js`) |
| `backend.actions` | Each action has `name`, `method`, `description` |
| `ui.bundle` | File exists (e.g., `ui/index.js`) |
| `ui.pages` | Each page has `id`, `title`, `path`; paths are unique |
| `migrations` | Directory exists; files follow `NNN_desc.up.sql` / `NNN_desc.down.sql` naming; every `.up.sql` has a matching `.down.sql` |
| `mcp` | If `transport: "stdio"` → `command` and `args` present; if `transport: "sse"` → `url` present |
| `permissions` | All keys are known permission types |
| `settings.schema` | Each setting has `key`, `label`, `type`; types are valid (`string`, `vault`, `number`, `boolean`, `select`); `select` type has `options` |
| `hooks` | Valid hook config structure (version, event keys) |
| `skills` | Each declared skill has a `SKILL.md` file |

### Validation Output

**Success:**
```
Validating jira-plugin@1.0.0... ✓
  manifest.json     ✓
  backend           ✓ (backend/index.js)
  ui                ✓ (ui/index.js, 2 pages)
  migrations        ✓ (3 up/down pairs)
  permissions       ✓
  settings          ✓ (4 fields)
```

**Failure:**
```
Validating jira-plugin@1.0.0... ✗

Errors:
  ✗ manifest.json: missing required field "author"
  ✗ migrations: 002_add_column.up.sql has no matching .down.sql
  ✗ ui.pages: duplicate path "issues" in pages[0] and pages[2]

Installation aborted. Fix the errors above and try again.
```

### When Validation Runs

| Event | Validates |
|-------|-----------|
| `marketplace add` | Full validation before install |
| `marketplace upgrade` | Full validation of new version before upgrade |
| `marketplace add --local` | Full validation of local extension |
| `renre-kit start` | Quick check — manifest exists and is parseable (no deep file checks) |

### CLI Validate Command (for extension authors)
```bash
# Run validation on a local extension directory during development
renre-kit extension validate /path/to/my-extension
```

This runs the same validation as `marketplace add` — useful for extension authors to check their package before publishing.

## Consequences

### Positive
- Broken extensions never make it into the project
- Clear error messages help extension authors fix issues
- Migration pairing enforced — no orphaned up/down files
- `extension validate` enables pre-publish testing

### Negative
- Validation adds time to install (typically <1 second)
- Strict rules may frustrate extension authors with edge cases

### Mitigations
- Validation is fast — mostly file existence and JSON parsing
- Error messages are specific and actionable
- SDK scaffolding generates valid manifest structure by default
