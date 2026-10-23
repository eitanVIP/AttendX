import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import MoveButtons from '../components/MoveButtons'
import PasswordInput, { RevealButton } from '../components/PasswordInput'
import DataTable from '../components/DataTable'
import { DEFAULT_ACCENT } from '../lib/theme'
import { useCommunitySettings, useEvents, useProducts, usePurchases, useTrainings } from '../lib/firestore-hooks'
import { DEFAULT_LOG_RETENTION_DAYS, DEFAULT_STREAK_RESET_DAYS, formatDate, movedTo, oldPackPurchases, todayISO } from '../lib/calc'
import { DEFAULT_CURRENCY_RATES, convertPrice, fetchUsdRate } from '../lib/currency'
import { evaluateFormula, isReservedFieldName, isValidFieldName } from '../lib/formula'
import { exportOfflineSite } from '../lib/offlineExport'
import {
  addEvent,
  deleteEvent,
  fixOldPackPurchases,
  migrateConsumableCategoriesToProducts,
  setCommunitySettings,
  syncAllDatesToCalendar,
  updateCategories,
  updateEvent,
  updateProductTypes,
  updateSuppliers,
  updateTeam,
  updateTeamStructure,
} from '../lib/actions'
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarState,
  getRememberedGoogleAccount,
  isGoogleCalendarConfigured,
  isGoogleCalendarConnected,
  subscribeGoogleCalendar,
} from '../lib/googleCalendar'

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

// The page is split into tabs so it isn't one long scroll of a dozen
// sections. The open tab lives in the URL hash (/settings#products), so a
// link can point straight at one and a reload keeps your place.
const SETTINGS_TABS = [
  { id: 'team', label: 'Team' },
  { id: 'products', label: 'Products' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'account', label: 'Account & data' },
]

function tabFromHash() {
  const id = window.location.hash.slice(1)
  return SETTINGS_TABS.some((t) => t.id === id) ? id : 'team'
}

export default function Settings() {
  const { team } = useAuth()
  const [tab, setTab] = useState(tabFromHash)

  // Following a /settings#products link while already on Settings changes
  // only the hash, which doesn't remount the page.
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function selectTab(id) {
    setTab(id)
    window.history.replaceState(null, '', `#${id}`)
  }

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

      <div className="settings-tabs" role="tablist">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'settings-tab active' : 'settings-tab'}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted and is just hidden: a section's unsaved
          edits (rows typed into Suppliers, a half-edited division) survive
          switching tabs instead of being thrown away. */}
      <div className="settings-columns" hidden={tab !== 'team'}>
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

        <div className="settings-section">
          <h2>Team number</h2>
          <p className="muted">
            <code>{team?.id}</code> - what people enter to join the team or log hours, together with
            the matching code. It can't be changed.
          </p>
        </div>

        <CodesSection team={team} />
      </div>

      <div className="settings-columns" hidden={tab !== 'products'}>
        <BudgetSection team={team} />
        <CategoriesSection team={team} />
        <SuppliersSection team={team} />
        <ProductTypesSection team={team} />
        <CurrenciesSection team={team} />
      </div>

      <div className="settings-columns" hidden={tab !== 'schedule'}>
        <EventsSection teamId={team?.id} />
        <CommunityHoursSection teamId={team?.id} />
      </div>

      <div className="settings-columns" hidden={tab !== 'account'}>
        <AccountSection />
        <GoogleCalendarSection teamId={team?.id} />
        <OfflineExportSection />
      </div>
    </div>
  )
}

function OfflineExportSection() {
  const [status, setStatus] = useState('idle') // 'idle' | 'running' | 'done'
  const [progress, setProgress] = useState(null) // { current, total, label }
  const [failed, setFailed] = useState([])

  async function handleExport() {
    setStatus('running')
    setFailed([])
    const result = await exportOfflineSite((current, total, label) => setProgress({ current, total, label }))
    if (result.cancelled) {
      setStatus('idle')
      return
    }
    setFailed(result.failed)
    setStatus('done')
  }

  return (
    <div className="settings-section">
      <h2>
        Offline export <span className="badge badge-warn">Beta</span>
      </h2>
      <p className="muted">
        Beta - this only partially works so far; treat it as a rough backup, not something to rely on.
        Saves every page in the main menu (Dashboard, Students, Attendance, Trainings, Certifications,
        Inventory, Orders, Bought items, Systems, Settings, System log) as plain HTML files you can open
        with no internet - handy at a competition with no wifi. The links between them work offline too,
        as long as the files stay together in whatever folder you pick. Individual student profiles
        aren't included. Each file freezes whatever's on screen the moment you click; nothing on it stays
        live, and nothing you do on an exported page changes the real database. In Chrome/Edge this asks
        you to pick a folder first; other browsers download each page instead, into an "attendx-offline"
        folder under your regular Downloads.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="secondary" onClick={handleExport} disabled={status === 'running'}>
          {status === 'running' ? 'Exporting…' : 'Export offline site'}
        </button>
        {status === 'running' && progress && (
          <span className="muted">
            {progress.label} ({progress.current}/{progress.total})
          </span>
        )}
        {status === 'done' && failed.length === 0 && <span className="muted">Done.</span>}
        {status === 'done' && failed.length > 0 && (
          <span className="form-error">Done, but couldn't render: {failed.join(', ')}.</span>
        )}
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
    if (editingId) updateEvent(teamId, editingId, form, events.find((e) => e.id === editingId))
    else addEvent(teamId, form)
    setShowForm(false)
  }

  async function handleDelete(event) {
    if (!confirm(`Delete "${event.name}"?`)) return
    await deleteEvent(teamId, event)
  }

  const columns = [
    { key: 'name', header: 'Event', spread: true, cell: (event) => event.name },
    { key: 'date', header: 'Date', cellClassName: 'muted', cell: (event) => formatDate(event.date) },
    {
      key: 'actions',
      header: '',
      cell: (event) => (
        <div className="row-actions">
          <button type="button" className="link-btn" onClick={() => startEdit(event)}>
            Edit
          </button>
          <button type="button" className="link-btn danger" onClick={() => handleDelete(event)}>
            Delete
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="settings-section">
      <h2>Events</h2>
      <p className="muted">
        Upcoming events count down on the dashboard, nearest first. Past ones drop off the dashboard
        but stay here until you delete them.
      </p>
      <DataTable
        columns={columns}
        rows={events}
        rowClassName={(event) => (event.date < today ? 'row-inactive' : '')}
        emptyMessage="No events yet."
        style={{ maxWidth: 560 }}
      />
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

function subsToRows(names) {
  return (names || []).map((name, i) => ({ key: `${name}-${i}`, original: name, name }))
}

function teamToCategoryRows(team) {
  return (team?.categories || []).map((name, i) => ({
    key: `${name}-${i}`,
    original: name,
    name,
    subs: subsToRows(team?.subcategories?.[name]),
    subInput: '',
  }))
}

// Mirrors the flat community-types editor below, with each category
// optionally holding its own short list of subcategories (team.subcategories,
// { category: [names] }) - one level only, no sub-subcategories. Renaming or
// removing either here rewrites every product that used the old name (see
// updateCategories).
function CategoriesSection({ team }) {
  const [rows, setRows] = useState(teamToCategoryRows(team))
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [migrating, setMigrating] = useState(false)
  // Only teams that had the old category-level flag set need this at all -
  // see migrateConsumableCategoriesToProducts in actions.js.
  const { data: products } = useProducts(team?.id)
  const legacyConsumableCategories = team?.consumableCategories || []

  useEffect(() => {
    setRows(teamToCategoryRows(team))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  function addCategory() {
    const trimmed = input.trim()
    if (!trimmed || rows.some((r) => r.name === trimmed)) return
    setRows([...rows, { key: `new-${Date.now()}`, original: null, name: trimmed, subs: [], subInput: '' }])
    setInput('')
  }

  function updateRow(key, update) {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...update(r) } : r)))
  }

  function addSubcategory(key) {
    updateRow(key, (r) => {
      const trimmed = r.subInput.trim()
      if (!trimmed || r.subs.some((s) => s.name === trimmed)) return {}
      return { subs: [...r.subs, { key: `new-${Date.now()}`, original: null, name: trimmed }], subInput: '' }
    })
  }

  function renameSubcategory(key, subKey, value) {
    updateRow(key, (r) => ({ subs: r.subs.map((s) => (s.key === subKey ? { ...s, name: value } : s)) }))
  }

  function removeSubcategory(key, subKey) {
    updateRow(key, (r) => ({ subs: r.subs.filter((s) => s.key !== subKey) }))
  }

  function renameCategory(key, value) {
    setRows(rows.map((r) => (r.key === key ? { ...r, name: value } : r)))
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
    // Same idea one level down, keyed by the category's NEW name. A
    // category with no subcategories is left out of the map entirely.
    const subcategories = {}
    const subcategoryRenames = {}
    for (const r of cleanRows) {
      const subs = r.subs.map((s) => ({ ...s, name: s.name.trim() })).filter((s) => s.name)
      const names = [...new Set(subs.map((s) => s.name))]
      if (names.length) subcategories[r.name] = names
      for (const s of subs) {
        if (s.original && s.original !== s.name) {
          subcategoryRenames[r.name] = { ...subcategoryRenames[r.name], [s.original]: s.name }
        }
      }
    }
    await updateCategories(team.id, categories, renames, subcategories, subcategoryRenames)
    setRows(
      categories.map((name, i) => ({
        key: `${name}-${i}`,
        original: name,
        name,
        subs: subsToRows(subcategories[name]),
        subInput: '',
      }))
    )
    setSaving(false)
    setSaved(true)
  }

  async function handleMigrateConsumable() {
    setMigrating(true)
    await migrateConsumableCategoriesToProducts(team.id, products, legacyConsumableCategories)
    setMigrating(false)
  }

  return (
    <div className="settings-section">
      <h2>Product categories</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        The categories offered when adding a product in Inventory or Orders. Edit a name in place,
        or remove it with Remove - changes save when you click Save below, and reach every product
        already using that category. Each category can optionally have subcategories (one level) -
        they show up as an extra dropdown in the product form and as filter chips once that category
        is picked. Categories don't get budgets of their own - the dashboard shows how the total
        budget (set just above) is being split between them, from the Orders tab. Whether
        a product is consumable - actually used up once a system claims it, rather than merely
        reserved - is set per product now, in Inventory/Orders' own product form, not here.
      </p>
      {legacyConsumableCategories.length > 0 && (
        <p className="card form-card" style={{ maxWidth: 520, marginBottom: 12, fontSize: 13 }}>
          Consumable used to be set per category here - {legacyConsumableCategories.join(', ')} still{' '}
          {legacyConsumableCategories.length === 1 ? 'is' : 'are'} flagged the old way. Run this once to
          carry that onto every product already in {legacyConsumableCategories.length === 1 ? 'it' : 'them'}, so
          nothing needs to be re-ticked by hand.
          <span className="form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" onClick={handleMigrateConsumable} disabled={migrating}>
              {migrating ? 'Migrating…' : 'Migrate to per-product Consumable'}
            </button>
          </span>
        </p>
      )}
      <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.length === 0 && <span className="muted">None yet</span>}
          {rows.map((r, i) => (
            <div key={r.key}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={() => removeCategory(r.key)}
                  aria-label={`Remove ${r.name}`}
                >
                  Remove
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 4px 32px' }}>
                {r.subs.map((s) => (
                  <div key={s.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="muted" aria-hidden="true">↳</span>
                    <input
                      value={s.name}
                      onChange={(e) => renameSubcategory(r.key, s.key, e.target.value)}
                      aria-label={`Subcategory of ${r.name}`}
                      style={{ fontSize: 12, padding: '4px 8px', flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => removeSubcategory(r.key, s.key)}
                      aria-label={`Remove ${s.name}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="muted" aria-hidden="true">↳</span>
                  <input
                    value={r.subInput}
                    onChange={(e) => updateRow(r.key, () => ({ subInput: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addSubcategory(r.key)
                      }
                    }}
                    placeholder="Add subcategory (optional)"
                    aria-label={`New subcategory of ${r.name}`}
                    style={{ fontSize: 12, padding: '4px 8px', flex: 1, minWidth: 0 }}
                  />
                  <button type="button" className="link-btn" onClick={() => addSubcategory(r.key)}>
                    Add
                  </button>
                </div>
              </div>
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

// One total budget for the whole team, in the preferred currency. How it's
// being split across categories isn't entered anywhere - the dashboard works
// that out from the Orders tab (bought + still to buy) and shows whether the
// total still fits under this number.
function BudgetSection({ team }) {
  const [value, setValue] = useState(String(team?.totalBudget || ''))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const preferred = team?.preferredCurrency || 'NIS'

  useEffect(() => {
    setValue(String(team?.totalBudget || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    // Blank or 0 just means "no budget set".
    await updateTeam(team.id, { totalBudget: Math.max(0, Number(value) || 0) })
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="settings-section">
      <h2>Budget</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        The most the team plans to spend in total, in {preferred}. The dashboard compares it with
        what's been bought plus everything still on the Orders list, and warns when that goes over.
        You don't split it between categories - that comes from Orders.
      </p>
      <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
        <label>
          Total budget ({preferred})
          <input
            type="number"
            min="0"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="No budget set"
          />
        </label>
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

function teamToSupplierRows(team) {
  return (team?.suppliers || []).map((s, i) => ({
    key: `${s.name}-${i}`,
    original: s.name,
    name: s.name,
    multiplier: String(s.multiplier ?? 1),
    shipping: s.shipping ? String(s.shipping) : '',
  }))
}

// The list the product form's Supplier dropdown offers (team.suppliers,
// [{ name, multiplier }]). Multiplier is what a reseller charges relative to
// the listed price (1.6 = pay 1.6x) - applied automatically to every product
// bought through that supplier (see effectivePrice in calc.js), so the price
// on a product stays the manufacturer's own listed one. Renaming a supplier
// here carries over to its products (see updateSuppliers).
function SuppliersSection({ team }) {
  const [rows, setRows] = useState(teamToSupplierRows(team))
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const { data: products } = useProducts(team?.id)

  // Suppliers typed onto products before this became a list, that the list
  // doesn't have yet in any spelling - each under its most common spelling.
  const unlistedSuppliers = (() => {
    const listed = new Set(rows.map((r) => r.name.trim().toLowerCase()))
    const spellings = new Map()
    for (const p of products) {
      const name = (p.supplier || '').trim()
      const key = name.toLowerCase()
      if (!name || listed.has(key)) continue
      const counts = spellings.get(key) || new Map()
      counts.set(name, (counts.get(name) || 0) + 1)
      spellings.set(key, counts)
    }
    return [...spellings.values()].map((counts) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0])
  })()

  function addUnlistedSuppliers() {
    setRows([
      ...rows,
      ...unlistedSuppliers.map((name, i) => ({ key: `new-${Date.now()}-${i}`, original: null, name, multiplier: '1', shipping: '' })),
    ])
  }

  useEffect(() => {
    setRows(teamToSupplierRows(team))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  function addSupplier() {
    const trimmed = input.trim()
    if (!trimmed || rows.some((r) => r.name === trimmed)) return
    setRows([...rows, { key: `new-${Date.now()}`, original: null, name: trimmed, multiplier: '1', shipping: '' }])
    setInput('')
  }

  function updateRow(key, changes) {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...changes } : r)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    const cleanRows = rows.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name)
    // A blank, zero or negative multiplier just means "no markup".
    // Shipping is optional: left off entirely when blank or 0.
    const suppliers = cleanRows.map((r) => ({
      name: r.name,
      multiplier: Number(r.multiplier) > 0 ? Number(r.multiplier) : 1,
      ...(Number(r.shipping) > 0 ? { shipping: Number(r.shipping) } : {}),
    }))
    const renames = {}
    for (const r of cleanRows) {
      if (r.original && r.original !== r.name) renames[r.original] = r.name
    }
    await updateSuppliers(team.id, suppliers, renames)
    setRows(
      suppliers.map((s, i) => ({
        key: `${s.name}-${i}`,
        original: s.name,
        name: s.name,
        multiplier: String(s.multiplier),
        shipping: s.shipping ? String(s.shipping) : '',
      }))
    )
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="settings-section">
      <h2>Suppliers</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        The suppliers offered when adding a product. Multiplier is what that supplier charges relative
        to the listed price - for a reseller who sells you WCP, VEX or CTRE parts at 1.6x, enter 1.6
        and keep each product's price as the manufacturer's listed one. Every total, the orders export
        and logged purchases then include the markup automatically. Leave it at 1 for no markup.
        Renaming a supplier updates its products; removing one leaves them with the old name as
        plain text. Saving also fixes products that spell a listed supplier differently (e.g.
        "saad robot" becomes "Saad robot"). Shipping is optional - what one order from that
        supplier usually costs to ship, in {team?.preferredCurrency || 'NIS'}; the dashboard adds it to
        the projection once for every supplier you still have something to buy from.
      </p>
      <form className="card form-card" onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.length === 0 && <span className="muted">None yet</span>}
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={r.name}
                onChange={(e) => updateRow(r.key, { name: e.target.value })}
                aria-label="Supplier name"
                style={{ fontSize: 13, padding: '5px 8px', flex: 1, minWidth: 0 }}
              />
              <span className="muted">×</span>
              <input
                type="number"
                min="0"
                step="any"
                value={r.multiplier}
                onChange={(e) => updateRow(r.key, { multiplier: e.target.value })}
                aria-label={`Price multiplier for ${r.name}`}
                title="Price multiplier"
                style={{ fontSize: 13, padding: '5px 8px', width: 80 }}
              />
              <input
                type="number"
                min="0"
                step="any"
                value={r.shipping}
                onChange={(e) => updateRow(r.key, { shipping: e.target.value })}
                placeholder="Shipping"
                aria-label={`Shipping per order for ${r.name}`}
                title="Shipping per order (optional)"
                style={{ fontSize: 13, padding: '5px 8px', width: 90 }}
              />
              <button
                type="button"
                className="link-btn danger"
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
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
                addSupplier()
              }
            }}
            placeholder="e.g. Saad Robot"
            style={{ fontSize: 13, padding: '5px 8px' }}
          />
          <button type="button" className="secondary" onClick={addSupplier} style={{ fontSize: 13, padding: '5px 10px' }}>
            Add
          </button>
        </div>
        {unlistedSuppliers.length > 0 && (
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
            Products also use {unlistedSuppliers.join(', ')}.{' '}
            <button type="button" className="link-btn" onClick={addUnlistedSuppliers}>
              Add {unlistedSuppliers.length === 1 ? 'it' : 'them'} to the list
            </button>
          </p>
        )}
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

const emptyProductType = { name: '', fields: [], toBuyFormula: '', totalPriceFormula: '', packSizeKey: '' }

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
// calc.js). Renaming a type, or renaming one of its fields, carries every
// product already using it over to the new name (see updateProductTypes)
// so their custom field values stay attached instead of silently
// disappearing from the form; deleting a type or a field still just leaves
// those products' stored values as-is, unreferenced, the same as it always
// has. Fields are tracked in `form.fields` as { key, original, name } (key
// is a stable identity for reordering, `original` is the field's saved
// name or null for one just added in this edit) rather than plain strings,
// the same reason CategoriesSection's rows aren't - a plain string array
// can't tell "renamed in place" apart from "removed one, added another"
// once fields have also been reordered.
function ProductTypesSection({ team }) {
  const types = team?.productTypes || []
  const [showForm, setShowForm] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [form, setForm] = useState(emptyProductType)
  const [fieldInput, setFieldInput] = useState('')
  const [error, setError] = useState('')
  const { data: products } = useProducts(team?.id)
  const { data: purchases } = usePurchases(team?.id)
  const [fixing, setFixing] = useState(false)
  // Purchases logged before a type had a pack size only added packs to stock
  // - offered as a one-time fix once the pack size is set.
  const oldPackFixes = oldPackPurchases(purchases, products, types)

  async function handleFixOldPacks() {
    const units = oldPackFixes.reduce((sum, f) => sum + f.purchase.quantity * (f.packSize - 1), 0)
    if (!confirm(`Add the missing ${units} units to stock across ${oldPackFixes.length} purchase(s)? Only do this once - check below that these are right.`)) return
    setFixing(true)
    await fixOldPackPurchases(team.id, oldPackFixes)
    setFixing(false)
  }

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
    setForm({
      name: t.name,
      fields: t.fields.map((f, i) => ({ key: `${f}-${i}`, original: f, name: f })),
      toBuyFormula: t.toBuyFormula || '',
      totalPriceFormula: t.totalPriceFormula || '',
      // Tracked by the field row's key, not its name, so renaming the field
      // in this same edit keeps it selected.
      packSizeKey: t.packSizeField ? `${t.packSizeField}-${t.fields.indexOf(t.packSizeField)}` : '',
    })
    setFieldInput('')
    setError('')
    setShowForm(true)
  }

  function addField() {
    const trimmed = fieldInput.trim()
    if (!trimmed || form.fields.some((r) => r.name === trimmed)) return
    if (isReservedFieldName(trimmed)) {
      setError(`"${trimmed}" is reserved for the to-buy/total-price formulas below - pick another name.`)
      return
    }
    if (!isValidFieldName(trimmed)) {
      setError(`"${trimmed}" isn't a valid field name - it can't start and end with "__", or contain "/".`)
      return
    }
    setForm({ ...form, fields: [...form.fields, { key: `new-${Date.now()}`, original: null, name: trimmed }] })
    setFieldInput('')
    setError('')
  }

  function renameField(key, value) {
    setForm({ ...form, fields: form.fields.map((r) => (r.key === key ? { ...r, name: value } : r)) })
  }

  function removeField(key) {
    setForm({ ...form, fields: form.fields.filter((r) => r.key !== key) })
  }

  function moveField(key, direction) {
    setForm({ ...form, fields: swapNeighbours(form.fields, (r) => r.key === key, direction) })
  }

  function moveFieldTo(key, toIndex) {
    setForm({ ...form, fields: movedTo(form.fields, form.fields.findIndex((r) => r.key === key), toIndex) })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const name = form.name.trim()
    const cleanFields = form.fields.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name)
    const fields = cleanFields.map((r) => r.name)
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
    const packRow = cleanFields.find((r) => r.key === form.packSizeKey)
    if (packRow) nextType.packSizeField = packRow.name
    const nextTypes = [...types]
    // Only editing an existing type (not adding a new one) can have
    // products already pointing at it - `typeName` is what they're
    // currently keyed under, so it still matches even when the type's own
    // name is also changing in this same edit (see updateProductTypes).
    const originalTypeName = editingIndex !== null ? types[editingIndex].name : null
    const rename = originalTypeName && originalTypeName !== name ? { from: originalTypeName, to: name } : null
    const fieldRenames = Object.fromEntries(
      cleanFields.filter((r) => r.original && r.original !== r.name).map((r) => [r.original, r.name])
    )
    if (editingIndex === null) nextTypes.push(nextType)
    else nextTypes[editingIndex] = nextType
    updateProductTypes(team.id, nextTypes, { typeName: originalTypeName, rename, fieldRenames })
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
      {oldPackFixes.length > 0 && (
        <div className="card form-card" style={{ maxWidth: 520, marginBottom: 12, fontSize: 13 }}>
          <p style={{ marginTop: 0 }}>
            {oldPackFixes.length} purchase{oldPackFixes.length === 1 ? ' was' : 's were'} logged in packs before
            pack sizes were set up, so they added packs to stock instead of units:
          </p>
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, maxHeight: 160, overflowY: 'auto' }}>
            {oldPackFixes.map(({ purchase, product, packSize }) => (
              <li key={purchase.id}>
                {product.name}: {purchase.quantity} pack{purchase.quantity === 1 ? '' : 's'} of {packSize} - adds the
                missing {purchase.quantity * (packSize - 1)}
              </li>
            ))}
          </ul>
          <span className="form-actions">
            <button type="button" className="secondary" onClick={handleFixOldPacks} disabled={fixing}>
              {fixing ? 'Fixing…' : 'Fix their stock'}
            </button>
          </span>
        </div>
      )}
      <DataTable
        columns={[
          { key: 'name', header: 'Type', cell: (t) => t.name },
          { key: 'fields', header: 'Fields', spread: true, cellClassName: 'muted', cell: (t) => t.fields.join(', ') || '—' },
          {
            key: 'actions',
            header: '',
            cell: (t, { index }) => (
              <div className="row-actions">
                <button type="button" className="link-btn" onClick={() => startEdit(index)}>
                  Edit
                </button>
                <button type="button" className="link-btn danger" onClick={() => handleDelete(index)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
        rows={types}
        getRowId={(t) => t.name}
        emptyMessage="No custom product types yet."
        style={{ maxWidth: 420 }}
      />
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
          {form.fields.map((r, i) => (
            <div key={r.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <MoveButtons
                onUp={() => moveField(r.key, -1)}
                onDown={() => moveField(r.key, 1)}
                canUp={i > 0}
                canDown={i < form.fields.length - 1}
                index={i}
                count={form.fields.length}
                onMoveTo={(toIndex) => moveFieldTo(r.key, toIndex)}
                label="field"
              />
              <input
                value={r.name}
                onChange={(e) => renameField(r.key, e.target.value)}
                style={{ fontSize: 13, padding: '5px 8px', flex: 1, minWidth: 0 }}
              />
              <button type="button" className="link-btn danger" onClick={() => removeField(r.key)} aria-label={`Remove ${r.name}`}>
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
          Pack size field (optional)
          <select value={form.packSizeKey} onChange={(e) => setForm({ ...form, packSizeKey: e.target.value })}>
            <option value="">None - bought one at a time</option>
            {form.fields
              .filter((r) => r.name.trim())
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          For things bought in packs (e.g. screws in bags of 50): pick the field holding how many come
          in one pack. Logging a purchase on Orders then counts in packs - the price is per pack, and
          stock goes up by packs × that number. Your to-buy formula should count packs too, e.g.{' '}
          <code>ceil(max(wanted - stock, 0) / int(custom.PackSize))</code>.
        </p>

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

// Client-side only (see googleCalendar.js) - connecting signs into
// whichever Google account should own the events (the team's own shared
// account, not each admin's personal one) and keeps the token in memory
// for this tab only, never persisted. That means it has to be reconnected
// once a session (or once it expires, roughly an hour) before automatic
// sync on create/edit reaches Google again - "Add every existing date" is
// the reliable catch-up for whatever was created while nobody was
// connected, run it any time after reconnecting to be sure everything's
// caught up.
function GoogleCalendarSection({ teamId }) {
  const [calendarState, setCalendarState] = useState(getGoogleCalendarState())
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncedMessage, setSyncedMessage] = useState('')
  const { data: events } = useEvents(teamId)
  const { data: allTrainings } = useTrainings(teamId)

  useEffect(() => subscribeGoogleCalendar(setCalendarState), [])

  const configured = isGoogleCalendarConfigured()
  const connected = isGoogleCalendarConnected()
  // Connected before this page load (or before the token's hour ran out) but
  // no token right now - not the same as never connected: the next click
  // renews it on its own (see ensureGoogleCalendarToken).
  const remembered = !connected ? getRememberedGoogleAccount() : null

  async function handleConnect() {
    setError('')
    setConnecting(true)
    try {
      await connectGoogleCalendar()
    } catch (e) {
      setError(e.message)
    }
    setConnecting(false)
  }

  async function handleSyncAll() {
    setError('')
    setSyncedMessage('')
    setSyncing(true)
    const trainings = allTrainings.filter((t) => !t.parentTrainingId)
    try {
      const { synced, failed } = await syncAllDatesToCalendar(teamId, { events, trainings })
      setSyncedMessage(
        `Added/updated ${synced} date${synced === 1 ? '' : 's'} on the calendar.` +
          (failed ? ` ${failed} failed - click again to retry just those (the rest won't be duplicated).` : '')
      )
    } catch (e) {
      setError(e.message)
    }
    setSyncing(false)
  }

  return (
    <div className="settings-section">
      <h2>Google Calendar</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Once connected, every event, training due date, and certification target date automatically
        gets an all-day entry on the connected Google account's calendar as it's created or edited -
        and comes off it again if it's deleted or its date is cleared. Connect using the team's own
        shared Google account, not a personal one, so everything lands in one place.
      </p>
      {!configured ? (
        <p className="card form-card" style={{ maxWidth: 520, fontSize: 13 }}>
          This deployment doesn't have a Google Calendar client ID set up yet
          (<code>VITE_GOOGLE_CLIENT_ID</code>). In Google Cloud Console, for this same project: enable the
          Google Calendar API, configure the OAuth consent screen (add the team's Google account as a test
          user if it stays in Testing), then create an OAuth 2.0 Client ID (Web application) with this
          site's URL under Authorized JavaScript origins. Put the resulting client ID in the deploy's{' '}
          <code>.env.local</code> as <code>VITE_GOOGLE_CLIENT_ID</code> and rebuild.
        </p>
      ) : (
        <div className="card form-card" style={{ maxWidth: 520 }}>
          <p style={{ margin: 0 }}>
            {connected ? (
              <>
                Connected{calendarState.email ? ` as ${calendarState.email}` : ''}.{' '}
                <span className="muted">
                  Google's token lasts about an hour; after a reload or once it runs out it renews itself on
                  your next click.
                </span>
              </>
            ) : remembered ? (
              <>
                {calendarState.reconnecting ? 'Reconnecting…' : 'Waiting to reconnect.'}{' '}
                <span className="muted">
                  {remembered.email ? `${remembered.email} was connected. ` : ''}
                  Syncing is paused until Google hands back a fresh token - that happens on your next click
                  anywhere in the app, and any save renews it first. If it doesn't, use Connect below.
                </span>
              </>
            ) : (
              <span className="muted">Not connected - nothing syncs to a calendar right now.</span>
            )}
          </p>
          {error && <p className="form-error">{error}</p>}
          {syncedMessage && <p className="muted">{syncedMessage}</p>}
          <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
            {connected ? (
              <button type="button" className="secondary" onClick={disconnectGoogleCalendar}>
                Disconnect
              </button>
            ) : (
              <button type="button" onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Connect Google Calendar'}
              </button>
            )}
            <button type="button" className="secondary" onClick={handleSyncAll} disabled={!connected || syncing}>
              {syncing ? 'Adding…' : 'Add every existing date'}
            </button>
          </div>
        </div>
      )}
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
