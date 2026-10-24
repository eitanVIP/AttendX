import { useEffect, useMemo, useRef, useState } from 'react'
import PerfectTable from './PerfectTable'

// Playground for lab/PerfectTable.jsx - not part of the app. Open
// http://localhost:5173/lab/ while `npm run dev` is running.

const FIRST = ['Noa', 'Yonatan', 'Maya', 'Itai', 'Tamar', 'Daniel', 'Shira', 'Omer', 'Yael', 'Ariel', 'Roni', 'Lior', 'Hila', 'Nadav', 'Michal', 'Gal', 'Amit', 'Dana', 'Tom', 'Alexandra']
const LAST = ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Avraham', 'Friedman', 'Katz', 'Shapiro', 'Ben-David', 'Azulay', 'Dahan']
const DIVISIONS = { Mechanics: ['CAD', 'Manufacturing'], Control: ['Software', 'Electrical'], Strategy: ['Scouting', 'Media'] }
const NOTES = [
  '',
  'Needs a ride home on Tuesdays.',
  'Lead on the intake subsystem; mentors the new CAD students.',
  'Missed the last two build sessions - check in.',
  'Has a laptop from the team, serial 4471.',
  'Prefers to be contacted through the parent group.',
]

// Deterministic pseudo random so the page looks the same on every load.
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRows(count) {
  const rand = mulberry32(42)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  return Array.from({ length: count }, (_, i) => {
    const first = pick(FIRST)
    const last = pick(LAST)
    const division = pick(Object.keys(DIVISIONS))
    const sessions = 8 + Math.floor(rand() * 30)
    const attended = Math.floor(sessions * (0.4 + rand() * 0.6))
    const sessionCount = Math.floor(rand() * 4)
    const children = Array.from({ length: sessionCount }, (_, k) => {
      const day = 3 + k * 4 + Math.floor(rand() * 3)
      const present = rand() > 0.25
      const child = {
        id: `s${i}-session${k}`,
        label: `Sep ${day} - ${present ? 'Build session' : 'Strategy meeting'}`,
        present,
        hours: present ? Math.round((1 + rand() * 3) * 2) / 2 : 0,
      }
      // A second level, to show nesting works.
      if (present && k === 0 && i % 5 === 0) {
        child.children = [
          { id: `${child.id}-a`, label: 'Worked on: drivetrain assembly', present: true, hours: 1.5 },
          { id: `${child.id}-b`, label: 'Worked on: pit checklist', present: true, hours: 0.5 },
        ]
      }
      return child
    })
    return {
      id: `s${i}`,
      name: `${first} ${last}`,
      grade: 9 + Math.floor(rand() * 4),
      division,
      subdivision: pick(DIVISIONS[division]),
      attendance: Math.round((attended / sessions) * 100),
      sessions: attended,
      hours: Math.round(attended * (1.5 + rand() * 2) * 10) / 10,
      streak: Math.floor(rand() * 9),
      email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com',
      phone: `05${Math.floor(rand() * 9)}-${String(Math.floor(rand() * 9000000) + 1000000)}`,
      joined: `202${4 + Math.floor(rand() * 3)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
      notes: pick(NOTES),
      active: rand() > 0.15,
      children,
    }
  })
}

const SESSION_COUNT = 24
const SESSION_DATES = Array.from({ length: SESSION_COUNT }, (_, k) => {
  const d = new Date(2026, 8, 1 + k * 3)
  return `${d.getDate()}/${d.getMonth() + 1}`
})

function Control({ label, children }) {
  return (
    <label className="lab-control">
      {children}
      <span>{label}</span>
    </label>
  )
}

export default function TableLab() {
  const headerRef = useRef(null)
  const [rowCount, setRowCount] = useState(40)
  const [stickyHeader, setStickyHeader] = useState(true)
  const [stickyEdge, setStickyEdge] = useState('none')
  const [autoScroll, setAutoScroll] = useState(true)
  const [dense, setDense] = useState(false)
  const [hover, setHover] = useState(true)
  const [budget, setBudget] = useState(0.5)
  const [freezeLeft, setFreezeLeft] = useState(2)
  const [freezeRight, setFreezeRight] = useState(2)
  const [selected, setSelected] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set(['s0']))
  const [log, setLog] = useState([])
  // Attendance matrix: Set of "studentId:sessionIndex" that are ticked.
  const [ticked, setTicked] = useState(() => {
    const rand = mulberry32(7)
    const set = new Set()
    for (let i = 0; i < 40; i++) for (let k = 0; k < SESSION_COUNT; k++) if (rand() > 0.35) set.add(`s${i}:${k}`)
    return set
  })

  // Same contract as the app's Layout: the page's own sticky header
  // publishes its height so tables know where to pin theirs.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return undefined
    const apply = () => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
      document.documentElement.style.setProperty('--sticky-top', `${el.offsetHeight}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(() => makeRows(rowCount), [rowCount])
  const note = (text) => setLog((prev) => [`${new Date().toLocaleTimeString()} ${text}`, ...prev].slice(0, 6))

  const columns = useMemo(() => {
    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
    const toggleOne = (id) =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    const cols = [
      {
        key: 'select',
        header: () => <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />,
        cell: (r) => <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />,
        subCell: () => null,
        align: 'center',
        width: 44,
        // The name column is the one worth keeping frozen on a phone, not
        // the checkbox next to it.
        stickyPriority: 1,
      },
      {
        key: 'name',
        header: 'Student',
        cell: (r) => <strong>{r.name}</strong>,
        subCell: (r) => r.label,
        nowrap: true,
        minWidth: 200,
        // Higher than the built-in defaults (left columns 1000-, right
        // columns 500-), so on a phone this is the last column to unfreeze.
        stickyPriority: 2000,
      },
      { key: 'grade', header: 'Grade', align: 'center', subCell: () => null },
      { key: 'division', header: 'Division', subCell: () => null },
      { key: 'subdivision', header: 'Subdivision', subCell: () => null },
      {
        key: 'attendance',
        header: 'Attendance',
        align: 'right',
        cell: (r) => `${r.attendance}%`,
        subCell: (r) => (r.present ? 'present' : 'absent'),
      },
      { key: 'sessions', header: 'Sessions', align: 'right', subCell: () => null },
      { key: 'hours', header: 'Hours', align: 'right', cell: (r) => r.hours.toFixed(1), subCell: (r) => (r.hours ? r.hours.toFixed(1) : '') },
      {
        key: 'streak',
        header: 'Streak',
        align: 'center',
        nowrap: true,
        cell: (r) => (r.streak > 0 ? <span className="badge badge-ok">{r.streak} in a row</span> : <span className="muted">-</span>),
        subCell: () => null,
      },
      {
        key: 'email',
        header: 'Email',
        nowrap: true,
        cell: (r) => (
          <a href={`mailto:${r.email}`} onClick={(e) => e.preventDefault()}>
            {r.email}
          </a>
        ),
        subCell: () => null,
      },
      { key: 'phone', header: 'Phone', nowrap: true, subCell: () => null },
      { key: 'joined', header: 'Joined', align: 'center', nowrap: true, subCell: () => null },
      { key: 'notes', header: 'Notes', minWidth: 260, subCell: () => null },
      {
        key: 'status',
        header: 'Status',
        align: 'center',
        cell: (r) => <span className={r.active ? 'badge badge-ok' : 'badge badge-muted'}>{r.active ? 'Active' : 'Inactive'}</span>,
        subCell: (r) => <span className={r.present ? 'badge badge-ok' : 'badge badge-warn'}>{r.present ? 'Present' : 'Absent'}</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        nowrap: true,
        cell: (r) => (
          <>
            <button type="button" className="link-btn" onClick={() => note(`Edit ${r.name}`)}>
              Edit
            </button>
            <button type="button" className="link-btn danger" onClick={() => note(`Remove ${r.name}`)}>
              Remove
            </button>
          </>
        ),
        subCell: () => null,
      },
    ]
    // Freeze the first N / last N columns according to the controls.
    cols.forEach((c, i) => {
      if (i < freezeLeft) c.sticky = 'left'
      else if (i >= cols.length - freezeRight) c.sticky = 'right'
    })
    return cols
  }, [rows, selected, freezeLeft, freezeRight])

  // Like the app's Attendance page: one checkbox per student per session,
  // between a frozen name column and a frozen count. Ticking a checkbox
  // that is half under a frozen column should slide it fully into view.
  const matrixColumns = useMemo(() => {
    const tick = (id) =>
      setTicked((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    return [
      { key: 'name', header: 'Student', cell: (r) => <strong>{r.name}</strong>, nowrap: true, sticky: 'left', minWidth: 180 },
      ...SESSION_DATES.map((date, k) => ({
        key: `session${k}`,
        header: date,
        align: 'center',
        width: 56,
        cell: (r) => (
          <input
            type="checkbox"
            aria-label={`${r.name} on ${date}`}
            checked={ticked.has(`${r.id}:${k}`)}
            onChange={() => tick(`${r.id}:${k}`)}
          />
        ),
      })),
      {
        key: 'present',
        header: 'Present',
        align: 'center',
        sticky: 'right',
        nowrap: true,
        cell: (r) => {
          const n = SESSION_DATES.filter((_, k) => ticked.has(`${r.id}:${k}`)).length
          return <span className={n >= SESSION_COUNT * 0.6 ? 'badge badge-ok' : 'badge badge-warn'}>{n}/{SESSION_COUNT}</span>
        },
      },
    ]
  }, [ticked])
  const matrixRows = useMemo(() => rows.map(({ children: _subRows, ...r }) => r), [rows])

  const shared = {
    columns,
    rows,
    stickyHeader,
    stickyEdge,
    autoScroll,
    dense,
    hover,
    stickyBudget: budget,
    expanderColumn: 'name',
    'aria-label': 'Students',
  }

  return (
    <div className="app-shell">
      <header ref={headerRef} className="app-header lab-header">
        <strong>AttendX - table lab</strong>
        <span className="muted">This header is sticky, like the app's. Table headers pin right below it.</span>
      </header>
      <main className="app-main lab-main">
        <h1>PerfectTable</h1>
        <p className="muted">
          Frozen header + frozen columns on both sides that work while the page scrolls, expandable sub rows,
          per-column alignment, auto scroll-into-view for clicked controls, and a width budget that unfreezes
          columns on narrow screens. Resize the window or open this on a phone to see the budget kick in.
        </p>

        <div className="lab-controls">
          <Control label="Sticky header">
            <input type="checkbox" checked={stickyHeader} onChange={(e) => setStickyHeader(e.target.checked)} />
          </Control>
          <Control label="Auto scroll on click">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          </Control>
          <Control label="Dense">
            <input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} />
          </Control>
          <Control label="Row hover">
            <input type="checkbox" checked={hover} onChange={(e) => setHover(e.target.checked)} />
          </Control>
          <Control label="Frozen edge">
            <select value={stickyEdge} onChange={(e) => setStickyEdge(e.target.value)}>
              <option value="none">none (identical cells)</option>
              <option value="line">line</option>
              <option value="shadow">shadow</option>
            </select>
          </Control>
          <Control label="Frozen left columns">
            <input type="number" min={0} max={4} value={freezeLeft} onChange={(e) => setFreezeLeft(Number(e.target.value))} />
          </Control>
          <Control label="Frozen right columns">
            <input type="number" min={0} max={4} value={freezeRight} onChange={(e) => setFreezeRight(Number(e.target.value))} />
          </Control>
          <Control label={`Frozen width budget: ${Math.round(budget * 100)}%`}>
            <input type="range" min={0.1} max={1} step={0.05} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </Control>
          <Control label="Rows">
            <select value={rowCount} onChange={(e) => setRowCount(Number(e.target.value))}>
              <option value={0}>0</option>
              <option value={5}>5</option>
              <option value={40}>40</option>
              <option value={200}>200</option>
            </select>
          </Control>
        </div>

        <p className="muted lab-log">
          {selected.size} selected. {log.length ? log.join(' | ') : 'Click Edit / Remove to log here.'}
        </p>

        <h2>Page mode (default)</h2>
        <p className="muted">
          The header pins under the page header until the table has scrolled past. Scroll sideways to see the
          frozen columns; click a half-hidden Edit button to watch it scroll into view.
        </p>
        <PerfectTable {...shared} expanded={expanded} onExpandedChange={setExpanded} />

        <h2>Box mode (maxHeight 360)</h2>
        <p className="muted">
          Same table scrolling inside its own box - everything here is plain native position: sticky.
        </p>
        <PerfectTable {...shared} maxHeight={360} defaultExpanded={['s1']} />

        <h2>Checkbox matrix (auto scroll)</h2>
        <p className="muted">
          Tick a checkbox in the last (or second to last) visible column and the next ones scroll into view;
          same for one half hidden under the frozen name or count column, and for the last visible rows. Tab
          through the checkboxes for the keyboard version.
        </p>
        <PerfectTable
          columns={matrixColumns}
          rows={matrixRows}
          stickyHeader={stickyHeader}
          stickyEdge={stickyEdge}
          autoScroll={autoScroll}
          dense={dense}
          hover={hover}
          stickyBudget={budget}
          aria-label="Attendance matrix"
        />

        <h2>Empty</h2>
        <PerfectTable columns={columns} rows={[]} emptyMessage="No students match these filters." />

        <h2>Filler</h2>
        {Array.from({ length: 12 }, (_, i) => (
          <p key={i} className="muted">
            Paragraph {i + 1} of filler so the page keeps scrolling well past the tables above, which is how you
            check that a pinned header lets go exactly when its table leaves the viewport.
          </p>
        ))}
      </main>
    </div>
  )
}
