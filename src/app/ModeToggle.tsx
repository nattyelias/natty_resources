import type { CSSProperties } from 'react'
import type { ViewMode } from '../core/types.ts'

const OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grad', label: 'Grad' },
  { value: 'undergrad', label: 'Undergrad' },
]

/**
 * Grad / Undergrad: a radio group drawn as a pill. The inputs are real radios sharing one name, so the browser gives
 * arrow-key movement between them and the checked one is the only tab stop. Its look is in index.css (.mode-toggle).
 */
export function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const index = OPTIONS.findIndex(o => o.value === mode)
  return (
    <fieldset className="mode-toggle no-print" style={{ ['--index' as string]: index } as CSSProperties}>
      <legend className="sr-only">View mode</legend>
      <span className="mode-toggle-indicator" aria-hidden="true" />
      {OPTIONS.map(o => (
        <label key={o.value} className="mode-toggle-option">
          <input type="radio" name="view-mode" value={o.value} checked={mode === o.value} onChange={() => onChange(o.value)} />
          <span className="mode-toggle-label">{o.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
