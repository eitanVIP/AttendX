import FormPanel from './FormPanel'
import DateField from './DateField'
import { TASK_PRIORITIES } from '../lib/tasks'

// Create / edit a task - used by the admin Tasks page and by task leads on
// My Tasks. `onDelete` is passed only where deleting is allowed (admins).
export default function TaskFormPanel({ open, onClose, onSubmit, form, setForm, students, statuses, divisions = [], candidates = [], error, editing, onDelete }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
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
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
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
