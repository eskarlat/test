import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";
import { Plus, Eye, EyeOff, Trash2, Edit2, Archive, AlertTriangle, Loader2, X } from "lucide-react";
import { useObservationStore, type Observation } from "../stores/observation-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { cn } from "../lib/utils";

const CATEGORIES = ["general", "behavior", "preference", "error", "workflow", "style"] as const;

interface AddObservationDialogProps {
  projectId: string;
  onClose: () => void;
}

function AddObservationDialog({ projectId, onClose }: AddObservationDialogProps) {
  const { createObservation } = useObservationStore();
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    await createObservation(projectId, { content: content.trim(), category });
    setSaving(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-obs-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl p-6">
        <h2 id="add-obs-title" className="text-base font-semibold mb-4">Add Observation</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="Describe an observation about this project or agent behavior..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
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
            disabled={!content.trim() || saving}
            onClick={() => void handleSave()}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteObservationDialog({
  deleting,
  onConfirm,
  onClose,
}: {
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onClose();
      if (e.key === "Enter" && !deleting) onConfirm();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onConfirm, deleting]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-obs-title"
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" aria-hidden="true" />
            <h2 id="delete-obs-title" className="text-base font-semibold text-foreground">
              Delete observation?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently remove the observation. This action cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface ObservationItemProps {
  obs: Observation;
  projectId: string;
}

function ObservationItem({ obs, projectId }: ObservationItemProps) {
  const { updateObservation, deleteObservation } = useObservationStore();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(obs.content);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await deleteObservation(projectId, obs.id).catch(() => {});
    setDeleting(false);
    setShowDeleteDialog(false);
  }

  async function handleSaveEdit() {
    await updateObservation(projectId, obs.id, { content: editContent });
    setEditing(false);
  }

  return (
    <div className="px-4 py-3 flex gap-3">
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={3}
              className="w-full px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setEditContent(obs.content); }}
                className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground">{obs.content}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">{obs.source}</span>
          <span className="text-xs text-muted-foreground">
            confidence: {(obs.confidence * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-muted-foreground">
            injected {obs.injectionCount}x
          </span>
        </div>
      </div>
      <div className="flex items-start gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Edit"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => updateObservation(projectId, obs.id, { active: !obs.active }).catch(() => {})}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title={!obs.active ? "Unarchive" : "Archive"}
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowDeleteDialog(true)}
          className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {showDeleteDialog && (
        <DeleteObservationDialog
          deleting={deleting}
          onConfirm={() => void handleDelete()}
          onClose={() => { if (!deleting) setShowDeleteDialog(false); }}
        />
      )}
    </div>
  );
}

function ObservationsContent({
  loading,
  error,
  active,
  search,
  grouped,
  projectId,
  onShowAdd,
}: {
  loading: boolean;
  error: string | null;
  active: Observation[];
  search: string;
  grouped: Record<string, Observation[]>;
  projectId: string;
  onShowAdd: () => void;
}) {
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading observations...</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (active.length === 0 && !search) {
    return (
      <EmptyState
        title="No observations"
        description="Add observations to give persistent context to agent sessions."
        action={
          <button
            type="button"
            onClick={onShowAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add first observation
          </button>
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([cat, items]) => (
        <CategoryGroup key={cat} category={cat} items={items} projectId={projectId} />
      ))}
      {active.length === 0 && search && (
        <p className="text-sm text-muted-foreground py-4">
          No observations match &ldquo;{search}&rdquo;
        </p>
      )}
    </div>
  );
}

export default function ObservationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { observations, loading, error, filter, fetchObservations, setFilter } =
    useObservationStore();
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!projectId) return;
    fetchObservations(projectId).catch(() => {});
  }, [projectId, fetchObservations]);

  if (!projectId) return null;

  const suggested = observations.filter((o) => o.active && o.confidence < 0.5);
  const active = observations.filter(
    (o) =>
      o.active &&
      (!search || o.content.toLowerCase().includes(search.toLowerCase())) &&
      (!filter.category || o.category === filter.category) &&
      (!filter.source || o.source === filter.source)
  );
  const archived = observations.filter(
    (o) =>
      !o.active &&
      (!search || o.content.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped = CATEGORIES.reduce<Record<string, Observation[]>>((acc, cat) => {
    const items = active.filter((o) => o.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Observations"
        description="Persistent context injected into agent sessions"
        breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Observations" }]}
        actions={
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Observation
          </button>
        }
      />

      {/* Suggested banner */}
      {suggested.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-yellow-800 dark:text-yellow-200">
            {suggested.length} suggested observation{suggested.length !== 1 ? "s" : ""} with low
            confidence — review and confirm
          </span>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 hover:opacity-80 transition-opacity"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search observations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={filter.category ?? ""}
          onChange={(e) => setFilter({ category: e.target.value || undefined })}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <ObservationsContent
        loading={loading}
        error={error}
        active={active}
        search={search}
        grouped={grouped}
        projectId={projectId}
        onShowAdd={() => setShowAdd(true)}
      />

      {/* Archived section */}
      {archived.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showArchived ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 divide-y divide-border opacity-70">
              {archived.map((obs) => (
                <ObservationItem key={obs.id} obs={obs} projectId={projectId} />
              ))}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddObservationDialog
          projectId={projectId}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

function CategoryGroup({
  category,
  items,
  projectId,
}: {
  category: string;
  items: Observation[];
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between px-4 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
        )}
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide capitalize">
          {category}
        </span>
        <span className="text-xs text-muted-foreground">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </button>
      {expanded && (
        <div className="divide-y divide-border">
          {items.map((obs) => (
            <ObservationItem key={obs.id} obs={obs} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
