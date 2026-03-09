import { useState } from "react";
import { ListChecks, Send, Check } from "lucide-react";
import { useChatStore } from "../../stores/chat-store";
import type { ElicitationRequest } from "../../types/chat";

interface ChatElicitationDialogProps {
  request: ElicitationRequest;
}

interface SchemaProperty {
  type?: string;
  enum?: string[];
  description?: string;
  default?: unknown;
}

function getInitialValues(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, SchemaProperty>;
  const values: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(properties)) {
    if (prop.default !== undefined) {
      values[key] = prop.default;
    } else if (prop.enum && prop.enum.length > 0) {
      values[key] = prop.enum[0];
    } else if (prop.type === "array") {
      values[key] = [];
    } else if (prop.type === "boolean") {
      values[key] = false;
    } else if (prop.type === "number") {
      values[key] = 0;
    } else {
      values[key] = "";
    }
  }

  return values;
}

interface FieldProps {
  name: string;
  prop: SchemaProperty;
  value: unknown;
  disabled: boolean;
  onChange: (name: string, value: unknown) => void;
}

const INPUT_CLASS = "w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";

function EnumField({ name, prop, value, disabled, onChange }: FieldProps) {
  return (
    <select
      value={String(value ?? "")}
      onChange={(e) => onChange(name, e.target.value)}
      disabled={disabled}
      className={INPUT_CLASS}
    >
      {prop.enum!.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function BooleanField({ name, prop, value, disabled, onChange }: FieldProps) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(name, e.target.checked)}
        disabled={disabled}
        className="rounded border-border text-primary focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <span className="text-muted-foreground">{prop.description ?? name}</span>
    </label>
  );
}

function NumberField({ name, value, disabled, onChange }: FieldProps) {
  return (
    <input
      type="number"
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(name, e.target.value === "" ? 0 : Number(e.target.value))}
      disabled={disabled}
      className={INPUT_CLASS}
    />
  );
}

function TextField({ name, prop, value, disabled, onChange }: FieldProps) {
  return (
    <input
      type="text"
      value={String(value ?? "")}
      onChange={(e) => onChange(name, e.target.value)}
      disabled={disabled}
      placeholder={prop.description ?? `Enter ${name}`}
      className={`${INPUT_CLASS} placeholder:text-muted-foreground`}
    />
  );
}

function ArrayField({ name, prop, value, disabled, onChange }: FieldProps) {
  const items = (prop as { items?: { enum?: string[] } }).items;
  const options = items?.enum ?? [];
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggleOption(opt: string): void {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(name, next);
  }

  if (options.length === 0) return <TextField name={name} prop={prop} value={String(value ?? "")} disabled={disabled} onChange={onChange} />;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <label key={opt} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(opt)}
            onChange={() => toggleOption(opt)}
            disabled={disabled}
            className="rounded border-border text-primary focus:ring-ring disabled:opacity-50"
          />
          <span className="text-muted-foreground">{opt}</span>
        </label>
      ))}
    </div>
  );
}

function FieldInput(props: FieldProps) {
  if (props.prop.enum && props.prop.enum.length > 0) return <EnumField {...props} />;
  if (props.prop.type === "array") return <ArrayField {...props} />;
  if (props.prop.type === "boolean") return <BooleanField {...props} />;
  if (props.prop.type === "number") return <NumberField {...props} />;
  return <TextField {...props} />;
}

export function ChatElicitationDialog({ request }: ChatElicitationDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    getInitialValues(request.schema),
  );
  const [submitted, setSubmitted] = useState(false);

  const properties = (request.schema.properties ?? {}) as Record<string, SchemaProperty>;
  const required = (request.schema.required ?? []) as string[];
  const entries = Object.entries(properties);

  function handleChange(name: string, value: unknown): void {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(): void {
    if (submitted) return;
    setSubmitted(true);
    useChatStore.getState().respondToElicitation(request.requestId, values);
  }

  return (
    <div className="my-2 rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        <ListChecks className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Input Required
        </span>
        {submitted && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
            <Check className="h-3 w-3" /> Submitted
          </span>
        )}
      </div>

      {/* Message */}
      {request.message && (
        <div className="px-4 py-3 border-b border-border">
          <div className="text-sm">{request.message}</div>
        </div>
      )}

      {/* Form fields */}
      <div className="px-4 py-3 space-y-4">
        {entries.map(([key, prop]) => (
          <div key={key} className="space-y-1.5">
            {/* Label (skip for boolean since it's inline) */}
            {prop.type !== "boolean" && (
              <label className="block text-xs font-medium text-foreground">
                {key}
                {required.includes(key) && <span className="text-red-400 ml-0.5">*</span>}
                {prop.description && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — {prop.description}
                  </span>
                )}
              </label>
            )}
            <FieldInput
              name={key}
              prop={prop}
              value={values[key]}
              disabled={submitted}
              onChange={handleChange}
            />
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end px-4 py-3 border-t border-border bg-muted/20">
        <button
          onClick={handleSubmit}
          disabled={submitted}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="h-3.5 w-3.5" />
          Submit
        </button>
      </div>
    </div>
  );
}
