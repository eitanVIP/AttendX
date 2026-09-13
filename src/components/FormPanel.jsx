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
  const cardRef = useRef(null)
  const pressedBackdropRef = useRef(false)

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
      onMouseDown={(e) => {
        pressedBackdropRef.current = e.target === e.currentTarget
      }}
      // A held mouse button captures every later event on the element it
      // pressed down on - so a press that starts on the backdrop still
      // reports the backdrop as this click's target even after dragging
      // onto the card and releasing there (a slightly mis-aimed click, or a
      // text selection that starts outside the card), and it used to close
      // the panel on exactly that press rather than where the mouse came
      // up. e.target can't tell the two apart since it's always the
      // backdrop either way; comparing the release point to the card's own
      // box can, so a release actually over the card is left alone.
      onClick={(e) => {
        if (!pressedBackdropRef.current) return
        const card = cardRef.current?.getBoundingClientRect()
        const releasedOnCard =
          card && e.clientX >= card.left && e.clientX <= card.right && e.clientY >= card.top && e.clientY <= card.bottom
        if (!releasedOnCard) onClose()
      }}
    >
      <form ref={cardRef} className="modal-card" {...formProps}>
        {children}
      </form>
    </dialog>
  )
}
