import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Plus, Trash2, Edit2, Shield } from "lucide-react";
import { useToolRulesStore, type ToolRule, type AuditEntry } from "../stores/tool-rules-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { BadgeDecision } from "../components/intelligence/shared/Badges";
import { TimeAgo } from "../components/intelligence/shared/TimeAgo";
import { cn } from "../lib/utils";

type Tab = "rules" | "audit";
type PatternType = "regex" | "contains" | "glob";
type Decision = "deny" | "ask" | "allow";

function testPattern(pattern: string, patternType: PatternType, input: string): boolean {
  if (!pattern || !input) return false;
  try {
    if (patternType === "regex") {
      return new RegExp(pattern).test(input);
    }
    if (patternType === "contains") {
      return input.includes(pattern);
    }
    if (patternType === "glob") {
      const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      return new RegExp(`^${regexStr}$`).test(input);
    }
  } catch {
    // invalid regex
  }
  return false;
}

function getSaveLabel(saving: boolean, isEdit: boolean): string {
  if (saving) return "Saving...";
  return isEdit ? "Update" : "Create";
}

interface RuleDialogProps {
  projectId: string;
  rule?: ToolRule;
  onClose: () => void;
}

function RuleDialog({ projectId, rule, onClose }: RuleDialogProps) {
  const { createRule, updateRule } = useToolRulesStore();
  const [name, setName] = useState(rule?.name ?? "");
  const [toolType, setToolType] = useState(rule?.toolType ?? "");
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [patternType, setPatternType] = useState<PatternType>(rule?.patternType ?? "contains");
  const [decision, setDecision] = useState<Decision>(rule?.decision ?? "ask");
  const [reason, setReason] = useState(rule?.reason ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? 50);
  const [scope, setScope] = useState<"global" | "project">(rule?.scope ?? "project");
  const [testInput, setTestInput] = useState("");
  const [saving, setSaving] = useState(false);

  const matches = testInput ? testPattern(pattern, patternType, testInput) : null;

  async function handleSave() {
    setSaving(true);
    const data: Partial<ToolRule> = { name, toolType, pattern, patternType, decision, priority, scope };
    if (reason) data.reason = reason;
    if (rule) {
      await updateRule(projectId, rule.id, data);
    } else {
      await createRule(projectId, data);
    }
    setSaving(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rule-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl p-6 overflow-y-auto max-h-[90vh]">
        <h2 id="rule-dialog-title" className="text-base font-semibold mb-4">
          {rule ? "Edit Rule" : "Add Rule"}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tool Type</label>
              <input
                value={toolType}
                onChange={(e) => setToolType(e.target.value)}
                placeholder="e.g. bash, edit, view"
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                min={1}
                max={100}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Pattern</label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Pattern Type</label>
            <div className="flex gap-4">
              {(["contains", "regex", "glob"] as PatternType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={patternType === t}
                    onChange={() => setPatternType(t)}
                    className="accent-primary"
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Decision</label>
            <div className="flex gap-4">
              {(["deny", "ask", "allow"] as Decision[]).map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={decision === d}
                    onChange={() => setDecision(d)}
                    className="accent-primary"
                  />
                  <BadgeDecision decision={d} />
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Reason (optional)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why does this rule exist?"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Scope</label>
            <div className="flex gap-4">
              {(["project", "global"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={scope === s}
                    onChange={() => setScope(s)}
                    className="accent-primary"
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          {/* Pattern preview */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Test Pattern
            </label>
            <input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Enter text to test pattern..."
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {testInput && (
              <p
                className={cn(
                  "mt-1 text-xs font-medium",
                  matches ? "text-green-600" : "text-red-500"
                )}
              >
                {matches ? "Match" : "No match"}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name || !pattern || saving}
            onClick={() => void handleSave()}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {getSaveLabel(saving, !!rule)}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToolGovernanceContentProps {
  loading: boolean;
  error: string | null;
  tab: Tab;
  sortedRules: ToolRule[];
  auditLog: AuditEntry[];
  projectId: string;
  updateRule: (projectId: string, id: string, data: Partial<ToolRule>) => Promise<void>;
  deleteRule: (projectId: string, id: string) => Promise<void>;
  setEditRule: (rule: ToolRule) => void;
}

function RulesTab({
  sortedRules,
  projectId,
  updateRule,
  deleteRule,
  setEditRule,
}: {
  sortedRules: ToolRule[];
  projectId: string;
  updateRule: (projectId: string, id: string, data: Partial<ToolRule>) => Promise<void>;
  deleteRule: (projectId: string, id: string) => Promise<void>;
  setEditRule: (rule: ToolRule) => void;
}) {
  if (sortedRules.length === 0) {
    return (
      <EmptyState
        title="No rules"
        description="Add tool governance rules to control agent behavior."
        icon={<Shield className="h-8 w-8" />}
      />
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {sortedRules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
          <BadgeDecision decision={rule.decision} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{rule.name}</span>
              <span className="text-xs text-muted-foreground">{rule.toolType}</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                {rule.pattern}
              </code>
              <span className="text-xs text-muted-foreground">({rule.patternType})</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">
                priority {rule.priority}
              </span>
              <span className="text-xs text-muted-foreground">{rule.scope}</span>
              <span className="text-xs text-muted-foreground">
                {rule.hitCount} hits
              </span>
              {rule.reason && (
                <span className="text-xs text-muted-foreground truncate max-w-48">
                  &ldquo;{rule.reason}&rdquo;
                </span>
              )}
              {rule.isBuiltin && (
                <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1 rounded">
                  builtin
                </span>
              )}
            </div>
          </div>
          <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) =>
                updateRule(projectId, rule.id, { enabled: e.target.checked }).catch(() => {})
              }
              className="accent-primary"
            />
            <span className="text-xs text-muted-foreground">Enabled</span>
          </label>
          <button
            type="button"
            onClick={() => setEditRule(rule)}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          {!rule.isBuiltin && (
            <button
              type="button"
              onClick={() => deleteRule(projectId, rule.id).catch(() => {})}
              className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditTab({ auditLog }: { auditLog: AuditEntry[] }) {
  if (auditLog.length === 0) {
    return (
      <EmptyState title="No audit entries" description="Tool governance decisions will appear here." />
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground grid grid-cols-5 gap-3">
        <span>Time</span>
        <span>Tool</span>
        <span>Decision</span>
        <span>Rule</span>
        <span>Input (preview)</span>
      </div>
      <div className="divide-y divide-border">
        {auditLog.map((entry) => (
          <div key={entry.id} className="px-4 py-2 grid grid-cols-5 gap-3 text-xs">
            <span className="text-muted-foreground">
              <TimeAgo timestamp={entry.createdAt} />
            </span>
            <span className="font-mono truncate">{entry.toolName}</span>
            <BadgeDecision decision={entry.decision as Decision} />
            <span className="text-muted-foreground truncate">
              {entry.ruleId ?? "—"}
            </span>
            <span className="text-muted-foreground truncate font-mono">
              {entry.toolInput.slice(0, 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolGovernanceContent({
  loading,
  error,
  tab,
  sortedRules,
  auditLog,
  projectId,
  updateRule,
  deleteRule,
  setEditRule,
}: ToolGovernanceContentProps) {
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (tab === "rules") {
    return (
      <RulesTab
        sortedRules={sortedRules}
        projectId={projectId}
        updateRule={updateRule}
        deleteRule={deleteRule}
        setEditRule={setEditRule}
      />
    );
  }
  return <AuditTab auditLog={auditLog} />;
}

export default function ToolGovernancePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { rules, auditLog, loading, error, fetchRules, fetchAuditLog, updateRule, deleteRule } =
    useToolRulesStore();
  const [tab, setTab] = useState<Tab>("rules");
  const [showAdd, setShowAdd] = useState(false);
  const [editRule, setEditRule] = useState<ToolRule | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchRules(projectId).catch(() => {});
    fetchAuditLog(projectId).catch(() => {});
  }, [projectId, fetchRules, fetchAuditLog]);

  if (!projectId) return null;

  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Tool Governance"
        description="Rules that control which tools AI agents can use"
        breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Tool Governance" }]}
        actions={
          tab === "rules" ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Rule
            </button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
        {(["rules", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "rules" ? "Rules" : "Audit Log"}
          </button>
        ))}
      </div>

      <ToolGovernanceContent
        loading={loading}
        error={error}
        tab={tab}
        sortedRules={sortedRules}
        auditLog={auditLog}
        projectId={projectId}
        updateRule={updateRule}
        deleteRule={deleteRule}
        setEditRule={setEditRule}
      />

      {showAdd && (
        <RuleDialog
          projectId={projectId}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editRule && (
        <RuleDialog
          projectId={projectId}
          rule={editRule}
          onClose={() => setEditRule(null)}
        />
      )}
    </div>
  );
}
