import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useCommunitySettings } from '../lib/firestore-hooks'
import { setCommunitySettings, updateTeam } from '../lib/actions'

function teamToDivisionRows(team) {
  const divisions = team?.divisions || []
  const subs = team?.subdivisionsByDivision || {}
  return divisions.map((name, i) => ({ key: `${name}-${i}`, name, subdivisions: subs[name] || [] }))
}

export default function Settings() {
  const { team } = useAuth()
  const [name, setName] = useState(team?.name || '')
  const [colorPrimary, setColorPrimary] = useState(team?.colorPrimary || '#2563eb')
  const [rows, setRows] = useState(teamToDivisionRows(team))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Team docs can change from elsewhere (or arrive after this page's first
  // render) - keep the editable copy in sync until the admin starts typing.
  useEffect(() => {
    setName(team?.name || '')
    setColorPrimary(team?.colorPrimary || '#2563eb')
    setRows(teamToDivisionRows(team))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  function addDivision() {
    setRows([...rows, { key: `new-${Date.now()}`, name: '', subdivisions: [] }])
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
    setRows(rows.map((r) => (r.key === key ? { ...r, subdivisions: [...r.subdivisions, trimmed] } : r)))
  }

  function renameSubdivision(key, index, newName) {
    setRows(
      rows.map((r) =>
        r.key === key ? { ...r, subdivisions: r.subdivisions.map((s, i) => (i === index ? newName : s)) } : r
      )
    )
  }

  function removeSubdivision(key, index) {
    setRows(
      rows.map((r) => (r.key === key ? { ...r, subdivisions: r.subdivisions.filter((_, i) => i !== index) } : r))
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const cleanRows = rows.filter((r) => r.name.trim())
    const divisions = cleanRows.map((r) => r.name.trim())
    const subdivisionsByDivision = Object.fromEntries(
      cleanRows.map((r) => [r.name.trim(), r.subdivisions.map((s) => s.trim()).filter(Boolean)])
    )
    await updateTeam(team.id, { name, colorPrimary, divisions, subdivisionsByDivision })
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
        </div>

        <h2 style={{ marginTop: 20 }}>Divisions</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Divisions split your team into its major groups (e.g. Mechanical, Controls) - every student
          belongs to one. Subdivisions are optional, smaller groups within a division (e.g. Design vs.
          Manufacturing) for more precise training and attendance targeting - most teams can skip them.
          Edit any name in place; changes save when you click Save below.
        </p>

        <div className="division-editor">
          {rows.map((row) => (
            <DivisionRow
              key={row.key}
              row={row}
              onRename={(v) => renameDivision(row.key, v)}
              onRemove={() => removeDivision(row.key)}
              onAddSub={(v) => addSubdivision(row.key, v)}
              onRenameSub={(i, v) => renameSubdivision(row.key, i, v)}
              onRemoveSub={(i) => removeSubdivision(row.key, i)}
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

      <CodesSection team={team} />
      <CommunityHoursSection teamId={team?.id} />

      <h2>Team ID</h2>
      <p className="muted">
        <code>{team?.id}</code> - share this with anyone who needs access, along with your team code.
      </p>
    </div>
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
            <button type="button" className="link-btn" onClick={() => setReveal((r) => ({ ...r, admin: !r.admin }))}>
              {reveal.admin ? 'Hide' : 'Show'}
            </button>
            <button type="button" className="link-btn" onClick={() => copy('admin', team?.code)}>
              {copied === 'admin' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="muted" style={{ width: 80 }}>
              Student
            </span>
            <code>{reveal.student ? team?.studentCode : '••••••••'}</code>
            <button type="button" className="link-btn" onClick={() => setReveal((r) => ({ ...r, student: !r.student }))}>
              {reveal.student ? 'Hide' : 'Show'}
            </button>
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
            <input type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} minLength={4} required />
          </label>
          <label>
            Student code
            <input type="password" value={studentCode} onChange={(e) => setStudentCode(e.target.value)} minLength={4} required />
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
            <div key={i} style={{ display: 'flex', gap: 6 }}>
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

function DivisionRow({ row, onRename, onRemove, onAddSub, onRenameSub, onRemoveSub }) {
  const [subInput, setSubInput] = useState('')

  function submitSub() {
    onAddSub(subInput)
    setSubInput('')
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <input
              value={sub}
              onChange={(e) => onRenameSub(i, e.target.value)}
              style={{ fontSize: 13, padding: '5px 8px', flex: 1 }}
            />
            <button type="button" className="link-btn danger" onClick={() => onRemoveSub(i)} aria-label={`Remove ${sub}`}>
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
