import { useEffect, useRef, useState } from 'react'
import { formatDMY, parseDMY } from '../lib/tasks'

// A date typed as dd/mm/yy (native date inputs show the browser's own order,
// which can't be changed), with a calendar button for picking one instead.
// `value` and `onChange` use ISO 'YYYY-MM-DD' (or '' for none), so the rest of
// the app never sees the display format.
export default function DateField({ value, onChange, min, ariaLabel }) {
  const [draft, setDraft] = useState(null)
  const textRef = useRef(null)
  const pickerRef = useRef(null)
  const text = draft ?? formatDMY(value)
  const parsed = parseDMY(text)

  useEffect(() => {
    const input = textRef.current
    if (!input) return
    if (parsed === null) input.setCustomValidity('Use the format dd/mm/yy')
    else if (min && parsed && parsed < min) input.setCustomValidity('This is before the start date')
    else input.setCustomValidity('')
  }, [parsed, min])

  return (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        ref={textRef}
        value={text}
        placeholder="dd/mm/yy"
        inputMode="numeric"
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value)
          const next = parseDMY(e.target.value)
          if (next !== null) onChange(next)
        }}
        onBlur={() => {
          if (parseDMY(text) !== null) setDraft(null)
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button type="button" className="secondary" aria-label="Pick a date" onClick={() => pickerRef.current?.showPicker?.()} style={{ padding: '4px 8px' }}>
        📅
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min || undefined}
        onChange={(e) => {
          setDraft(null)
          onChange(e.target.value)
        }}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />
    </span>
  )
}
