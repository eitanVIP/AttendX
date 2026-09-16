import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import MoveButtons from '../components/MoveButtons'
import PasswordInput, { RevealButton } from '../components/PasswordInput'
import StickyTableScroll from '../components/StickyTableScroll'
import { DEFAULT_ACCENT } from '../lib/theme'
import { useCommunitySettings, useEvents } from '../lib/firestore-hooks'
import { DEFAULT_LOG_RETENTION_DAYS, DEFAULT_STREAK_RESET_DAYS, movedTo, todayISO } from '../lib/calc'
import { DEFAULT_CURRENCY_RATES, convertPrice, fetchUsdRate } from '../lib/currency'
import { evaluateFormula, isReservedFieldName, isValidFieldName } from '../lib/formula'
import {
  addEvent,
  deleteEvent,
  setCommunitySettings,
  updateCategories,
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
  const [streakResetDays, setStreakResetDays] = useState(String(team?.streakResetDays || DEFAULT_STREAK_RESET_DAYS))
  const [logRetentionDays, setLogRetentionDays] = useState(String(team?.logRetentionDays || DEFAULT_LOG_RETENTION_DAYS))
  const [rows, setRows] = useState(teamToDivisionRows(team))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Team docs can change from elsewhere (or arrive after this page's first
  // render) - keep the editable copy in sync until the admin starts typing.
  useEffect(() => {
    setName(team?.name || '')
    setColorPrimary(team?.colorPrimary || DEFAULT_ACCENT)
    setMinAttendance(String(team?.minAttendancePercent || 0))
    setStreakResetDays(String(team?.streakResetDays || DEFAULT_STREAK_RESET_DAYS))
    setLogRetentionDays(String(team?.logRetentionDays || DEFAULT_LOG_RETENTION_DAYS))
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

  function moveDivisionTo(key, toIndex) {
    setRows(movedTo(rows, rows.findIndex((r) => r.key === key), toIndex))
  }

  function moveSubdivision(key, subKey, direction) {
    setRows(
      rows.map((r) =>
        r.key === key ? { ...r, subdivisions: swapNeighbours(r.subdivisions, (s) => s.key === subKey, direction) } : r
      )
    )
  }

  function moveSubdivisionTo(key, subKey, toIndex) {
    setRows(
      rows.map((r) =>
        r.key === key
          ? { ...r, subdivisions: movedTo(r.subdivisions, r.subdivisions.findIndex((s) => s.key === subKey), toIndex) }
          : r
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
    const streakResetDaysValue = Math.max(1, Math.round(Number(streakResetDays) || DEFAULT_STREAK_RESET_DAYS))
    const logRetentionDaysValue = Math.max(1, Math.round(Number(logRetentionDays) || DEFAULT_LOG_RETENTION_DAYS))
    await updateTeamStructure(
      team.id,
      {
        name,
        colorPrimary,
        minAttendancePercent,
        streakResetDays: streakResetDaysValue,
        logRetentionDays: logRetentionDaysValue,
        divisions,
        subdivisionsByDivision,
      },
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

      <div className="settings-columns">
        <div className="settings-section">
          <form className="card form-card" onSubmit={handleSubmit} style={{ margin: 0 }}>
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
              <label>
                Training streak resets after (days)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={streakResetDays}
                  onChange={(e) => setStreakResetDays(e.target.value)}
                />
              </label>
              <p className="muted span-2" style={{ margin: '-6px 0 0' }}>
                A student's training streak (see their profile) resets to 0 once this many days pass
                without them completing a training.
              </p>
              <label>
                System log retention (days)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={logRetentionDays}
                  onChange={(e) => setLogRetentionDays(e.target.value)}
                />
              </label>
              <p className="muted span-2" style={{ margin: '-6px 0 0' }}>
                Every change made in this dashboard is logged with who made it and when - see the{' '}
                <Link to="/settings/log">system log</Link>. Entries older than this are cleared automatically.
              </p>
            </div>

            <h2 style={{ marginTop: 20 }}>Divisions</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              Divisions split your team into its major groups (e.g. Mechanical, Controls) - a student
              can belong to one or several. Subdivisions are optional, smaller groups within a division
              (e.g. Design vs. Manufacturing) for more precise training and attendance targeting - most
              teams can skip them. Edit any name in place; changes save when you click Save below.
              Renaming one renames it for every student in it, and removing one removes those students
              from it.
            </p>

            {/* One list, not a nested pair of columns: a division row
                (arrows + name + Remove, plus indented subdivisions) needs
                ~300px, and half of one settings column is well under that
                on ordinary screens - the rows just spill over into the
                next card. The outer .settings-columns balance copes with
                this form being tall on its own. */}
            <div className="division-editor">
              {rows.map((row, i) => (
                <DivisionRow
                  key={row.key}
                  row={row}
                  index={i}
                  count={rows.length}
                  canUp={i > 0}
                  canDown={i < rows.length - 1}
                  onMove={(direction) => moveDivision(row.key, direction)}
                  onMoveTo={(toIndex) => moveDivisionTo(row.key, toIndex)}
                  onRename={(v) => renameDivision(row.key, v)}
                  onRemove={() => removeDivision(row.key)}
                  onAddSub={(v) => addSubdivision(row.key, v)}
                  onRenameSub={(subKey, v) => renameSubdivision(row.key, subKey, v)}
                  onRemoveSub={(subKey) => removeSubdivision(row.key, subKey)}
                  onMoveSub={(subKey, direction) => moveSubdivision(row.key, subKey, direction)}
                  onMoveSubTo={(subKey, toIndex) => moveSubdivisionTo(row.key, subKey, toIndex)}
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
        </div>

        <EventsSection teamId={team?.id} />
        <CategoriesSection team={team} />
        <ProductTypesSection team={team} />
        <CurrenciesSection team={team} />
        <CodesSection team={team} />
        <CommunityHoursSection teamId={team?.id} />

        <div className="settings-section">
          <h2>Team number</h2>
          <p className="muted">
            <code>{team?.id}</code> - what people enter to join the team or log hours, together with
            the matching code. It can't be changed.
          </p>
        </div>

        <AccountSection />
      </div>
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
    <div className="settings-section">
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
    </div>
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
    await deleteEvent(teamId, event)
  }

  return (
    <div className="settings-section">
      <h2>Events</h2>
      <p className="muted">
        Upcoming events count down on the dashboard, nearest first. Past ones drop off the dashboard
        but stay here until you delete them.
      </p>
      <StickyTableScroll style={{ maxWidth: 560 }}>
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
      </StickyTableScroll>
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
    </div>
  )
}

function teamToCategoryRows(team) {
  return (team?.categories || []).map((name, i) => ({
    key: `${name}-${i}`,
    original: name,
    name,
    budget: String(team?.categoryBudgets?.[name] || ''),
  }))
}

// Mirrors the flat community-types editor below, not the nested division
// one - categories have no subcategories. Renaming or removing one here
// rewrites every product that used the old name (see updateCategories).
function CategoriesSection({ team }) {
  const [rows, setRows] = useState(teamToCategoryRows(team))
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows(teamToCategoryRows(team))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  function addCategory() {
    const trimmed = input.trim()
    if (!trimmed || rows.some((r) => r.name === trimmed)) return
    setRows([...rows, { key: `new-${Date.now()}`, original: null, name: trimmed, budget: '' }])
    setInput('')
  }

  function renameCategory(key, value) {
    setRows(rows.map((r) => (r.key === key ? { ...r, name: value } : r)))
  }

  function setBudget(key, value) {
    setRows(rows.map((r) => (r.key === key ? { ...r, budget: value } : r)))
  }

  function removeCategory(key) {
    setRows(rows.filter((r) => r.key !== key))
  }

  function moveCategory(key, direction) {
    setRows(swapNeighbours(rows, (r) => r.key === key, direction))
  }

  function moveCategoryTo(key, toIndex) {
    setRows(movedTo(rows, rows.findIndex((r) => r.key === key), toIndex))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const cleanRows = rows.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name)
    const categories = cleanRows.map((r) => r.name)
    // Only actual renames need listing (old name -> new, for rows that
    // survived under a different one) - updateCategories treats anything
    // else missing from `categories` as removed outright.
    const renames = {}
    for (const r of cleanRows) {
      if (r.original && r.original !== r.name) renames[r.original] = r.name
    }
    // A blank or zero budget just means "no budget set" - left out of the
    // map entirely rather than stored as 0, so the dashboard's budget
    // section (and the "N budgeted categories" pie weighting) only ever
    // sees categories an admin actually gave a number to.
    const categoryBudgets = Object.fromEntries(
      cleanRows.map((r) => [r.name, Math.max(0, Number(r.budget) || 0)]).filter(([, budget]) => budget > 0)
    )
    await updateCategories(team.id, categories, renames, categoryBudgets)
    setRows(categories.map((name, i) => ({ key: `${name}-${i}`, original: name, name, budget: String(categoryBudgets[name] || '') })))
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="settings-section">
      <h2>Product categories</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        The categories offered when adding a product in Inventory or Orders. Edit a name in place,
        or remove it with Remove - changes save when you click Save below, and reach every product
        already using that category. Budget is optional and isn't a hard limit - it's just what the
        dashboard's budget section compares spending against; leave it blank for "no budget".
      </p>
      <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.length === 0 && <span className="muted">None yet</span>}
          {rows.map((r, i) => (
            <div key={r.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <MoveButtons
                onUp={() => moveCategory(r.key, -1)}
                onDown={() => moveCategory(r.key, 1)}
                canUp={i > 0}
                canDown={i < rows.length - 1}
                index={i}
                count={rows.length}
                onMoveTo={(toIndex) => moveCategoryTo(r.key, toIndex)}
                label="category"
              />
              <input
                value={r.name}
                onChange={(e) => renameCategory(r.key, e.target.value)}
                style={{ fontSize: 13, padding: '5px 8px', flex: 1, minWidth: 0 }}
              />
              <input
                type="number"
                min="0"
                step="any"
                value={r.budget}
                onChange={(e) => setBudget(r.key, e.target.value)}
                placeholder="Budget"
                title="Budget"
                style={{ fontSize: 13, padding: '5px 8px', width: 90 }}
              />
              <button
                type="button"
                className="link-btn danger"
                onClick={() => removeCategory(r.key)}
                aria-label={`Remove ${r.name}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCategory()
              }
            }}
            placeholder="e.g. Electrical"
            style={{ fontSize: 13, padding: '5px 8px' }}
          />
          <button type="button" className="secondary" onClick={addCategory} style={{ fontSize: 13, padding: '5px 10px' }}>
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
    </div>
  )
}

const emptyProductType = { name: '', fields: [], toBuyFormula: '', totalPriceFormula: '' }

// Catches a genuine syntax error at save time without false-flagging a
// legitimate custom.<field> reference - every possible custom field reads
// as 1 here, so only a real parse/unknown-function problem can surface.
// Keys are lowercase because the parser lowercases every identifier it
// reads (formula.js), regardless of how the formula itself capitalizes it.
const FORMULA_PROBE_SCOPE = {
  sku: 1,
  price: 1,
  stock: 1,
  wanted: 1,
  tobuy: 1,
  convertedprice: 1,
  custom: new Proxy({}, { get: () => 1 }),
}

function validateFormula(source) {
  if (!source.trim()) return null
  return evaluateFormula(source, FORMULA_PROBE_SCOPE).error
}

// Templates for products that need more than the usual fields (see
// hasCustomData/customData in calc.js) - each one is a name, an ordered
// list of field names, and optionally a to-buy/total-price formula, edited
// one at a time in a modal (unlike Categories' flat inline list) since a
// type's own field list needs its own add/remove/reorder UI. A product
// only ever stores which type it is (by name) and its own field values -
// never a copy of the formulas - so editing a formula here changes every
// product of that type immediately (see computeToBuy/computeTotalPrice in
// calc.js). Renaming a type breaks that link for products already using
// the old name, the same as it always has for their field values; deleting
// one just leaves those products with no type match, so they fall back to
// the plain math and keep their stored field values.
function ProductTypesSection({ team }) {
  const types = team?.productTypes || []
  const [showForm, setShowForm] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [form, setForm] = useState(emptyProductType)
  const [fieldInput, setFieldInput] = useState('')
  const [error, setError] = useState('')

  function startNew() {
    setEditingIndex(null)
    setForm(emptyProductType)
    setFieldInput('')
    setError('')
    setShowForm(true)
  }

  function startEdit(index) {
    const t = types[index]
    setEditingIndex(index)
    setForm({ name: t.name, fields: [...t.fields], toBuyFormula: t.toBuyFormula || '', totalPriceFormula: t.totalPriceFormula || '' })
    setFieldInput('')
    setError('')
    setShowForm(true)
  }

  function addField() {
    const trimmed = fieldInput.trim()
    if (!trimmed || form.fields.includes(trimmed)) return
    if (isReservedFieldName(trimmed)) {
      setError(`"${trimmed}" is reserved for the to-buy/total-price formulas below - pick another name.`)
      return
    }
    if (!isValidFieldName(trimmed)) {
      setError(`"${trimmed}" isn't a valid field name - it can't start and end with "__", or contain "/".`)
      return
    }
    setForm({ ...form, fields: [...form.fields, trimmed] })
    setFieldInput('')
    setError('')
  }

  function renameField(index, value) {
    setForm({ ...form, fields: form.fields.map((f, i) => (i === index ? value : f)) })
  }

  function removeField(index) {
    setForm({ ...form, fields: form.fields.filter((_, i) => i !== index) })
  }

  function moveField(index, direction) {
    setForm({ ...form, fields: swapNeighbours(form.fields, (_, i) => i === index, direction) })
  }

  function moveFieldTo(index, toIndex) {
    setForm({ ...form, fields: movedTo(form.fields, index, toIndex) })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const name = form.name.trim()
    const fields = form.fields.map((f) => f.trim()).filter(Boolean)
    const others = types.filter((_, i) => i !== editingIndex)
    if (others.some((t) => t.name === name)) {
      setError('A product type with this name already exists.')
      return
    }
    // addField already blocks these on the way in, but a field can also be
    // renamed in place afterwards, so this is the real gate before
    // anything reaches Firestore.
    const badField = fields.find((f) => isReservedFieldName(f) || !isValidFieldName(f))
    if (badField) {
      setError(`"${badField}" isn't a usable field name - see the note above.`)
      return
    }
    const toBuyFormula = form.toBuyFormula.trim()
    const totalPriceFormula = form.totalPriceFormula.trim()
    const toBuyError = validateFormula(toBuyFormula)
    if (toBuyError) {
      setError(`To buy formula: ${toBuyError}`)
      return
    }
    const totalError = validateFormula(totalPriceFormula)
    if (totalError) {
      setError(`Total price formula: ${totalError}`)
      return
    }
    const nextType = { name, fields }
    if (toBuyFormula) nextType.toBuyFormula = toBuyFormula
    if (totalPriceFormula) nextType.totalPriceFormula = totalPriceFormula
    const nextTypes = [...types]
    if (editingIndex === null) nextTypes.push(nextType)
    else nextTypes[editingIndex] = nextType
    updateTeam(team.id, { productTypes: nextTypes })
    setShowForm(false)
  }

  async function handleDelete(index) {
    if (
      !confirm(
        `Delete the "${types[index].name}" product type? Products already using it keep their stored field values, but fall back to the plain to-buy/total-price math right away.`
      )
    )
      return
    await updateTeam(team.id, { productTypes: types.filter((_, i) => i !== index) })
  }

  return (
    <div className="settings-section">
      <h2>Product types</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Optional templates for products that need more than the usual fields - e.g. an "Aluminum
        sheet" type with Thickness, Width, and Length. Pick one when adding a product in Inventory or
        Orders to fill those in; a regular product doesn't need a type at all.
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>
        Students can request products (using these same types) from the "Request Order" tab of the
        student sign-in - see Codes below for that link. Accept or decline what they submit from the
        "Student requests" table on Orders.
      </p>
      <StickyTableScroll style={{ maxWidth: 420 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Fields</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td className="muted">{t.fields.join(', ') || '—'}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="link-btn" onClick={() => startEdit(i)}>
                      Edit
                    </button>
                    <button type="button" className="link-btn danger" onClick={() => handleDelete(i)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {types.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-cell">
                  No custom product types yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StickyTableScroll>
      <button type="button" className="secondary" onClick={startNew}>
        + New product type
      </button>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingIndex === null ? 'New product type' : 'Edit product type'}</h2>
        <div className="form-grid">
          <label className="span-2">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Aluminum sheet"
              required
            />
          </label>
        </div>

        <label style={{ marginTop: 10 }}>Fields</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.fields.length === 0 && <span className="muted">None yet</span>}
          {form.fields.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <MoveButtons
                onUp={() => moveField(i, -1)}
                onDown={() => moveField(i, 1)}
                canUp={i > 0}
                canDown={i < form.fields.length - 1}
                index={i}
                count={form.fields.length}
                onMoveTo={(toIndex) => moveFieldTo(i, toIndex)}
                label="field"
              />
              <input
                value={f}
                onChange={(e) => renameField(i, e.target.value)}
                style={{ fontSize: 13, padding: '5px 8px', flex: 1, minWidth: 0 }}
              />
              <button type="button" className="link-btn danger" onClick={() => removeField(i)} aria-label={`Remove ${f}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={fieldInput}
            onChange={(e) => setFieldInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addField()
              }
            }}
            placeholder="e.g. Thickness"
            style={{ fontSize: 13, padding: '5px 8px' }}
          />
          <button type="button" className="secondary" onClick={addField} style={{ fontSize: 13, padding: '5px 10px' }}>
            Add
          </button>
        </div>

        <label style={{ marginTop: 10 }}>
          To buy formula (optional)
          <input
            value={form.toBuyFormula}
            onChange={(e) => setForm({ ...form, toBuyFormula: e.target.value })}
            placeholder="e.g. max(wanted - stock, 0)"
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </label>
        <div className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          <p style={{ margin: '0 0 6px' }}>
            Replaces the "to buy" column in Orders for this type's products - leave it blank to keep
            the usual wanted-minus-in-stock. A formula can use:
          </p>
          <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
            <li>
              <code>sku</code>, <code>price</code> - this product's own SKU and price, as entered
            </li>
            <li>
              <code>stock</code>, <code>wanted</code> - its count in inventory and wanted count
            </li>
            <li>
              <code>custom.Width</code> (or <code>custom["Field name"]</code> for one with spaces) -
              one of this type's own fields, always text so numbers still need parsing
            </li>
            <li>
              <code>int()</code>, <code>floor()</code>, <code>ceil()</code>, <code>round()</code>,{' '}
              <code>double()</code>, <code>abs()</code>, <code>min()</code>, <code>max()</code>
            </li>
          </ul>
          <p style={{ margin: 0 }}>
            Examples: <code>max(wanted - stock, 0)</code> is the default, spelled out.{' '}
            <code>ceil(wanted / int(custom.PackSize))</code> would round up to whole packs.
          </p>
        </div>

        <label style={{ marginTop: 10 }}>
          Total price formula (optional)
          <input
            value={form.totalPriceFormula}
            onChange={(e) => setForm({ ...form, totalPriceFormula: e.target.value })}
            placeholder="e.g. convertedPrice * toBuy"
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </label>
        <div className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          <p style={{ margin: '0 0 6px' }}>
            Replaces the "total" column in Orders - leave it blank to keep the usual price × to buy.
            Everything above is available here too, plus:
          </p>
          <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
            <li>
              <code>toBuy</code> - this product's to-buy result, from the formula above (or the
              default if it's blank)
            </li>
            <li>
              <code>convertedPrice</code> - price converted to the team's preferred currency (what
              the Price column actually shows)
            </li>
          </ul>
          <p style={{ margin: 0 }}>
            Examples: <code>convertedPrice * toBuy</code> is the default, spelled out.{' '}
            <code>double(custom.PackPrice) * toBuy</code> would price it per pack instead.
          </p>
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingIndex === null ? 'Create' : 'Save'}</button>
        </div>
      </FormPanel>
    </div>
  )
}

// Prices are stored in whatever currency they were entered in and shown
// everywhere converted to whichever one is "preferred" - see convertPrice
// in currency.js. Rates live on the team doc as "units per 1 USD" so
// converting between any two is just going through USD; DEFAULT_CURRENCY_RATES
// covers teams that haven't saved their own yet.
function CurrenciesSection({ team }) {
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const [newCode, setNewCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function addCurrency() {
    const code = newCode.trim().toUpperCase()
    if (!code || rates[code]) return
    setBusy(true)
    setError('')
    try {
      const rate = await fetchUsdRate(code)
      await updateTeam(team.id, { currencyRates: { ...rates, [code]: rate } })
      setNewCode('')
    } catch {
      setError(`Couldn't look up "${code}" - check the currency code (e.g. EUR, GBP).`)
    } finally {
      setBusy(false)
    }
  }

  async function refreshRates() {
    setBusy(true)
    setError('')
    try {
      const updated = {}
      for (const code of Object.keys(rates)) updated[code] = await fetchUsdRate(code)
      await updateTeam(team.id, { currencyRates: updated })
    } catch {
      setError("Couldn't refresh rates - try again later.")
    } finally {
      setBusy(false)
    }
  }

  async function removeCurrency(code) {
    if (code === preferred) {
      alert("Can't remove the preferred currency - switch to another one first.")
      return
    }
    const { [code]: _drop, ...rest } = rates
    await updateTeam(team.id, { currencyRates: rest })
  }

  return (
    <div className="settings-section">
      <h2>Currencies</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Products can be priced in any currency below; every table shows the converted total in your
        preferred one. Rates come from a public exchange-rate service as of whenever they were added
        or last refreshed - not live.
      </p>
      <div className="card" style={{ padding: 12, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>
          Preferred currency
          <select value={preferred} onChange={(e) => updateTeam(team.id, { preferredCurrency: e.target.value })}>
            {Object.keys(rates).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <table className="data-table" style={{ margin: 0, minWidth: 0 }}>
          <thead>
            <tr>
              <th>Currency</th>
              <th>Per 1 {preferred}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(rates).map((code) => (
              <tr key={code}>
                <td>{code}</td>
                <td>{code === preferred ? 'base' : convertPrice(1, preferred, code, rates).toFixed(4)}</td>
                <td>
                  {code !== preferred && (
                    <button type="button" className="link-btn danger" onClick={() => removeCurrency(code)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCurrency()
              }
            }}
            placeholder="e.g. EUR"
            style={{ fontSize: 13, padding: '5px 8px', width: 100 }}
          />
          <button type="button" className="secondary" onClick={addCurrency} disabled={busy} style={{ fontSize: 13, padding: '5px 10px' }}>
            {busy ? 'Working…' : '+ Add currency'}
          </button>
          <button type="button" className="link-btn" onClick={refreshRates} disabled={busy}>
            Refresh rates
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
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

  const studentLoginUrl = `${window.location.origin}/student-login`

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
    <div className="settings-section">
      <h2>Codes</h2>
      <p className="muted">
        The <strong>admin code</strong> opens the full dashboard. The <strong>student code</strong> unlocks
        student sign-in, which has Community Hours, Request Order, and My Systems tabs.
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>
        Students sign in at{' '}
        <a href="/student-login" target="_blank" rel="noreferrer">
          {studentLoginUrl}
        </a>{' '}
        <button type="button" className="link-btn" onClick={() => copy('student-login-url', studentLoginUrl)}>
          {copied === 'student-login-url' ? 'Copied!' : 'Copy link'}
        </button>
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
    </div>
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

  function moveType(index, direction) {
    setTypes(swapNeighbours(types, (_, i) => i === index, direction))
  }

  function moveTypeTo(index, toIndex) {
    setTypes(movedTo(types, index, toIndex))
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
    <div className="settings-section">
      <h2>Community hours</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Set how many hours each student needs, and the types of community work students can log from
        the public hour-logging page. Edit a type's name in place, or remove it with ×.
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>
        Students log their hours from the "Community Hours" tab of the student sign-in - see Codes
        above for that link and the code they'll need.
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
                index={i}
                count={types.length}
                onMoveTo={(toIndex) => moveTypeTo(i, toIndex)}
                label="community type"
              />
              <input
                value={t}
                onChange={(e) => renameType(i, e.target.value)}
                style={{ fontSize: 13, padding: '5px 8px', flex: 1, minWidth: 0 }}
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
    </div>
  )
}

function DivisionRow({
  row,
  index,
  count,
  canUp,
  canDown,
  onMove,
  onMoveTo,
  onRename,
  onRemove,
  onAddSub,
  onRenameSub,
  onRemoveSub,
  onMoveSub,
  onMoveSubTo,
}) {
  const [subInput, setSubInput] = useState('')

  function submitSub() {
    onAddSub(subInput)
    setSubInput('')
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <MoveButtons
          onUp={() => onMove(-1)}
          onDown={() => onMove(1)}
          canUp={canUp}
          canDown={canDown}
          index={index}
          count={count}
          onMoveTo={onMoveTo}
          label="division"
        />
        <input
          value={row.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Division name, e.g. Mechanical"
          style={{ flex: 1, minWidth: 0 }}
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
              index={i}
              count={row.subdivisions.length}
              onMoveTo={(toIndex) => onMoveSubTo(sub.key, toIndex)}
              label="subdivision"
            />
            <input
              value={sub.name}
              onChange={(e) => onRenameSub(sub.key, e.target.value)}
              style={{ fontSize: 13, padding: '5px 8px', flex: 1, minWidth: 0 }}
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
