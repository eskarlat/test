# Phase 5 — Vault Core

## Goal
Implement the global Vault for secret management: encrypted storage in SQLite, `${VAULT:key}` resolution, internal API routes for Console UI, and extension settings resolver.

## Reference
- ADR-009: Vault as Core Feature + Extension Settings
- ADR-014: Settings Hot-Reload via Remount
- C4 Code: VaultResolver, ExtensionSettingsResolver

## Dependencies
- Phase 3 (worker service core — SQLite)
- Phase 4 (extension system — ExtensionContext)

## Tasks

### 5.1 Vault table & encryption
- [ ] Create `_vault` table: `key TEXT PRIMARY KEY, encrypted_value BLOB, iv TEXT, created_at TEXT, updated_at TEXT` (matches Phase 3.4 schema — no conflict)
- [ ] Encrypt values before writing using **AES-256-GCM** with a **unique IV (nonce) per secret entry** (ADR-009)
- [ ] Key derivation: **PBKDF2 with 100,000 iterations** using `os.hostname()` + `os.userInfo().username` + hardware UUID (where available via `os.machineId()` or platform-specific lookup) as salt input (ADR-009)
- [ ] Store IV alongside ciphertext in `iv` column (required for AES-GCM decryption)
- [ ] Decrypt on read (in-memory only, never write plaintext)
- [ ] Future: support optional master password as additional KDF input for stronger security
- [ ] Future: key re-encryption command for machine identity changes (hostname/username change recovery)

### 5.2 VaultResolver
- [ ] `getSecret(key)` — decrypt and return value (internal only)
- [ ] `setSecret(key, value)` — encrypt and store
- [ ] `deleteSecret(key)` — remove from table
- [ ] `listSecretKeys()` — return keys only, never values
- [ ] `resolve(config, settingsSchema)` — resolve `${VAULT:key}` patterns **only in settings declared as `type: "vault"` in the manifest schema** (ADR-009). Non-vault-type settings are used as literal values — `${VAULT:...}` text in `string`/`number`/`boolean`/`select` fields is treated as plain text, never resolved. This prevents Vault injection attacks.
- [ ] Cross-check resolved Vault key names against the extension's `permissions.vault` list (ADR-017). If a vault-type setting references a key not in `permissions.vault` → mount fails with: `"Extension 'X' references Vault key 'Y' but does not declare it in permissions.vault"`

### 5.3 Vault internal API routes
- [ ] `GET /api/vault/keys` — list all secret key names (no values)
- [ ] `POST /api/vault/secrets` — create/update secret `{ key, value }`
- [ ] `DELETE /api/vault/secrets/:key` — delete secret
- [ ] Middleware: these routes are internal-only (not accessible via extension context)

### 5.4 Extension Settings Resolver
- [ ] Read extension settings from `.renre-kit/extensions.json` for a project
- [ ] Read settings schema from extension manifest
- [ ] Support 5 setting types (ADR-009): `string`, `vault`, `number`, `boolean`, `select`
  - Type-specific validation: `number` validates numeric, `boolean` validates boolean, `select` validates value is in `options` array
  - `vault` type: resolve `${VAULT:key}` pattern, support listing available vault keys for picker UI
  - `select` type: manifest specifies `options: string[]`
- [ ] Validate required fields are present
- [ ] Activation gate: required fields must be filled BEFORE extension can activate. Mount fails with clear error listing missing required settings (ADR-009)
- [ ] Resolve `${VAULT:key}` references via VaultResolver
- [ ] Return resolved settings as `Record<string, string>`
- [ ] Error on missing required settings or unresolvable Vault references
- [ ] Injection targets (ADR-009):
  - stdio MCP: resolved values injected as process environment variables
  - SSE MCP: resolved values injected as headers/URL template values
  - Hooks: resolved values injected as hook command environment variables
- [ ] Schema migration on upgrade: additive schema — new optional fields don't break existing configs. Merge new schema with existing values, warn on new required fields without values

### 5.5 Settings API routes
- [ ] `GET /api/{pid}/extensions/{name}/settings` — get settings + schema
- [ ] `PUT /api/{pid}/extensions/{name}/settings` — save settings, trigger remount

### 5.6 Settings hot-reload (remount)
- [ ] On settings save: unmount extension → resolve new settings → mount extension
- [ ] Return 503 with `Retry-After: 3` header for in-flight requests during remount (ADR-014)
- [ ] Emit SSE event `extension:remounted` (placeholder for Phase 14)

### 5.7 Console UI cross-reference
> Vault toolbar behavior (accessible from toolbar icon, masked values as `--------`, search/filter by key, edit requires re-entry with no reveal, delete with confirmation) is implemented in Phase 12 vault page. Ensure traceability.

### 5.8 Future: CLI vault command (deferred)
> `renre-kit vault set KEY VALUE` for headless environments (ADR-009 mitigation). Not in current scope.

### 5.9 Future: audit & rotation (deferred)
> Secret rotation policies and audit log (ADR-009 mitigation). Consider adding `last_rotated_at` column to `_vault` table and audit event emission for future implementation.

## Verification
```bash
# Set a secret
curl -X POST http://localhost:42888/api/vault/secrets \
  -H "Content-Type: application/json" \
  -d '{"key":"test_token","value":"secret123"}'

# List keys (value should NOT be returned)
curl http://localhost:42888/api/vault/keys
# → ["test_token"]

# Delete secret
curl -X DELETE http://localhost:42888/api/vault/secrets/test_token

# Verify encryption in DB
sqlite3 ~/.renre-kit/data.db "SELECT value FROM _vault WHERE key='test_token'"
# → should be encrypted blob, NOT plaintext
```

## Files Created
```
packages/worker-service/src/core/vault-resolver.ts
packages/worker-service/src/core/settings-resolver.ts
packages/worker-service/src/core/encryption.ts
packages/worker-service/src/routes/vault.ts
```
