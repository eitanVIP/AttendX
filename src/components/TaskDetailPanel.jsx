import { useState } from 'react'
import FormPanel from './FormPanel'
import TaskHistory from './TaskHistory'
import { linkLabel, taskDateLabel, taskLinks } from '../lib/tasks'

// What an assignee who isn't a task lead sees when they open their own task:
// read-only details, plus the things they may do - move it between the
// unfinished statuses, tick the checklist, comment, and ask for it to be
// marked done (a lead or admin approves that).
export default function TaskDetailPanel({ open, onClose, task, statuses, currentStatusId, onMove, onToggleItem, onAddComment, onRequestDone }) {
  const [comment, setComment] = useState('')
  if (!task) return null
  const options = statuses.filter((s) => !s.done)
  const finished = !options.some((s) => s.id === currentStatusId)
  const checklist = task.checklist || []
  const comments = task.comments || []
  function post() {
    const text = comment.trim()
    if (!text) return
    onAddComment(text)
    setComment('')
  }
  return (
    <FormPanel open={open} onClose={onClose} onSubmit={(e) => e.preventDefault()}>
      <h3>{task.title}</h3>
      {task.description && <p style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p>}
      <p className="muted" style={{ marginTop: 0 }}>
        {[taskDateLabel(task), task.division].filter(Boolean).join(' - ')}
      </p>
      {taskLinks(task).length > 0 && (
        <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '4px 0' }}>
          {taskLinks(task).map((l) => (
            <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer">
              🔗 {linkLabel(l)}
            </a>
          ))}
        </p>
      )}
      {!finished && (
        <label>
          Status
          <select value={currentStatusId} onChange={(e) => onMove(e.target.value)}>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {checklist.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Checklist ({checklist.filter((i) => i.done).length}/{checklist.length})
          </div>
          {checklist.map((item) => (
            <label key={item.id} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={item.done} onChange={() => onToggleItem(item.id)} />
              <span style={{ textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
          Comments{comments.length > 0 && ` (${comments.length})`}
        </div>
        <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ fontSize: 13 }}>
              <strong>{c.authorName}</strong> <span className="muted">{new Date(c.at).toLocaleString()}</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={post}>
            Post
          </button>
        </div>
      </div>
      <TaskHistory history={task.history || []} />
      <div className="form-actions">
        {!finished &&
          (task.doneRequested ? (
            <button type="button" className="secondary" onClick={() => onRequestDone(false)}>
              Cancel finish request
            </button>
          ) : (
            <button type="button" onClick={() => onRequestDone(true)}>
              Request done
            </button>
          ))}
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {task.doneRequested && !finished && <p className="muted">Waiting for a task lead or admin to approve this as done.</p>}
    </FormPanel>
  )
}
