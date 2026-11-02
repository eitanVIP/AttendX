import { useState } from 'react'
import FormPanel from './FormPanel'
import DateField from './DateField'
import { REPEATS, TASK_PRIORITIES, isWebLink } from '../lib/tasks'

// Create / edit a task - used by the admin Tasks page and by task leads on
// My Tasks. `onDelete` is passed only where deleting is allowed (admins).
export default function TaskFormPanel({ open, onClose, onSubmit, form, setForm, students, statuses, divisions = [], candidates = [], error, editing, onDelete, comments = [], onAddComment, blockedIds = [], products = [], systems = [], onDuplicate }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const [newItem, setNewItem] = useState('')
  const [partSearch, setPartSearch] = useState('')
  const [newLink, setNewLink] = useState({ url: '', label: '' })
  const [linkError, setLinkError] = useState('')
  const links = form.links || []
  function addLink() {
    const url = newLink.url.trim()
    if (!url) return
    if (!isWebLink(url)) {
      setLinkError('A link has to start with http:// or https://')
      return
    }
    setLinkError('')
    setForm({ ...form, links: [...links, { id: Math.random().toString(36).slice(2, 8), url, label: newLink.label.trim() }] })
    setNewLink({ url: '', label: '' })
  }
  const [newComment, setNewComment] = useState('')
  const checklist = form.checklist || []
  const setChecklist = (next) => setForm({ ...form, checklist: next })
  function addItem() {
    const text = newItem.trim()
    if (!text) return
    setChecklist([...checklist, { id: Math.random().toString(36).slice(2, 8), text, done: false }])
    setNewItem('')
  }
  function postComment() {
    const text = newComment.trim()
    if (!text) return
    onAddComment(text)
    setNewComment('')
  }
  return (
    <FormPanel open={open} onClose={onClose} onSubmit={onSubmit}>
      <h3>{editing ? 'Edit task' : 'New task'}</h3>
      <div className="form-grid">
        <label className="span-2">
          Title
          <input value={form.title} onChange={set('title')} required autoFocus />
        </label>
        <label className="span-2">
          Description
          <textarea value={form.description} onChange={set('description')} rows={3} />
        </label>
        <label>
          Assignee
          <select value={form.assigneeId} onChange={set('assigneeId')}>
            <option value="">Unassigned</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        {divisions.length > 0 && (
          <label className="span-2">
            Division
            <select value={form.division || ''} onChange={set('division')}>
              <option value="">None</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Start date
          <DateField value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} ariaLabel="Start date" />
        </label>
        <label>
          Due date
          <DateField value={form.dueDate} min={form.startDate || undefined} onChange={(dueDate) => setForm({ ...form, dueDate })} ariaLabel="Due date" />
        </label>
        <label>
          Status
          <select value={form.statusId || statuses[0].id} onChange={set('statusId')}>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={form.priority} onChange={set('priority')}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {systems.length > 0 && (
          <label className="span-2">
            Robot system
            <select value={form.systemId || ''} onChange={set('systemId')}>
              <option value="">None</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {products.length > 0 && (
          <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
            <legend className="muted" style={{ fontSize: 13 }}>Needs parts (locked until they are bought)</legend>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {(form.partIds || []).map((id) => (
                <span key={id} className="badge badge-muted">
                  {products.find((p) => p.id === id)?.name || '(deleted part)'}{' '}
                  <button type="button" className="link-btn" aria-label="Remove part" onClick={() => setForm({ ...form, partIds: form.partIds.filter((x) => x !== id) })}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <input value={partSearch} onChange={(e) => setPartSearch(e.target.value)} placeholder="Search parts to add" />
            {partSearch.trim() &&
              products
                .filter((p) => !(form.partIds || []).includes(p.id) && p.name.toLowerCase().includes(partSearch.trim().toLowerCase()))
                .slice(0, 6)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="link-btn"
                    style={{ display: 'block', textAlign: 'left' }}
                    onClick={() => {
                      setForm({ ...form, partIds: [...(form.partIds || []), p.id] })
                      setPartSearch('')
                    }}
                  >
                    + {p.name}
                  </button>
                ))}
          </fieldset>
        )}
        {blockedIds.includes(form.statusId || statuses[0].id) && (
          <label className="span-2">
            Why is it blocked?
            <input value={form.blockedReason || ''} onChange={set('blockedReason')} required />
          </label>
        )}
        <label>
          Repeats
          <select value={form.repeat || ''} onChange={set('repeat')}>
            {REPEATS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {form.repeat && !form.startDate && !form.dueDate && (
          <p className="muted span-2" style={{ fontSize: 12, margin: 0 }}>
            A repeating task needs a start or due date. The next copy is made when this one is finished.
          </p>
        )}
        <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <legend className="muted" style={{ fontSize: 13 }}>Links</legend>
          {links.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 13 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l.label ? `${l.label} - ` : ''}
                {l.url}
              </span>
              <button type="button" className="link-btn danger" aria-label="Remove link" onClick={() => setForm({ ...form, links: links.filter((x) => x.id !== l.id) })}>
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newLink.url}
              onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addLink()
                }
              }}
              placeholder="https://..."
              style={{ flex: 2 }}
            />
            <input value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} placeholder="Name (optional)" style={{ flex: 1 }} />
            <button type="button" className="secondary" onClick={addLink}>
              Add
            </button>
          </div>
          {linkError && <p className="form-error" style={{ margin: '4px 0 0' }}>{linkError}</p>}
        </fieldset>
        <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <legend className="muted" style={{ fontSize: 13 }}>
            Checklist{checklist.length > 0 && ` (${checklist.filter((i) => i.done).length}/${checklist.length})`}
          </legend>
          {checklist.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={item.done}
                aria-label={`Done: ${item.text}`}
                onChange={(e) => setChecklist(checklist.map((i) => (i.id === item.id ? { ...i, done: e.target.checked } : i)))}
              />
              <input
                value={item.text}
                onChange={(e) => setChecklist(checklist.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)))}
                style={{ flex: 1, textDecoration: item.done ? 'line-through' : 'none' }}
              />
              <button type="button" className="link-btn danger" aria-label={`Remove ${item.text}`} onClick={() => setChecklist(checklist.filter((i) => i.id !== item.id))}>
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addItem()
                }
              }}
              placeholder="Add a step and press Enter"
              style={{ flex: 1 }}
            />
            <button type="button" className="secondary" onClick={addItem}>
              Add
            </button>
          </div>
        </fieldset>
        {candidates.length > 0 && (
          <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
            <legend className="muted" style={{ fontSize: 13 }}>Waits for (can't start until these are finished)</legend>
            <div style={{ maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {candidates.map((t) => (
                <label key={t.id} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={(form.blockedBy || []).includes(t.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        blockedBy: e.target.checked ? [...(form.blockedBy || []), t.id] : (form.blockedBy || []).filter((id) => id !== t.id),
                      })
                    }
                  />
                  {t.title}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
      {editing && onAddComment && (
        <div style={{ marginTop: 10 }}>
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
            <input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Write a comment" style={{ flex: 1 }} />
            <button type="button" className="secondary" onClick={postComment}>
              Post
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {editing && onDuplicate && (
          <button type="button" className="secondary" onClick={onDuplicate}>
            Duplicate
          </button>
        )}
        {onDelete && (
          <button type="button" className="secondary danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">{editing ? 'Save' : 'Create'}</button>
      </div>
    </FormPanel>
  )
}
