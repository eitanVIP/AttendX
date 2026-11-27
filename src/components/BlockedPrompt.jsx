import { useState } from 'react'
import FormPanel from './FormPanel'
import { t } from '../lib/i18n'

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
      <h3>{t('Why is it blocked?')}</h3>
      {ask && <p className="muted">{ask.task.title}</p>}
      <label>
        {t('Reason')}
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. waiting for the motor mount')} required autoFocus />
      </label>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit">{t('Mark blocked')}</button>
      </div>
    </FormPanel>
  )
}
