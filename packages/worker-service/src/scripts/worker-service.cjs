#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

// Agent event name normalization (ADR-026)
// Maps PascalCase event names from GitHub Copilot hook schema to internal camelCase
// Agent event name normalization: PascalCase (hook file) → camelCase (internal)
const EVENT_MAP = {
  SessionStart: "sessionStart",
  Stop: "sessionEnd",
  UserPromptSubmit: "userPromptSubmitted",
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  ErrorOccurred: "errorOccurred",
  PreCompact: "preCompact",
  SubagentStart: "subagentStart",
  SubagentStop: "subagentStop",
  // Already canonical (pass through)
  sessionStart: "sessionStart",
  sessionEnd: "sessionEnd",
  userPromptSubmitted: "userPromptSubmitted",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  errorOccurred: "errorOccurred",
  preCompact: "preCompact",
  subagentStart: "subagentStart",
  subagentStop: "subagentStop",
};

// Reverse map: camelCase → PascalCase hookEventName for stdout envelope
const EVENT_TO_HOOK_NAME = {
  sessionStart: "SessionStart",
  sessionEnd: "Stop",
  userPromptSubmitted: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  errorOccurred: "ErrorOccurred",
  preCompact: "PreCompact",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
};

// Fields that belong at the top level of hook stdout (common fields),
// not inside hookSpecificOutput. Per VS Code Agent hooks specification.
const COMMON_FIELDS = new Set(["continue", "stopReason", "systemMessage"]);

/**
 * Format feature output into the VS Code Agent hooks stdout envelope.
 * Common fields (continue, stopReason, systemMessage) stay at top level.
 * All other fields go inside hookSpecificOutput with hookEventName.
 */
function formatOutput(event, result) {
  if (!result || typeof result !== "object") return {};

  const common = {};
  const specific = {};

  for (const [key, value] of Object.entries(result)) {
    if (COMMON_FIELDS.has(key)) {
      common[key] = value;
    } else {
      specific[key] = value;
    }
  }

  const hookEventName = EVENT_TO_HOOK_NAME[event] || event;

  if (Object.keys(specific).length > 0) {
    common.hookSpecificOutput = { hookEventName, ...specific };
  }

  return common;
}


function readServerState() {
  const serverJson = path.join(os.homedir(), ".renre-kit", "server.json");
  if (!fs.existsSync(serverJson)) return null;
  try {
    return JSON.parse(fs.readFileSync(serverJson, "utf8"));
  } catch {
    return null;
  }
}

function matchProject(projects, cwd) {
  return projects.find((p) => cwd.startsWith(p.path));
}

function collectBody(res, onParsed) {
  let data = "";
  res.on("data", (chunk) => { data += chunk; });
  res.on("end", () => {
    try { onParsed(JSON.parse(data)); } catch { onParsed(null); }
  });
}

function findProjectId(cwd, port) {
  return new Promise((resolve) => {
    const options = {
      hostname: "127.0.0.1",
      port,
      path: "/api/projects",
      method: "GET",
    };
    const req = http.request(options, (res) => {
      collectBody(res, (projects) => {
        const match = projects ? matchProject(projects, cwd) : null;
        resolve(match ? match.id : null);
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function postEnqueue(port, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: "127.0.0.1",
      port,
      path: "/api/hooks/enqueue",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = http.request(options, (res) => {
      collectBody(res, resolve);
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  // args: hook <agent> <event> <feature>
  if (args[0] !== "hook" || args.length < 4) {
    process.exit(0);
  }

  const agent = args[1];
  const eventArg = args[2];
  const feature = args[3];

  // Read stdin (event context from AI agent)
  let input = {};
  try {
    const stdin = fs.readFileSync("/dev/stdin", "utf8");
    if (stdin.trim()) {
      input = JSON.parse(stdin);
    }
  } catch {
    // stdin not available or parse error — continue with empty input
  }

  const serverState = readServerState();
  if (!serverState) {
    // Worker not running — graceful degradation
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  const port = serverState.port;
  const cwd = process.cwd();
  const projectId = await findProjectId(cwd, port);

  if (!projectId) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  // Determine canonical event name (ADR-046):
  // 1. CLI argument (always present for generated hooks)
  // 2. stdin input.event (agent-provided, not guaranteed)
  // 3. Fallback: feature name itself (legacy/manual usage)
  const rawEvent = eventArg || input.event || feature;
  const event = EVENT_MAP[rawEvent] || rawEvent;

  // Compute batch ID: SHA-256(event + timestamp + cwd) truncated to 16 chars
  const ts = String(input.timestamp || Date.now());
  const batchId = crypto
    .createHash("sha256")
    .update(event + ts + cwd)
    .digest("hex")
    .slice(0, 16);

  const response = await postEnqueue(port, {
    batchId,
    feature,
    event,
    projectId,
    agent,
    input,
  });

  if (!response) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  // Write response to stdout in VS Code Agent hooks envelope format
  process.stdout.write(JSON.stringify(formatOutput(event, response.result ?? {})));
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
});
