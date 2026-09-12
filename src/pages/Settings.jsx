import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import MoveButtons from '../components/MoveButtons'
import PasswordInput, { RevealButton } from '../components/PasswordInput'
import { DEFAULT_ACCENT } from '../lib/theme'
import { useCommunitySettings, useEvents } from '../lib/firestore-hooks'
import { todayISO } from '../lib/calc'
import {
  addEvent,
  deleteEvent,
  setCommunitySettings,
  updateEvent,
  updateTeam,
  updateTeamStructure,
} from '../lib/actions'

// Returns a copy of `list` with the item matching `isTarget` swapped with
// its neighbour in `direction` (-1 up, +1 down); unchanged at the ends.
function swapNeighbours(list, isTarget, direction) {
  const i = list.findIndex(isTarget)
  const j = i + direction
  if (i === -1 || j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// Each row/subdivision remembers the name it had when loaded (`original`,
// null for ones added since) - that's how a save tells a rename apart from
// a delete-plus-add, so students can follow the rename instead of losing
// the membership.
function teamToDivisionRows(team) {
  const divisions = team?.divisions || []
  const subs = team?.subdivisionsByDivision || {}
  return divisions.map((name, i) => ({
    key: `${name}-${i}`,
    original: name,
    name,
    subdivisions: (subs[name] || []).map((s, j) => ({ key: `${s}-${j}`, original: s, name: s })),
  }))
}

export default function Settings() {
  const { team } = useAuth()
  const [name, setName] = useState(team?.name || '')
  const [colorPrimary, setColorPrimary] = useState(team?.colorPrimary || DEFAULT_ACCENT)
  const [minAttendance, setMinAttendance] = useState(String(team?.minAttendancePercent || 0))
  const [rows, setRows] = useState(teamToDivisionRows(team))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Team docs can change from elsewhere (or arrive after this page's first
  // render) - keep the editable copy in sync until the admin starts typing.
  useEffect(() => {
    setName(team?.name || '')
    setColorPrimary(team?.colorPrimary || DEFAULT_ACCENT)
    setMinAttendance(String(team?.minAttendancePercent || 0))
    setRows(teamToDivisionRows(team))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  function addDivision() {
    setRows([...rows, { key: `new-${Date.now()}`, original: null, name: '', subdivisions: [] }])
  }

  function removeDivision(key) {
    setRows(rows.filter((r) => r.key !== key))
  }

  function renameDivision(key, newName) {
    setRows(rows.map((r) => (r.key === key ? { ...r, name: newName } : r)))
  }

  function addSubdivision(key, subName) {
    const trimmed = subName.trim()
    if (!trimmed) return
    const sub = { key: `new-${Date.now()}`, original: null, name: trimmed }
    setRows(rows.map((r) => (r.key === key ? { ...r, subdivisions: [...r.subdivisions, sub] } : r)))
  }

  function renameSubdivision(key, subKey, newName) {
    setRows(
      rows.map((r) =>
        r.key === key
          ? { ...r, subdivisions: r.subdivisions.map((s) => (s.key === subKey ? { ...s, name: newName } : s)) }
          : r
      )
    )
  }

  function removeSubdivision(key, subKey) {
    setRows(rows.map((r) => (r.key === key ? { ...r, subdivisions: r.subdivisions.filter((s) => s.key !== subKey) } : r)))
  }

  function moveDivision(key, direction) {
    setRows(swapNeighbours(rows, (r) => r.key === key, direction))
  }

  function moveSubdivision(key, subKey, direction) {
    setRows(
      rows.map((r) =>
        r.key === key ? { ...r, subdivisions: swapNeighbours(r.subdivisions, (s) => s.key === subKey, direction) } : r
      )
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const cleanRows = rows
      .map((r) => ({
        ...r,
        name: r.name.trim(),
        subdivisions: r.subdivisions.map((s) => ({ ...s, name: s.name.trim() })).filter((s) => s.name),
      }))
      .filter((r) => r.name)
    const divisions = cleanRows.map((r) => r.name)
    const subdivisionsByDivision = Object.fromEntries(cleanRows.map((r) => [r.name, r.subdivisions.map((s) => s.name)]))
    const renames = { divisions: {}, subdivisions: {} }
    for (const r of cleanRows) {
      if (r.original && r.original !== r.name) renames.divisions[r.original] = r.name
      const subRenames = Object.fromEntries(
        r.subdivisions.filter((s) => s.original && s.original !== s.name).map((s) => [s.original, s.name])
      )
      if (Object.keys(subRenames).length) renames.subdivisions[r.original ?? r.name] = subRenames
    }
    const minAttendancePercent = Math.min(100, Math.max(0, Math.round(Number(minAttendance) || 0)))
    await updateTeamStructure(
      team.id,
      { name, colorPrimary, minAttendancePercent, divisions, subdivisionsByDivision },
      renames
    )
    // Re-baseline so a second rename in the same visit is computed against
    // the names just saved, not the ones the page loaded with.
    setRows(teamToDivisionRows({ divisions, subdivisionsByDivision }))
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Team settings</h1>
      </div>

      <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
        <div className="form-grid">
          <label className="span-2">
            Team name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Accent color
            <input type="color" value={colorPrimary} onChange={(e) => setColorPrimary(e.target.value)} />
          </label>
          <label>
            Minimum attendance to stay active (%)
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={minAttendance}
              onChange={(e) => setMinAttendance(e.target.value)}
            />
          </label>
          <p className="muted span-2" style={{ margin: '-6px 0 0' }}>
            Students whose attendance falls under this are treated as inactive everywhere, even if
            marked active by hand, and come back on their own once it recovers. 0 turns this off.
            Marking someone inactive by hand always sticks.
          </p>
        </div>

        <h2 style={{ marginTop: 20 }}>Divisions</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Divisions split your team into its major groups (e.g. Mechanical, Controls) - a student can
          belong to one or several. Subdivisions are optional, smaller groups within a division (e.g.
          Design vs. Manufacturing) for more precise training and attendance targeting - most teams can
          skip them. Edit any name in place; changes save when you click Save below. Renaming one
          renames it for every student in it, and removing one removes those students from it.
        </p>

        <div className="division-editor">
          {rows.map((row, i) => (
            <DivisionRow
              key={row.key}
              row={row}
              canUp={i > 0}
              canDown={i < rows.length - 1}
              onMove={(direction) => moveDivision(row.key, direction)}
              onRename={(v) => renameDivision(row.key, v)}
              onRemove={() => removeDivision(row.key)}
              onAddSub={(v) => addSubdivision(row.key, v)}
              onRenameSub={(subKey, v) => renameSubdivision(row.key, subKey, v)}
              onRemoveSub={(subKey) => removeSubdivision(row.key, subKey)}
              onMoveSub={(subKey, direction) => moveSubdivision(row.key, subKey, direction)}
            />
          ))}
          {rows.length === 0 && <p className="muted">No divisions yet - everyone will be ungrouped.</p>}
        </div>
        <button type="button" className="secondary" onClick={addDivision} style={{ marginTop: 10 }}>
          + Add division
        </button>

        <div className="form-actions" style={{ marginTop: 20 }}>
          {saved && <span className="muted">Saved.</span>}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <EventsSection teamId={team?.id} />
      <CodesSection team={team} />
      <CommunityHoursSection teamId={team?.id} />

      <h2>Team number</h2>
      <p className="muted">
        <code>{team?.id}</code> - what people enter to join the team or log hours, together with the
        matching code. It can't be changed.
      </p>

      <AccountSection />
    </div>
  )
}

function AccountSection() {
  const { user, resetPassword } = useAuth()
  const [status, setStatus] = useState('') // '' | 'sending' | 'sent' | 'error'

  async function handleReset() {
    setStatus('sending')
    try {
      await resetPassword(user.email)
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  return (
    <>
      <h2>Your account</h2>
      <p className="muted">
        Signed in as <code>{user?.email}</code>. Changing your password happens over email - we'll send a
        reset link to that address.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="secondary" onClick={handleReset} disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Send password reset email'}
        </button>
        {status === 'sent' && <span className="muted">Sent - check your inbox.</span>}
        {status === 'error' && <span className="form-error">Couldn't send the email - try again.</span>}
      </div>
    </>
  )
}

const emptyEvent = { name: '', date: '' }

function EventsSection({ teamId }) {
  const { data: events } = useEvents(teamId)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyEvent)
  const today = todayISO()

  function startNew() {
    setEditingId(null)
    setForm(emptyEvent)
    setShowForm(true)
  }

  function startEdit(event) {
    setEditingId(event.id)
    setForm({ name: event.name, date: event.date })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (editingId) updateEvent(teamId, editingId, form)
    else addEvent(teamId, form)
    setShowForm(false)
  }

  async function handleDelete(event) {
    if (!confirm(`Delete "${event.name}"?`)) return
    await deleteEvent(teamId, event.id)
  }

  return (
    <>
      <h2>Events</h2>
      <p className="muted">
        Upcoming events count down on the dashboard, nearest first. Past ones drop off the dashboard
        but stay here until you delete them.
      </p>
      <div className="table-scroll" style={{ maxWidth: 560 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className={event.date < today ? 'row-inactive' : ''}>
                <td>{event.name}</td>
                <td className="muted">{event.date}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="link-btn" onClick={() => startEdit(event)}>
                      Edit
                    </button>
                    <button type="button" className="link-btn danger" onClick={() => handleDelete(event)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-cell">
                  No events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="secondary" onClick={startNew}>
        + Add event
      </button>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit event' : 'New event'}</h2>
        <div className="form-grid">
          <label className="span-2">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Kickoff"
              required
            />
          </label>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingId ? 'Save' : 'Add'}</button>
        </div>
      </FormPanel>
    </>
  )
}

function CodesSection({ team }) {
  const [editing, setEditing] = useState(false)
  const [adminCode, setAdminCode] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [reveal, setReveal] = useState({ admin: false, student: false })
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setAdminCode(team?.code || '')
    setStudentCode(team?.studentCode || '')
    setError('')
    setEditing(true)
  }

  async function copy(label, value) {
    await navigator.clipboard.writeText(value || '')
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (adminCode.length < 4 || studentCode.length < 4) {
      setError('Both codes must be at least 4 characters.')
      return
    }
    if (adminCode === studentCode) {
      setError('Admin and student codes must be different.')
      return
    }
    setSaving(true)
    await updateTeam(team.id, { code: adminCode, studentCode })
    setSaving(false)
    setEditing(false)
  }

  return (
    <>
      <h2>Codes</h2>
      <p className="muted">
        The <strong>admin code</strong> opens the full dashboard. The <strong>student code</strong> only
        unlocks the community-hours logging page at <code>/log-hours</code> - share that one with students.
      </p>

      {!editing ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="muted" style={{ width: 80 }}>
              Admin
            </span>
            <code>{reveal.admin ? team?.code : '••••••••'}</code>
            <RevealButton revealed={reveal.admin} onClick={() => setReveal((r) => ({ ...r, admin: !r.admin }))} />
            <button type="button" className="link-btn" onClick={() => copy('admin', team?.code)}>
              {copied === 'admin' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="muted" style={{ width: 80 }}>
              Student
            </span>
            <code>{reveal.student ? team?.studentCode : '••••••••'}</code>
            <RevealButton revealed={reveal.student} onClick={() => setReveal((r) => ({ ...r, student: !r.student }))} />
            <button type="button" className="link-btn" onClick={() => copy('student', team?.studentCode)}>
              {copied === 'student' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div>
            <button type="button" className="secondary" onClick={startEdit}>
              Change codes
            </button>
          </div>
        </div>
      ) : (
        <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 420 }}>
          <label>
            Admin code
            <PasswordInput value={adminCode} onChange={(e) => setAdminCode(e.target.value)} minLength={4} required />
          </label>
          <label>
            Student code
            <PasswordInput value={studentCode} onChange={(e) => setStudentCode(e.target.value)} minLength={4} required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </>
  )
}

function CommunityHoursSection({ teamId }) {
  const { settings, loading } = useCommunitySettings(teamId)
  const [hoursTarget, setHoursTarget] = useState('')
  const [types, setTypes] = useState([])
  const [typeInput, setTypeInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  // Community settings load asynchronously (independently of the team doc
  // that's already ready by the time this page mounts), so syncing local
  // state on every settings change would either show a flash of empty
  // defaults or clobber in-progress edits. Sync exactly once, the first
  // time real data arrives for this team - and again if the admin switches
  // teams while on this page.
  const [syncedFor, setSyncedFor] = useState(null)

  useEffect(() => {
    if (!loading && syncedFor !== teamId) {
      setHoursTarget(settings.hoursTarget || '')
      setTypes(settings.types || [])
      setSyncedFor(teamId)
    }
  }, [loading, settings, teamId, syncedFor])

  const logHoursUrl = `${window.location.origin}/log-hours`

  async function copyLink() {
    await navigator.clipboard.writeText(logHoursUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 1500)
  }

  function addType() {
    const trimmed = typeInput.trim()
    if (!trimmed || types.includes(trimmed)) return
    setTypes([...types, trimmed])
    setTypeInput('')
  }

  function renameType(index, newValue) {
    setTypes(types.map((t, i) => (i === index ? newValue : t)))
  }

  function removeType(index) {
    setTypes(types.filter((_, i) => i !== index))
  }

  function moveType(index, direction) {
    setTypes(swapNeighbours(types, (_, i) => i === index, direction))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const cleanTypes = types.map((t) => t.trim()).filter(Boolean)
    await setCommunitySettings(teamId, { hoursTarget: Number(hoursTarget) || 0, types: cleanTypes })
    setSaving(false)
    setSaved(true)
  }

  return (
    <>
      <h2>Community hours</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Set how many hours each student needs, and the types of community work students can log from
        the public hour-logging page. Edit a type's name in place, or remove it with ×.
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>
        Students log their hours at{' '}
        <a href="/log-hours" target="_blank" rel="noreferrer">
          {logHoursUrl}
        </a>{' '}
        <button type="button" className="link-btn" onClick={copyLink}>
          {copiedLink ? 'Copied!' : 'Copy link'}
        </button>
        <br />
        They'll need the team number and the student code from above.
      </p>
      <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 420 }}>
        <label>
          Required hours per student
          <input
            type="number"
            min="0"
            step="0.5"
            value={hoursTarget}
            onChange={(e) => setHoursTarget(e.target.value)}
          />
        </label>

        <label style={{ marginTop: 10 }}>Community types</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {types.length === 0 && <span className="muted">None yet</span>}
          {types.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <MoveButtons
                onUp={() => moveType(i, -1)}
                onDown={() => moveType(i, 1)}
                canUp={i > 0}
                canDown={i < types.length - 1}
              />
              <input
                value={t}
                onChange={(e) => renameType(i, e.target.value)}
                style={{ fontSize: 13, padding: '5px 8px', flex: 1 }}
              />
              <button
                type="button"
                className="link-btn danger"
                onClick={() => removeType(i)}
                aria-label={`Remove ${t}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={typeInput}
            onChange={(e) => setTypeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addType()
              }
            }}
            placeholder="e.g. Outreach"
            style={{ fontSize: 13, padding: '5px 8px' }}
          />
          <button type="button" className="secondary" onClick={addType} style={{ fontSize: 13, padding: '5px 10px' }}>
            Add
          </button>
        </div>

        <div className="form-actions" style={{ marginTop: 10 }}>
          {saved && <span className="muted">Saved.</span>}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </>
  )
}

function DivisionRow({
  row,
  canUp,
  canDown,
  onMove,
  onRename,
  onRemove,
  onAddSub,
  onRenameSub,
  onRemoveSub,
  onMoveSub,
}) {
  const [subInput, setSubInput] = useState('')

  function submitSub() {
    onAddSub(subInput)
    setSubInput('')
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <MoveButtons onUp={() => onMove(-1)} onDown={() => onMove(1)} canUp={canUp} canDown={canDown} />
        <input
          value={row.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Division name, e.g. Mechanical"
          style={{ flex: 1 }}
        />
        <button type="button" className="link-btn danger" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {row.subdivisions.map((sub, i) => (
          <div key={sub.key} style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 24 }}>
            <MoveButtons
              onUp={() => onMoveSub(sub.key, -1)}
              onDown={() => onMoveSub(sub.key, 1)}
              canUp={i > 0}
              canDown={i < row.subdivisions.length - 1}
            />
            <input
              value={sub.name}
              onChange={(e) => onRenameSub(sub.key, e.target.value)}
              style={{ fontSize: 13, padding: '5px 8px', flex: 1 }}
            />
            <button
              type="button"
              className="link-btn danger"
              onClick={() => onRemoveSub(sub.key)}
              aria-label={`Remove ${sub.name}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {/* Not a <form>: this row already lives inside the page's outer settings
          form, and nested forms are invalid HTML (the browser will hoist
          this one out, causing a real page submit instead of the handler). */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          value={subInput}
          onChange={(e) => setSubInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitSub()
            }
          }}
          placeholder="Add a subdivision (optional)"
          style={{ fontSize: 13, padding: '5px 8px' }}
        />
        <button type="button" className="secondary" onClick={submitSub} style={{ fontSize: 13, padding: '5px 10px' }}>
          Add
        </button>
      </div>
    </div>
  )
}
