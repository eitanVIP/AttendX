import { useRef, useState } from 'react'
import FormPanel from './FormPanel'

const LONG_PRESS_MS = 500

// Up/down arrows for reordering one row, plus (when `onMoveTo`, `index`
// and `count` are given) a long-press on either arrow that opens a dialog
// to jump straight to a position - for lists too long to arrow through one
// step at a time. `index`/`count` are 0-based/total within whatever list
// the caller is reordering (a full table, or one filtered group of it).
// `onUp`/`onDown`/`canUp`/`canDown` always mean "earlier/later in the
// list" - `orientation="horizontal"` (for cards laid out left-to-right
// instead of rows stacked top-to-bottom, e.g. certification cards) just
// swaps the arrow glyphs and wording to left/right, not the underlying
// callbacks. `spread` pins the two arrows to opposite ends of a full-width
// row instead of sitting side by side, with `children` (e.g. Edit/Delete)
// centered between them - for a card's own action row, rather than a
// table's cramped actions column.
export default function MoveButtons({
  onUp,
  onDown,
  canUp,
  canDown,
  index,
  count,
  onMoveTo,
  label = 'item',
  orientation = 'vertical',
  spread = false,
  children,
}) {
  const canJump = typeof onMoveTo === 'function' && count > 1
  const horizontal = orientation === 'horizontal'
  const backSymbol = horizontal ? '←' : '↑'
  const forwardSymbol = horizontal ? '→' : '↓'
  const backLabel = horizontal ? 'Move left' : 'Move up'
  const forwardLabel = horizontal ? 'Move right' : 'Move down'
  const edgeLabels = horizontal ? ['the left', 'the right'] : ['the top', 'the bottom']
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState('1')
  const timerRef = useRef(null)
  const longPressedRef = useRef(false)

  function startPress() {
    if (!canJump) return
    longPressedRef.current = false
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true
      setPosition(String(index + 1))
      setOpen(true)
    }, LONG_PRESS_MS)
  }

  function cancelPress() {
    clearTimeout(timerRef.current)
  }

  // A long press still ends in a click once the button is released; this
  // is what stops that click from also nudging the row up/down.
  function handleClick(action) {
    if (longPressedRef.current) {
      longPressedRef.current = false
      return
    }
    action()
  }

  function handleSubmit(e) {
    e.preventDefault()
    const wanted = Math.round(Number(position))
    if (!Number.isFinite(wanted)) return
    // Clamped again here even though the input already carries min/max -
    // belt and suspenders against a value that reaches here some other way
    // (a corrupt position, browser quirk, etc.), same as movedTo/
    // movedWithinGroup clamping their own end of this.
    const clamped = Math.min(Math.max(wanted, 1), count)
    setOpen(false)
    if (clamped - 1 !== index) onMoveTo(clamped - 1)
  }

  const pressHandlers = canJump
    ? {
        onPointerDown: startPress,
        onPointerUp: cancelPress,
        onPointerLeave: cancelPress,
        onPointerCancel: cancelPress,
        onContextMenu: (e) => e.preventDefault(),
      }
    : {}

  const backButton = (
    <button
      type="button"
      className="link-btn move-btn"
      onClick={() => handleClick(onUp)}
      disabled={!canUp}
      aria-label={backLabel}
      title={canJump ? `${backLabel} (hold to choose a position)` : backLabel}
      {...pressHandlers}
    >
      {backSymbol}
    </button>
  )
  const forwardButton = (
    <button
      type="button"
      className="link-btn move-btn"
      onClick={() => handleClick(onDown)}
      disabled={!canDown}
      aria-label={forwardLabel}
      title={canJump ? `${forwardLabel} (hold to choose a position)` : forwardLabel}
      {...pressHandlers}
    >
      {forwardSymbol}
    </button>
  )

  return (
    <>
      {spread ? (
        <div className="move-buttons-spread">
          {backButton}
          <div className="row-actions">{children}</div>
          {forwardButton}
        </div>
      ) : (
        <>
          {backButton}
          {forwardButton}
        </>
      )}

      {canJump && (
        <FormPanel open={open} onClose={() => setOpen(false)} onSubmit={handleSubmit}>
          <h2>Move {label}</h2>
          <p className="muted">
            Choose where this {label} belongs in the list: 1 is {edgeLabels[0]}, {count} is {edgeLabels[1]}.
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>
              Position (1–{count})
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={count}
                step="1"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                autoFocus
                required
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit">Move</button>
          </div>
        </FormPanel>
      )}
    </>
  )
}
