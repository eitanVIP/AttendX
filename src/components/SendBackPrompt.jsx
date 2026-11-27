import { useState } from 'react'
import FormPanel from './FormPanel'
import { t } from '../lib/i18n'

// Asks for an optional note when a finish request is sent back. `task` is the
// task being sent back, or null.
export default function SendBackPrompt({ task, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  return (
    <FormPanel
      open={!!task}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(reason.trim())
        setReason('')
      }}
    >
      <h3>{t('Send back')}</h3>
      {task && <p className="muted">{task.title}</p>}
      <label>
        {t("What still needs doing? (optional, goes in the task's comments)")}
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. the checklist isn't finished")} autoFocus />
      </label>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit">{t('Send back')}</button>
      </div>
    </FormPanel>
  )
}
