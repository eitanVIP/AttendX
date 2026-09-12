import { useEffect, useState } from 'react'

// Must match the animation duration of .panel-closing in index.css.
const EXIT_MS = 160

// An add/edit form that stays mounted for the length of its exit animation
// so closing it fades out instead of vanishing mid-frame. Callers keep their
// form state as-is while it closes and reset it when reopening, otherwise
// the fade would show the fields blanking out.
export default function FormPanel({ open, children, ...formProps }) {
  const [visible, setVisible] = useState(open)

  if (open && !visible) setVisible(true)

  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => setVisible(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [open])

  if (!visible) return null

  return (
    <form className={`card form-card ${open ? 'panel-open' : 'panel-closing'}`} {...formProps}>
      {children}
    </form>
  )
}
