import { useState } from 'react'
import FormPanel from './FormPanel'
import { t } from '../lib/i18n'

const DAY_MS = 86400000

// For a task lead or admin: the requests still waiting for a decision. One
// line with a count until opened, so a long list doesn't push the tasks down.
export function TaskRequestList({ requests, onAccept, onDecline, embedded = false }) {
  const [declining, setDeclining] = useState(null)
  const [reason, setReason] = useState('')
  const [openState, setOpen] = useState(false)
  const open = embedded || openState
  const pending = requests.filter((r) => r.status === 'pending')
  if (pending.length === 0) return null
  return (
    <div className={embedded ? undefined : 'card'} style={embedded ? undefined : { padding: 12, marginBottom: 12 }}>
      {!embedded && (
        <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ padding: 0, fontWeight: 600 }}>
          📝 {pending.length === 1 ? t('1 task request from students') : t('{n} task requests from students', { n: pending.length })} {open ? '▾' : '▸'}
        </button>
      )}
      {open && (
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pending.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.title}</strong> <span className="muted">from {r.requestedByName}{r.division ? ` - ${r.division}` : ''}</span>
            </div>
            {r.description && <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{r.description}</div>}
            {declining === r.id ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Reason (optional)')} style={{ flex: 1 }} />
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => {
                    onDecline(r, reason.trim())
                    setDeclining(null)
                    setReason('')
                  }}
                >
                  {t('Decline')}
                </button>
                <button type="button" className="secondary" onClick={() => setDeclining(null)}>
                  {t('Cancel')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="button" onClick={() => onAccept(r)} style={{ fontSize: 12, padding: '3px 8px' }}>
                  {t('Accept...')}
                </button>
                <button type="button" className="secondary" onClick={() => setDeclining(r.id)} style={{ fontSize: 12, padding: '3px 8px' }}>
                  {t('Decline')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}

// A student's own requests: the ones still waiting and the ones decided in
// the last two weeks.
export function MyTaskRequests({ requests, onRequest }) {
  const recent = requests.filter((r) => r.status === 'pending' || Date.now() - Date.parse(r.decidedAt || r.createdAt) < 14 * DAY_MS)
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{t('Your task requests')}</strong>
        <button type="button" className="secondary" onClick={onRequest}>
          {t('Request a task')}
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="muted" style={{ margin: '4px 0 0' }}>{t('Need something done? Ask for a task and a lead will look at it.')}</p>
      ) : (
        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
          {recent.map((r) => (
            <li key={r.id}>
              {r.title}{' '}
              <span className="muted">
                {r.status === 'pending' ? `- ${t('waiting for a lead')}` : r.status === 'accepted' ? `- ${t('accepted')}` : `- ${t('declined')}${r.declineReason ? `: ${r.declineReason}` : ''}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function RequestTaskPanel({ open, onClose, onSubmit, divisions = [] }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [division, setDivision] = useState('')
  return (
    <FormPanel
      open={open}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        const t = title.trim()
        if (!t) return
        onSubmit({ title: t, description: description.trim(), division })
        setTitle('')
        setDescription('')
        setDivision('')
      }}
    >
      <h3>{t('Request a task')}</h3>
      <div className="form-grid">
        <label className="span-2">
          {t('What needs doing?')}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </label>
        <label className="span-2">
          {t('Details (optional)')}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
        </label>
        {divisions.length > 0 && (
          <label className="span-2">
            {t('Division (optional)')}
            <select value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="">{t('None')}</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit">{t('Send request')}</button>
      </div>
    </FormPanel>
  )
}
