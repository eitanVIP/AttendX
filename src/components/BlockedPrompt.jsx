import { useState } from 'react'
import FormPanel from './FormPanel'

// Asks why a task is being put into a blocked status. `ask` is
// { task, statusId } or null.
export default function BlockedPrompt({ ask, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  return (
    <FormPanel
      open={!!ask}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        const text = reason.trim()
        if (!text) return
        onSubmit(text)
        setReason('')
      }}
    >
      <h3>Why is it blocked?</h3>
      {ask && <p className="muted">{ask.task.title}</p>}
      <label>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. waiting for the motor mount" required autoFocus />
      </label>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">Mark blocked</button>
      </div>
    </FormPanel>
  )
}
