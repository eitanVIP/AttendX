import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import PieChart from '../components/PieChart'
import StickyTableScroll from '../components/StickyTableScroll'
import StreakBadge from '../components/StreakBadge'
import StreakTabs from '../components/StreakTabs'
import {
  useAllAttendance,
  useCommunityLogs,
  useCommunitySettings,
  useEvents,
  useNow,
  useProducts,
  usePurchases,
  useSessions,
  useStudents,
  useTrainings,
} from '../lib/firestore-hooks'
import {
  NO_PRODUCT_TYPES,
  budgetRemainingSlices,
  certProgress,
  eventCountdown,
  groupByScope,
  spentByCategory,
  streakBoard,
  studentCommunityHours,
  summarizeAttendance,
  totalBudget,
  totalSpent,
  totalToBuyCost,
  trainingCompletionByGrade,
} from '../lib/calc'
import { DEFAULT_CURRENCY_RATES } from '../lib/currency'

// Cycled by each category's position in the team's own category order, so
// a given category keeps the same colour across both pie charts (and across
// reloads) instead of it depending on iteration order.
const PIE_COLORS = ['#2563eb', '#f97316', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ca8a04', '#db2777']
const UNCATEGORIZED_COLOR = '#6b7280'
const TOP_STREAKS_LIMIT = 10

export default function Dashboard() {
  const { team } = useAuth()
  const { data: students, loading: studentsLoading } = useStudents(team)
  const { data: trainings, loading: trainingsLoading } = useTrainings(team?.id)
  const { data: sessions } = useSessions(team?.id)
  const { data: attendance, loading: attLoading } = useAllAttendance(team?.id)
  const { data: communityLogs, loading: logsLoading } = useCommunityLogs(team?.id)
  const { settings: communitySettings, loading: settingsLoading } = useCommunitySettings(team?.id)
  const { data: events } = useEvents(team?.id)
  const { data: products, loading: productsLoading } = useProducts(team?.id)
  const { data: purchases, loading: purchasesLoading } = usePurchases(team?.id)
  const [attendanceMetric, setAttendanceMetric] = useState('percent')
  const [streakKind, setStreakKind] = useState('training')

  const productTypes = team?.productTypes || NO_PRODUCT_TYPES
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const categories = team?.categories || []

  const activeStudents = useMemo(() => students.filter((s) => s.active), [students])
  // Same division/subdivision order (then the ↑/↓ order within each) as the
  // Certifications page itself - see groupByScope in calc.js - rather than
  // alphabetical, so this table reads as the same list in the same order,
  // just flattened into rows instead of cards.
  const certifications = useMemo(() => {
    const certs = trainings.filter((t) => t.category === 'professional')
    return groupByScope(certs, team?.divisions || [], team?.subdivisionsByDivision || {}).flatMap((g) => g.items)
  }, [trainings, team])
  const regularTrainings = useMemo(() => trainings.filter((t) => t.category !== 'professional'), [trainings])

  const completionByGrade = useMemo(
    () => trainingCompletionByGrade(students, regularTrainings, team?.divisions || []),
    [students, regularTrainings, team?.divisions]
  )

  // Raw records grouped per student - both the attendance summaries below
  // AND the attendance streak (see attendanceStreak in calc.js, used by
  // streakBoard) need this same grouping, just processed differently.
  const recordsByStudent = useMemo(() => {
    const grouped = {}
    for (const s of students) grouped[s.id] = []
    for (const r of attendance) {
      if (grouped[r.studentId]) grouped[r.studentId].push(r)
    }
    return grouped
  }, [attendance, students])

  const sessionById = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])

  const attendanceByStudent = useMemo(() => {
    const summaries = {}
    for (const [id, records] of Object.entries(recordsByStudent)) {
      summaries[id] = summarizeAttendance(records)
    }
    return summaries
  }, [recordsByStudent])

  // Everyone, inactive included (dimmed) - the students with the lowest
  // attendance are exactly the ones this chart is for. `count` is sessions
  // actually attended (present + late, the same numerator attendancePercent
  // uses) rather than a percentage - a toggle in the chart itself (see
  // attendanceMetric) picks which one sorts the list and sizes the bars.
  const attendanceBars = useMemo(() => {
    const rows = students.map((s) => {
      const summary = attendanceByStudent[s.id]
      return { student: s, percent: summary?.percent ?? null, count: summary ? summary.present + summary.late : 0 }
    })
    return [...rows].sort((a, b) =>
      attendanceMetric === 'count' ? b.count - a.count : (b.percent ?? -1) - (a.percent ?? -1)
    )
  }, [students, attendanceByStudent, attendanceMetric])
  const maxAttendanceCount = Math.max(1, ...attendanceBars.map((b) => b.count))

  const divisionStats = useMemo(() => {
    return (team?.divisions || []).map((d) => {
      const divStudents = activeStudents.filter((s) => s.divisions.includes(d))
      const percents = divStudents
        .map((s) => attendanceByStudent[s.id]?.percent)
        .filter((p) => p !== null && p !== undefined)
      const avg = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null
      return { division: d, count: divStudents.length, avgAttendance: avg }
    })
  }, [team, activeStudents, attendanceByStudent])

  const hoursByStudent = useMemo(() => {
    const map = {}
    for (const s of activeStudents) map[s.id] = studentCommunityHours(communityLogs, s.id)
    return map
  }, [communityLogs, activeStudents])

  const studentsMetHours = useMemo(() => {
    if (!communitySettings.hoursTarget) return null
    return activeStudents.filter((s) => hoursByStudent[s.id] >= communitySettings.hoursTarget).length
  }, [activeStudents, hoursByStudent, communitySettings.hoursTarget])

  // Budget: everything below is in the team's preferred currency, converted
  // from whatever each product/purchase was actually priced in - see
  // spentByCategory/totalToBuyCost in calc.js.
  const spending = useMemo(() => spentByCategory(purchases, rates, preferred), [purchases, rates, preferred])
  const budget = useMemo(() => totalBudget(team?.categoryBudgets), [team?.categoryBudgets])
  const spent = useMemo(() => totalSpent(purchases, rates, preferred), [purchases, rates, preferred])
  const toBuyCost = useMemo(
    () => totalToBuyCost(products, productTypes, rates, preferred),
    [products, productTypes, rates, preferred]
  )
  const projectedSpent = spent + toBuyCost
  const spentPercentOfBudget = budget > 0 ? Math.round((spent / budget) * 100) : null
  const projectedPercentOfBudget = budget > 0 ? Math.round((projectedSpent / budget) * 100) : null

  const categoryColor = (name) => {
    if (!name) return UNCATEGORIZED_COLOR
    const i = categories.indexOf(name)
    return PIE_COLORS[(i === -1 ? 0 : i) % PIE_COLORS.length]
  }

  // Raw per-category numbers (see budgetRemainingSlices in calc.js) - the
  // combined chart below weights every category equally, but each
  // category's OWN two-slice remaining/spent pie (further down) needs its
  // real remainingPercent, not that shared weighting.
  const categoryBudgetSlices = useMemo(
    () => budgetRemainingSlices(team?.categoryBudgets, spending),
    [team?.categoryBudgets, spending]
  )

  const remainingSlices = useMemo(() => {
    return [
      ...categoryBudgetSlices.slices.map((s) => ({
        label: s.category,
        percent: s.percent,
        displayPercent: s.remainingPercent,
        color: categoryColor(s.category),
      })),
      { label: 'Spent', percent: categoryBudgetSlices.spentPercent, color: 'var(--muted)' },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryBudgetSlices, categories])

  const spentSlices = useMemo(() => {
    const total = Object.values(spending).reduce((a, b) => a + b, 0)
    if (total <= 0) return []
    return Object.entries(spending)
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({
        label: category || 'Uncategorized',
        percent: (amount / total) * 100,
        color: categoryColor(category),
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spending, categories])

  // One small two-slice pie per budgeted category - unlike the combined
  // chart above, each of these is scaled against just that category's own
  // budget, not weighted against every other category's.
  const perCategorySlices = useMemo(
    () =>
      categoryBudgetSlices.slices.map((s) => ({
        category: s.category,
        slices: [
          { label: 'Left', percent: s.remainingPercent, color: categoryColor(s.category) },
          { label: 'Spent', percent: 100 - s.remainingPercent, color: 'var(--muted)' },
        ],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryBudgetSlices, categories]
  )

  const topStreaks = useMemo(() => {
    return streakBoard(students, streakKind, team?.streakResetDays, recordsByStudent, sessionById)
      .filter((r) => r.streak > 0)
      .slice(0, TOP_STREAKS_LIMIT)
  }, [students, streakKind, team?.streakResetDays, recordsByStudent, sessionById])

  const loading =
    studentsLoading || trainingsLoading || attLoading || logsLoading || settingsLoading || productsLoading || purchasesLoading
  if (loading) return <div className="page-loading">Loading dashboard…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <NoDivisionsNotice team={team} />

      <EventCountdowns events={events} />

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Active students</span>
          <span className="stat-value">
            {activeStudents.length}
            <span className="stat-value-sub">
              {' '}
              · {students.length ? Math.round((activeStudents.length / students.length) * 100) : 0}%
            </span>
          </span>
          <span className="muted">
            of {students.length} total · {students.length - activeStudents.length} inactive
          </span>
        </div>
        {communitySettings.hoursTarget > 0 && (
          <div className="card stat-card">
            <span className="stat-label">Completed community hours</span>
            <span className="stat-value">
              {studentsMetHours}/{activeStudents.length}
            </span>
            <span className="muted">{communitySettings.hoursTarget} hrs required</span>
          </div>
        )}
      </div>

      <h2>Budget</h2>
      <p className="muted" style={{ marginTop: -12 }}>
        Budgets (set per category in Settings) aren't hard limits - spending past one is allowed and
        just shows up here.
      </p>
      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Total budget</span>
          <span className="stat-value">
            {budget.toFixed(0)} {preferred}
          </span>
          <span className="muted">
            across {Object.keys(team?.categoryBudgets || {}).length} budgeted categor
            {Object.keys(team?.categoryBudgets || {}).length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Total spent</span>
          <span className="stat-value">
            {spent.toFixed(0)}
            <span className="stat-value-sub"> / {budget.toFixed(0)} {preferred}</span>
          </span>
          <span className="muted">{spentPercentOfBudget === null ? 'No budget set yet' : `${spentPercentOfBudget}% of budget`}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Projected spent</span>
          <span className="stat-value">
            {projectedSpent.toFixed(0)}
            <span className="stat-value-sub"> / {budget.toFixed(0)} {preferred}</span>
          </span>
          <span className="muted">
            {projectedPercentOfBudget === null ? 'No budget set yet' : `${projectedPercentOfBudget}% of budget`}
          </span>
          <span className="muted">
            {spent.toFixed(0)} spent + {toBuyCost.toFixed(0)} still to buy
          </span>
        </div>
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-col">
          <h3>Budget remaining by category</h3>
          <PieChart slices={remainingSlices} />
        </div>
        <div className="dashboard-col">
          <h3>Spent by category</h3>
          <PieChart slices={spentSlices} />
        </div>
      </div>

      {perCategorySlices.length > 0 && (
        <>
          <h3>By category</h3>
          <div className="pie-chart-grid">
            {perCategorySlices.map(({ category, slices }) => (
              <div key={category}>
                <p className="muted" style={{ margin: '0 0 4px' }}>
                  {category}
                </p>
                <PieChart slices={slices} size={110} />
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Top streaks</h2>
      <StreakTabs kind={streakKind} onChange={setStreakKind} />
      {topStreaks.length === 0 ? (
        <p className="muted">No active streaks yet.</p>
      ) : (
        <ol className="streak-board">
          {topStreaks.map(({ student, streak }, i) => (
            <li key={student.id}>
              <Link to={`/students/${student.id}`} className="streak-board-row">
                <span className="streak-board-rank">#{i + 1}</span>
                <span className="streak-board-name">{student.fullName}</span>
                <StreakBadge streak={streak} frozen={streakKind !== 'attendance' && !!student[`${streakKind}StreakFrozen`]} />
              </Link>
            </li>
          ))}
        </ol>
      )}

      <h2>Training &amp; attendance</h2>
      <div className="dashboard-columns">
        <div className="dashboard-col">
          <h3>By division</h3>
          <StickyTableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Division</th>
                  <th>Students</th>
                  <th>Avg. attendance</th>
                </tr>
              </thead>
              <tbody>
                {divisionStats.map((d) => (
                  <tr key={d.division}>
                    <td>{d.division}</td>
                    <td>{d.count}</td>
                    <td>{d.avgAttendance === null ? '—' : `${d.avgAttendance}%`}</td>
                  </tr>
                ))}
                {divisionStats.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      No divisions set up.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </StickyTableScroll>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Attendance by student</h3>
            <div className="filter-row" style={{ margin: 0 }}>
              <button
                className={attendanceMetric === 'percent' ? 'chip active' : 'chip'}
                onClick={() => setAttendanceMetric('percent')}
              >
                %
              </button>
              <button
                className={attendanceMetric === 'count' ? 'chip active' : 'chip'}
                onClick={() => setAttendanceMetric('count')}
              >
                Times attended
              </button>
            </div>
          </div>
          <div className="card bar-chart">
            {attendanceBars.map(({ student, percent, count }) => (
              <Link
                to={`/students/${student.id}`}
                key={student.id}
                className={`bar-row ${student.active ? '' : 'row-inactive'}`}
                title={student.active ? undefined : 'Inactive'}
              >
                <span className="bar-row-name">{student.fullName}</span>
                <span className="bar-row-track">
                  <span
                    className="bar-row-fill"
                    style={{
                      width:
                        attendanceMetric === 'count'
                          ? `${(count / maxAttendanceCount) * 100}%`
                          : `${percent ?? 0}%`,
                    }}
                  />
                </span>
                <span className="bar-row-value">
                  {attendanceMetric === 'count' ? count : percent === null ? '—' : `${percent}%`}
                </span>
              </Link>
            ))}
            {attendanceBars.length === 0 && <p className="muted">No students yet.</p>}
          </div>

          <h3>Training completion by grade</h3>
          <div className="card bar-chart grade-chart">
            {completionByGrade.map(({ division, rows }) => (
              <div key={division} className="grade-chart-block">
                <div className="grade-chart-division">{division}</div>
                {rows.map((row) => (
                  <div
                    key={row.grade}
                    className="bar-row"
                    title={`${row.completed} of ${row.total} trainings completed across ${row.students} student${row.students === 1 ? '' : 's'}`}
                  >
                    <span className="bar-row-name">{row.grade}</span>
                    <span className="bar-row-track">
                      <span className="bar-row-fill" style={{ width: `${row.percent ?? 0}%` }} />
                    </span>
                    <span className="bar-row-value">{row.percent === null ? '—' : `${row.percent}%`}</span>
                  </div>
                ))}
              </div>
            ))}
            {completionByGrade.length === 0 && <p className="muted">No trainings apply to any active student yet.</p>}
          </div>
        </div>

        <div className="dashboard-col">
          <h3>Certifications</h3>
          <StickyTableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Certification</th>
                  <th>Division</th>
                  <th>Certified</th>
                </tr>
              </thead>
              <tbody>
                {certifications.map((cert) => {
                  const progress = certProgress(cert, students, trainings)
                  return (
                    <tr key={cert.id}>
                      <td>{cert.name}</td>
                      <td className="muted">{cert.scopeDivision || 'General'}</td>
                      <td>
                        <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
                          {progress.completed}/{progress.target}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {certifications.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      No certifications tracked yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </StickyTableScroll>
        </div>
      </div>
    </div>
  )
}

const pad = (n) => String(n).padStart(2, '0')

function EventCountdowns({ events }) {
  const now = useNow(1000)
  const upcoming = events
    .map((event) => ({ ...event, countdown: eventCountdown(event.date, now) }))
    .filter((event) => !event.countdown.past)
  if (upcoming.length === 0) return null
  const [next, ...rest] = upcoming
  return (
    <div className="events">
      <EventCard event={next} hero />
      {rest.length > 0 && (
        <div className="events-rest">
          {rest.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({ event, hero }) {
  const { countdown } = event
  const time = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`
  return (
    <div className={`card event-card ${hero ? 'event-hero' : ''}`}>
      <span className="stat-label">{hero ? 'Next event' : 'Upcoming'}</span>
      <span className="event-name">{event.name}</span>
      <span className="event-countdown">
        {countdown.today ? (
          'Today'
        ) : (
          <>
            {countdown.days}
            <span className="event-unit">d</span> {time}
          </>
        )}
      </span>
      <span className="muted">{event.date}</span>
    </div>
  )
}
