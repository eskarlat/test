# Phase 13 — Console Marketplace UI

## Goal
Implement the full marketplace experience in the Console UI: browse extensions, multi-step install dialog with permissions review, extension settings page with Vault key picker, remove/upgrade actions.

## Reference
- ADR-025: Console Marketplace UI
- ADR-017: Extension Permissions
- ADR-009: Vault & Extension Settings
- ADR-014: Settings Hot-Reload

## Dependencies
- Phase 11 (Console UI shell)
- Phase 7 (Marketplace — install/remove/upgrade APIs)
- Phase 5 (Vault — keys API, secret creation)

## Tasks

### 13.1 Extension Manager page (`/extensions`)
- [ ] Tab layout: "Installed" tab + "Marketplace" tab
- [ ] Tab state persisted in URL search params

### 13.2 Installed tab
- [ ] List installed extensions for active project
- [ ] Each card: name, version, status badge, MCP info, marketplace source
- [ ] Action buttons: Settings, Disable, Remove, Upgrade (if update available)
- [ ] Disable action: calls `POST /api/projects/{id}/extensions/{name}/disable`, updates UI state, shows "Disabled" badge
- [ ] "Needs setup" warning with link to settings
- [ ] Remove action: confirmation dialog → `DELETE /api/{pid}/extensions/{name}`
- [ ] Upgrade action: `POST /api/{pid}/extensions/{name}/upgrade`

### 13.3 Marketplace tab
- [ ] Fetch extensions from `GET /api/marketplace`
- [ ] Search input: filter by name/description/tags
- [ ] Marketplace filter dropdown (All, or specific registered marketplace)
- [ ] Extension cards: name, version, marketplace source, description, tags, author, permissions summary
  > Note: ADR-025 wireframes show ratings/download counts, but ADR-005 states "No download counts or ratings" in GitHub-based model. Do not include ratings/downloads.
- [ ] "Installed" badge on already-installed extensions
- [ ] "Install" button opens install dialog

### 13.4 Install dialog (3-step modal)
- [ ] **Step 1 — Review Permissions**: list permissions from manifest (database, network, mcp, hooks, vault, filesystem). Accept/Cancel
- [ ] **Step 2 — Configure Settings**: auto-generated form from `settings.schema`. Vault-type fields use Vault Key Picker. Skip if no settings
- [ ] One-click install: if extension has no required settings, collapse 3-step flow to single confirmation click (ADR-025)
- [ ] **Step 3 — Confirm**: summary of extension, permissions, settings, what will happen. Install button
- [ ] On install: `POST /api/{pid}/extensions/install` with name, version, marketplace, settings
- [ ] Loading state during installation
- [ ] Success: close dialog, show toast, sidebar updates via SSE
- [ ] Failure: show error message, allow retry

### 13.5 Extension Settings page
- [ ] Route: accessible from "Settings" button or sidebar ⓘ icon
- [ ] Auto-generate form from `settings.schema` in manifest
- [ ] Field types: text input (string), Vault Key Picker (vault), number input (number), toggle (boolean), select dropdown (select)
- [ ] Required fields marked with asterisk
- [ ] Vault-type fields: dropdown of existing vault keys + "Create new" option
- [ ] Remount warning: "Saving will remount the extension (~1-3 sec)"
- [ ] Save: `PUT /api/{pid}/extensions/{name}/settings` (triggers remount)
- [ ] Show current permissions summary (read-only)
- [ ] Extension info: version, source, author, install date

### 13.6 Vault Key Picker component
- [ ] Dropdown listing existing vault keys from `GET /api/vault/keys`
- [ ] Selected key shown as badge
- [ ] "Create new secret" expandable section:
  - Key name input
  - Value input (password field)
  - "Save to Vault & Select" button → `POST /api/vault/secrets`
- [ ] After creation: auto-select the new key
- [ ] Reusable component for install dialog + settings page

### 13.7 Worker API additions
- [ ] `GET /api/marketplace` — fetch and merge extension lists from all marketplaces (reuse marketplace client from Phase 7)
- [ ] `GET /api/marketplace/search?q=term` — filtered search across marketplaces
- [ ] `POST /api/{pid}/extensions/install` — full install flow (download, validate, configure, mount)
- [ ] `DELETE /api/{pid}/extensions/{name}` — full remove flow (unmount, rollback, cleanup)
- [ ] `POST /api/{pid}/extensions/{name}/upgrade` — upgrade to latest or specified version
- [ ] `GET /api/{pid}/extensions/{name}/settings` — read extension settings + schema
- [ ] `PUT /api/{pid}/extensions/{name}/settings` — save extension settings (triggers remount)
- [ ] `GET /api/vault/keys` — list vault key names (for picker dropdown, may exist from Phase 5)
- [ ] `POST /api/vault/secrets` — create vault secret inline (may exist from Phase 5)
> Note: Phase 7 uses `POST .../extensions/reload` (CLI-driven, worker just mounts). Phase 13 uses `POST .../extensions/install` (UI-driven, worker handles full download+mount). Both endpoints coexist.

### 13.8 Keyboard shortcuts (ADR-025 mitigation)
- [ ] Enter to accept defaults and advance through install steps
- [ ] Tab navigation between form fields
- [ ] Escape to close dialog

### 13.9 SSE event handling
- [ ] Worker emits `extension:installed` SSE event after installation — UI refreshes sidebar + shows success toast
- [ ] Worker emits `extension:removed`, `extension:disabled`, `extension:enabled` events — UI updates accordingly

## Verification
```bash
# Start server with registered project
renre-kit start
open http://localhost:42888

# Navigate to Extension Manager

# Installed tab:
# - Shows installed extensions with status
# - Settings button opens settings form
# - Remove button with confirmation

# Marketplace tab:
# - Browse extensions from registered marketplaces
# - Search by name
# - Click Install → 3-step dialog
# - Step 1: Review permissions
# - Step 2: Configure settings (with Vault Key Picker)
# - Step 3: Confirm and install

# After install:
# - Extension appears in sidebar
# - Toast notification
# - Extension routes accessible

# Settings page:
# - Auto-generated form
# - Vault picker for secret fields
# - Save triggers remount
```

## Files Created
```
packages/console-ui/src/
  routes/
    extensions.tsx                    # Extension Manager (tabs)
  components/
    marketplace/
      InstalledTab.tsx
      MarketplaceTab.tsx
      ExtensionCard.tsx
      InstallDialog.tsx
      PermissionReview.tsx
      SettingsForm.tsx
      ConfirmInstall.tsx
      ExtensionSettingsPage.tsx
      VaultKeyPicker.tsx
      UpgradeDialog.tsx
      RemoveDialog.tsx

packages/worker-service/src/
  routes/marketplace.ts              # Marketplace browse/search/install routes
```
