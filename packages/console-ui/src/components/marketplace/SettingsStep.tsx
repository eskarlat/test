import { VaultKeyPicker } from "./VaultKeyPicker";
import { cn } from "../../lib/utils";

export interface SettingField {
  key: string;
  type: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: string[] | { label: string; value: string }[];
  placeholder?: string;
}

export type SettingsValues = Record<string, string | number | boolean>;

interface SettingsStepProps {
  schema: SettingField[];
  values: SettingsValues;
  onChange: (key: string, value: string | number | boolean) => void;
}

const inputCls = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "ring-offset-background placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/**
 * Step 2 of the install dialog: auto-generated settings form.
 * Vault-type fields use VaultKeyPicker; other types use appropriate inputs.
 */
export function SettingsStep({ schema, values, onChange }: SettingsStepProps) {
  if (schema.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No settings required for this extension.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {schema.map((field) => {
        const fieldId = `install-setting-${field.key}`;
        const currentValue = values[field.key];

        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
              {field.label ?? field.key}
              {field.required && (
                <span className="ml-1 text-destructive" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}

            {field.type === "vault" && (
              <VaultKeyPicker
                id={fieldId}
                value={typeof currentValue === "string" ? currentValue.replace(/^\$\{VAULT:(.+)\}$/, "$1") : ""}
                onChange={(key) => onChange(field.key, key ? `\${VAULT:${key}}` : "")}
                placeholder={field.placeholder ?? "Select vault key..."}
              />
            )}

            {field.type === "string" && (
              <input
                id={fieldId}
                type="text"
                value={(currentValue as string | undefined) ?? ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.placeholder ?? (field.default !== undefined ? String(field.default) : "")}
                className={inputCls}
              />
            )}

            {field.type === "number" && (
              <input
                id={fieldId}
                type="number"
                value={(currentValue as number | undefined) ?? (typeof field.default === "number" ? field.default : 0)}
                onChange={(e) => onChange(field.key, Number(e.target.value))}
                className={inputCls}
              />
            )}

            {field.type === "boolean" && (
              <div className="flex items-center gap-2">
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={(currentValue as boolean | undefined) ?? (field.default === true)}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm text-muted-foreground">Enable</span>
              </div>
            )}

            {field.type === "select" && Array.isArray(field.options) && (
              <select
                id={fieldId}
                value={(currentValue as string | undefined) ?? ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                className={inputCls}
              >
                <option value="">Select option...</option>
                {field.options.map((opt) => (
                  <option key={typeof opt === "string" ? opt : opt.value} value={typeof opt === "string" ? opt : opt.value}>
                    {typeof opt === "string" ? opt : opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
