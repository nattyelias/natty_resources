import type { CSSProperties } from "react";
import type { ViewMode } from "../core/types.ts";

const OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "grad", label: "Grad" },
  { value: "undergrad", label: "Undergrad" },
];

/**
 * A radio group drawn as a pill. The inputs are real radios sharing one name, so the browser gives
 * arrow-key movement between them, and the selected one is the only tab stop.
 */
export function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const index = OPTIONS.findIndex((o) => o.value === mode);
  return (
    <fieldset className="toggle" style={{ "--index": index } as CSSProperties}>
      <legend className="visually-hidden">View mode</legend>
      <span className="toggle-indicator" aria-hidden="true" />
      {OPTIONS.map((o) => (
        <label key={o.value} className="toggle-option">
          <input type="radio" name="view-mode" value={o.value} checked={mode === o.value} onChange={() => onChange(o.value)} />
          <span className="toggle-label">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
