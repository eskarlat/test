# DFD — Server Lifecycle Flow

## Description
Data flow for server start, project registration, and server stop.

---

## Server Start (`renre-kit start`)

```mermaid
flowchart TD
    Dev["Developer"] -->|"renre-kit start"| CLI["CLI: Start Handler"]

    CLI -->|"Check server.pid"| PID["~/.renre-kit/server.pid"]
    PID -->|"Not found / stale"| StartServer["Spawn Worker Service Process"]
    PID -->|"Running"| SkipStart["Skip server start"]

    StartServer -->|"Write PID"| PID
    StartServer -->|"Initialize Express + SQLite"| Worker["Worker Service :42888"]

    CLI -->|"Derive project-id from .renre-kit/"| ProjConfig[".renre-kit/extensions.json"]
    CLI -->|"Register project"| ServerState["~/.renre-kit/server.json (active projects)"]
    CLI -->|"POST /api/projects/register"| Worker

    Worker -->|"Read extensions.json"| ProjConfig
    Worker -->|"Load extension routers"| ExtRegistry["Extension Registry"]
    ExtRegistry -->|"Run migrations"| DB["SQLite DB"]

    CLI -->|"Open browser localhost:42888"| Dev
```

---

## Server Stop (`renre-kit stop`)

```mermaid
flowchart TD
    Dev["Developer"] -->|"renre-kit stop"| CLI["CLI: Stop Handler"]

    CLI -->|"POST /api/projects/unregister"| Worker["Worker Service"]
    Worker -->|"Unmount project extensions"| ExtRegistry["Extension Registry"]
    CLI -->|"Remove from active projects"| ServerState["~/.renre-kit/server.json"]

    CLI -->|"Check remaining active projects"| ServerState
    ServerState -->|"No active projects"| Shutdown["Send SIGTERM to server"]
    ServerState -->|"Other projects active"| KeepRunning["Server stays running"]

    Shutdown -->|"Remove PID file"| PID["~/.renre-kit/server.pid"]
```

---

## Data Stores
| Store | Purpose |
|-------|---------|
| `~/.renre-kit/server.pid` | Tracks server process PID |
| `~/.renre-kit/server.json` | List of active project registrations |
| `.renre-kit/extensions.json` | Project's installed extensions |
| SQLite DB | Extension data (migrated on mount) |
