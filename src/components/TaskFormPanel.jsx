import { useEffect, useState } from 'react'
import FormPanel from './FormPanel'
import TaskHistory from './TaskHistory'
import DateField from './DateField'
import { REPEATS, TASK_PRIORITIES, isWebLink } from '../lib/tasks'
import { dateLocale, t } from '../lib/i18n'

// Create / edit a task - used by the admin Tasks page and by task leads on
// My Tasks. `onDelete` is passed only where deleting is allowed (admins).
export default function TaskFormPanel({ open, onClose, onSubmit, form, setForm, students, statuses, divisions = [], candidates = [], error, editing, onDelete, comments = [], onAddComment, blockedIds = [], products = [], systems = [], projects = [], onDuplicate, history = [] }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const [newItem, setNewItem] = useState('')
  const [partSearch, setPartSearch] = useState('')
  const [newLink, setNewLink] = useState({ url: '', label: '' })
  const [linkError, setLinkError] = useState('')
  const links = form.links || []
  // The rarely used fields fold away; they start open only when this task already uses one.
  const [more, setMore] = useState(false)
  function addLink() {
    const url = newLink.url.trim()
    if (!url) return
    if (!isWebLink(url)) {
      setLinkError(t('A link has to start with http:// or https://'))
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
  const usesMore = !!(form.startDate || form.repeat || form.project || form.systemId || (form.partIds || []).length || links.length || checklist.length || (form.blockedBy || []).length)
  useEffect(() => {
    if (open) setMore(usesMore)
    // Only when the panel opens - not while someone is typing in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <FormPanel open={open} onClose={onClose} onSubmit={onSubmit}>
      <h3>{editing ? t('Edit task') : t('New task')}</h3>
      <div className="form-grid">
        <label className="span-2">
          {t('Title')}
          <input value={form.title} onChange={set('title')} required autoFocus />
        </label>
        <label className="span-2">
          {t('Description')}
          <textarea value={form.description} onChange={set('description')} rows={3} />
        </label>
        <label>
          {t('Assignee')}
          <select value={form.assigneeId} onChange={set('assigneeId')}>
            <option value="">{t('Unassigned')}</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Due date')}
          <DateField value={form.dueDate} min={form.startDate || undefined} onChange={(dueDate) => setForm({ ...form, dueDate })} ariaLabel="Due date" />
        </label>
        <label>
          {t('Status')}
          <select value={form.statusId || statuses[0].id} onChange={set('statusId')}>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Priority')}
          <select value={form.priority} onChange={set('priority')}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.name)}
              </option>
            ))}
          </select>
        </label>
        {divisions.length > 0 && (
          <label className="span-2">
            {t('Division')}
            <select value={form.division || ''} onChange={set('division')}>
              <option value="">{t('None')}</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {blockedIds.includes(form.statusId || statuses[0].id) && (
          <label className="span-2">
            {t('Why is it blocked?')}
            <input value={form.blockedReason || ''} onChange={set('blockedReason')} required />
          </label>
        )}
        <details className="span-2 task-more" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
          <summary>{t('More options')} <span className="muted">{t('dates, project, parts, links, checklist, repeat')}</span></summary>
          <div className="form-grid" style={{ marginTop: 8 }}>
        <label>
          {t('Start date')}
          <DateField value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} ariaLabel="Start date" />
        </label>
        <label>
          {t('Repeats')}
          <select value={form.repeat || ''} onChange={set('repeat')}>
            {REPEATS.map((r) => (
              <option key={r.id} value={r.id}>
                {t(r.name)}
              </option>
            ))}
          </select>
        </label>
        {form.repeat && !form.startDate && !form.dueDate && (
          <p className="muted span-2" style={{ fontSize: 12, margin: 0 }}>
            {t('A repeating task needs a start or due date. The next copy is made when this one is finished.')}
          </p>
        )}
        <label className="span-2">
          {t('Project (optional)')}
          <input list="task-projects" value={form.project || ''} onChange={set('project')} placeholder={t('e.g. Drivetrain v2')} maxLength={80} />
          <datalist id="task-projects">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        {systems.length > 0 && (
          <label className="span-2">
            {t('Robot system')}
            <select value={form.systemId || ''} onChange={set('systemId')}>
              <option value="">{t('None')}</option>
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
            <legend className="muted" style={{ fontSize: 13 }}>{t('Needs parts (locked until they are bought)')}</legend>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {(form.partIds || []).map((id) => (
                <span key={id} className="badge badge-muted">
                  {products.find((p) => p.id === id)?.name || t('(deleted part)')}{' '}
                  <button type="button" className="link-btn" aria-label={t('Remove part')} onClick={() => setForm({ ...form, partIds: form.partIds.filter((x) => x !== id) })}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <input value={partSearch} onChange={(e) => setPartSearch(e.target.value)} placeholder={t('Search parts to add')} />
            {partSearch.trim() &&
              products
                .filter((p) => !(form.partIds || []).includes(p.id) && p.name.toLowerCase().includes(partSearch.trim().toLowerCase()))
                .slice(0, 6)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="link-btn"
                    style={{ display: 'block', textAlign: 'start' }}
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
        <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <legend className="muted" style={{ fontSize: 13 }}>{t('Links')}</legend>
          {links.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 13 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l.label ? `${l.label} - ` : ''}
                {l.url}
              </span>
              <button type="button" className="link-btn danger" aria-label={t('Remove link')} onClick={() => setForm({ ...form, links: links.filter((x) => x.id !== l.id) })}>
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
            <input value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} placeholder={t('Name (optional)')} style={{ flex: 1 }} />
            <button type="button" className="secondary" onClick={addLink}>
              {t('Add')}
            </button>
          </div>
          {linkError && <p className="form-error" style={{ margin: '4px 0 0' }}>{linkError}</p>}
        </fieldset>
        <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <legend className="muted" style={{ fontSize: 13 }}>
            {t('Checklist')}{checklist.length > 0 && ` (${checklist.filter((i) => i.done).length}/${checklist.length})`}
          </legend>
          {checklist.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={item.done}
                aria-label={t('Done: {text}', { text: item.text })}
                onChange={(e) => setChecklist(checklist.map((i) => (i.id === item.id ? { ...i, done: e.target.checked } : i)))}
              />
              <input
                value={item.text}
                onChange={(e) => setChecklist(checklist.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)))}
                style={{ flex: 1, textDecoration: item.done ? 'line-through' : 'none' }}
              />
              <button type="button" className="link-btn danger" aria-label={t('Remove {text}', { text: item.text })} onClick={() => setChecklist(checklist.filter((i) => i.id !== item.id))}>
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
              placeholder={t('Add a step and press Enter')}
              style={{ flex: 1 }}
            />
            <button type="button" className="secondary" onClick={addItem}>
              {t('Add')}
            </button>
          </div>
        </fieldset>
        {candidates.length > 0 && (
          <fieldset className="span-2" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
            <legend className="muted" style={{ fontSize: 13 }}>{t("Waits for (can't start until these are finished)")}</legend>
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
        </details>
      </div>
      {editing && onAddComment && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
            {t('Comments')}{comments.length > 0 && ` (${comments.length})`}
          </div>
          <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
            {comments.map((c) => (
              <div key={c.id} style={{ fontSize: 13 }}>
                <strong>{c.authorName}</strong> <span className="muted">{new Date(c.at).toLocaleString(dateLocale())}</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder={t('Write a comment')} style={{ flex: 1 }} />
            <button type="button" className="secondary" onClick={postComment}>
              {t('Post')}
            </button>
          </div>
        </div>
      )}
      {editing && <TaskHistory history={history} />}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        {editing && onDuplicate && (
          <button type="button" className="secondary" onClick={onDuplicate}>
            {t('Duplicate')}
          </button>
        )}
        {onDelete && (
          <button type="button" className="secondary danger" onClick={onDelete}>
            {t('Delete')}
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit">{editing ? t('Save') : t('Create')}</button>
      </div>
    </FormPanel>
  )
}
