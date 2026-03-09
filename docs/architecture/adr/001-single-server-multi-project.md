# ADR-001: Single Server Serving Multiple Projects

## Status
Accepted

## Context
Developers often work on multiple projects simultaneously. We need to decide whether each project gets its own worker service instance (separate port) or a single server handles all active projects.

Multiple servers would mean managing multiple ports, more memory usage, and complexity in the CLI to track which port maps to which project. A single server simplifies the developer experience — one URL, one process.

## Decision
**One Express worker service on port 42888 serves all active projects.** Routes are namespaced by project ID: `/api/{project-id}/{extension}/{action}`. The Console UI includes a project switcher dropdown to navigate between active projects.

## Consequences

### Positive
- Single URL to remember (`localhost:42888`)
- Lower memory footprint — one Node.js process
- Simpler server lifecycle management (one PID file)
- Easy project switching in UI without opening new tabs

### Negative
- Extension isolation is weaker — a badly behaved extension can affect all projects
- Must carefully namespace all routes and DB queries by project ID
- Server restart affects all active projects

### Mitigations
- Extension routes are mounted per-project with strict namespacing
- All DB queries require project_id parameter
- Future: consider worker threads per project if isolation becomes critical
