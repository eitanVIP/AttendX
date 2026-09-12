import { useEffect, useRef, useState } from 'react'

// Must match the animation duration of .panel-closing in index.css.
const EXIT_MS = 160

// An add/edit form shown as a modal dialog. Stays mounted for the length
// of its exit animation so closing fades out instead of vanishing
// mid-frame. Callers keep their form state as-is while it closes and reset
// it when reopening, otherwise the fade would show the fields blanking
// out. `onClose` is what Escape and a click on the backdrop call.
export default function FormPanel({ open, onClose, children, ...formProps }) {
  const [visible, setVisible] = useState(open)
  const dialogRef = useRef(null)

  if (open && !visible) setVisible(true)

  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => setVisible(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [open])

  // showModal() (rather than the `open` attribute) is what gives the
  // dialog its focus trap and puts the rest of the page behind it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
  }, [open, visible])

  if (!visible) return null

  // Escape is handled on keydown (and default-prevented) so the browser's
  // own close-watcher never runs - Chrome skips the cancel event on a
  // repeat Escape once one has been preventDefault'ed, which would close
  // the dialog natively behind React's back. onClose on the element is
  // the safety net if that ever happens anyway.
  return (
    <dialog
      ref={dialogRef}
      className={`modal ${open ? 'panel-open' : 'panel-closing'}`}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onClose()
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form className="modal-card" {...formProps}>
        {children}
      </form>
    </dialog>
  )
}
