import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import NoDivisionsNotice from '../components/NoDivisionsNotice'
import PieChart from '../components/PieChart'
import DataTable from '../components/DataTable'
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
  NO_SUPPLIERS,
  certProgress,
  eventCountdown,
  formatDate,
  isCountableTraining,
  plannedSpendByCategory,
  spentByCategory,
  supplierBudgetRows,
  streakBoard,
  studentCommunityHours,
  summarizeAttendance,
  todayISO,
  toBuyCostByCategory,
  totalSpent,
  trainingCompletionByGrade,
} from '../lib/calc'
import { DEFAULT_CURRENCY_RATES } from '../lib/currency'

// Cycled by each category's position in the team's own category order, so
// a given category keeps the same colour across both pie charts (and across
// reloads) instead of it depending on iteration order.
const PIE_COLORS = ['#2563eb', '#f97316', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ca8a04', '#db2777']
const UNCATEGORIZED_COLOR = '#6b7280'
const TOP_STREAKS_LIMIT = 10
// How many cards/charts one row of an evenly-spread grid holds before it
// wraps (the upcoming events under the next one, the per-category budget
// pies) - fewer than this and they stretch to fill the width between them,
// so two events are half the dashboard each. Both counts are handed to CSS
// rather than picked here: which one applies is a question of the viewport,
// which only the stylesheet's own media query can answer (and repeat()
// won't take a min() expression as its count, so it can't derive the
// smaller one itself).
const ROW_LIMIT = 5
const ROW_LIMIT_MOBILE = 3

const spreadCols = (count) => ({
  '--cols': Math.min(count, ROW_LIMIT),
  '--cols-mobile': Math.min(count, ROW_LIMIT_MOBILE),
})

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
  // One table per division (subdivisions folded into their parent - the
  // division is the grouping every other page filters by), in the team's own
  // division order with General last, and within each the same ↑/↓ order the
  // Certifications page shows (useTrainings already sorted by it). A cert
  // still pointing at a division Settings has since removed keeps its own
  // table, after the known ones, rather than vanishing from the dashboard.
  const certsByDivision = useMemo(() => {
    const divisions = team?.divisions || []
    const today = todayISO()
    const rank = (d) => {
      if (!d) return Number.MAX_SAFE_INTEGER
      const i = divisions.indexOf(d)
      return i === -1 ? divisions.length : i
    }
    const byDivision = new Map()
    for (const cert of trainings.filter((t) => t.category === 'professional')) {
      const key = cert.scopeDivision || ''
      if (!byDivision.has(key)) byDivision.set(key, [])
      const progress = certProgress(cert, students, trainings)
      // Same rule the Trainings matrix marks a row overdue by: the date has
      // actually passed (today itself still counts as time left) and the
      // target still isn't met.
      const overdue = !!cert.targetDate && cert.targetDate < today && progress.missing > 0
      byDivision.get(key).push({ cert, progress, overdue })
    }
    return [...byDivision.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([division, rows]) => ({
        key: division || 'general',
        title: division || 'General',
        rows,
        overdueCount: rows.filter((r) => r.overdue).length,
      }))
  }, [trainings, students, team?.divisions])
  const regularTrainings = useMemo(() => trainings.filter(isCountableTraining), [trainings])

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

  const totalCommunityHours = useMemo(
    () => Math.round(communityLogs.reduce((sum, l) => sum + (Number(l.hours) || 0), 0) * 100) / 100,
    [communityLogs]
  )

  const studentsMetHours = useMemo(() => {
    if (!communitySettings.hoursTarget) return null
    return activeStudents.filter((s) => hoursByStudent[s.id] >= communitySettings.hoursTarget).length
  }, [activeStudents, hoursByStudent, communitySettings.hoursTarget])

  // Budget: everything below is in the team's preferred currency, converted
  // from whatever each product/purchase was actually priced in - see
  // spentByCategory/totalToBuyCost in calc.js.
  const spending = useMemo(() => spentByCategory(purchases, rates, preferred), [purchases, rates, preferred])
  const suppliers = team?.suppliers || NO_SUPPLIERS
  const toBuyByCategory = useMemo(
    () => toBuyCostByCategory(products, productTypes, suppliers, rates, preferred),
    [products, productTypes, suppliers, rates, preferred]
  )
  // One total budget for the whole team (Settings -> Products); how it's
  // being split across categories comes from the Orders tab instead - see
  // plannedSpendByCategory in calc.js.
  const budget = Number(team?.totalBudget) || 0
  const plannedRows = useMemo(() => plannedSpendByCategory(spending, toBuyByCategory), [spending, toBuyByCategory])
  const spent = useMemo(() => totalSpent(purchases, rates, preferred), [purchases, rates, preferred])
  const toBuyCost = useMemo(() => Object.values(toBuyByCategory).reduce((a, b) => a + b, 0), [toBuyByCategory])
  // Per supplier: spent / still to buy / expected shipping (see
  // supplierBudgetRows in calc.js). Expected shipping also counts toward the
  // overall projection, as its own line in the category table.
  const supplierRows = useMemo(
    () => supplierBudgetRows(purchases, products, productTypes, suppliers, rates, preferred),
    [purchases, products, productTypes, suppliers, rates, preferred]
  )
  const expectedShipping = supplierRows.reduce((sum, r) => sum + r.expectedShipping, 0)
  const projectedSpent = spent + toBuyCost + expectedShipping
  const categoryTableRows = useMemo(
    () =>
      expectedShipping > 0
        ? [...plannedRows, { category: 'Expected shipping', spent: 0, toBuy: expectedShipping, planned: expectedShipping, isShipping: true }]
        : plannedRows,
    [plannedRows, expectedShipping]
  )
  const spentPercentOfBudget = budget > 0 ? Math.round((spent / budget) * 100) : null
  const projectedPercentOfBudget = budget > 0 ? Math.round((projectedSpent / budget) * 100) : null
  const overBudgetBy = budget > 0 ? projectedSpent - budget : 0

  const categoryColor = (name) => {
    if (!name) return UNCATEGORIZED_COLOR
    const i = categories.indexOf(name)
    return PIE_COLORS[(i === -1 ? 0 : i) % PIE_COLORS.length]
  }

  // Each category's share of the total budget (planned = bought + still to
  // buy). Whatever's left under budget is its own grey "Unallocated" wedge;
  // over budget, the wedges just share the whole circle between them.
  const plannedSlices = useMemo(() => {
    const denominator = Math.max(budget, projectedSpent)
    if (denominator <= 0) return []
    const slices = categoryTableRows.map((r) => ({
      label: r.category || 'Uncategorized',
      percent: (r.planned / denominator) * 100,
      color: r.isShipping ? UNCATEGORIZED_COLOR : categoryColor(r.category),
    }))
    if (budget > projectedSpent) {
      slices.push({ label: 'Unallocated', percent: ((budget - projectedSpent) / denominator) * 100, color: 'var(--border)' })
    }
    return slices
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryTableRows, budget, projectedSpent, categories])

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

  const topStreaks = useMemo(() => {
    return streakBoard(students, streakKind, team?.streakResetDays, recordsByStudent, sessionById)
      .filter((r) => r.streak > 0)
      .slice(0, TOP_STREAKS_LIMIT)
  }, [students, streakKind, team?.streakResetDays, recordsByStudent, sessionById])

  const loading =
    studentsLoading || trainingsLoading || attLoading || logsLoading || settingsLoading || productsLoading || purchasesLoading
  if (loading) return <div className="page-loading">Loading dashboard…</div>

  return (
    <div className="page dashboard-page">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <NoDivisionsNotice team={team} />

      <EventCountdowns events={events} />

      <h2>Students</h2>
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
        <Link to="/community" className="card stat-card stat-card-link">
          <span className="stat-label">Community hours</span>
          <span className="stat-value">{totalCommunityHours}</span>
          <span className="muted">
            {communitySettings.hoursTarget > 0
              ? `${studentsMetHours}/${activeStudents.length} met the ${communitySettings.hoursTarget} hr target`
              : 'hours logged'}{' '}
            · details →
          </span>
        </Link>
      </div>

      <h3>By division</h3>
      <DataTable
        columns={[
          { key: 'division', header: 'Division', cell: (d) => d.division },
          { key: 'count', header: 'Students', cell: (d) => d.count },
          {
            key: 'avg',
            header: 'Avg. attendance',
            // The bar takes whatever width Division/Students leave over.
            spread: true,
            cell: (d) =>
              d.avgAttendance === null ? (
                <span className="muted">—</span>
              ) : (
                <span className="table-bar">
                  <span className="bar-row-track">
                    <span className="bar-row-fill" style={{ width: `${d.avgAttendance}%` }} />
                  </span>
                  <span className="bar-row-value">{d.avgAttendance}%</span>
                </span>
              ),
          },
        ]}
        rows={divisionStats}
        getRowId={(d) => d.division}
        emptyMessage="No divisions set up."
      />

      <div className="dashboard-columns">
        <div className="dashboard-col">
          <div className="dashboard-col-head">
            <h3>Attendance by student</h3>
            <div className="filter-row dashboard-chips">
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
        </div>

        <div className="dashboard-col">
          <div className="dashboard-col-head">
            <h3>Training completion by grade</h3>
          </div>
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
      </div>

      <h2>Certifications</h2>
      {certsByDivision.length === 0 ? (
        <p className="muted">No certifications tracked yet.</p>
      ) : (
        <div className="dashboard-columns">
          {certsByDivision.map((group) => (
            <div className="dashboard-col" key={group.key}>
              <h3 className="cert-group-head">
                {group.title}
                {group.overdueCount > 0 && (
                  <span
                    className="cert-warn-dot"
                    title={`${group.overdueCount} target${group.overdueCount === 1 ? '' : 's'} past due and still unmet`}
                    aria-label={`${group.overdueCount} target${group.overdueCount === 1 ? '' : 's'} past due and still unmet`}
                  >
                    !
                  </span>
                )}
              </h3>
              {/* Capped height with its own scrollbar (maxHeight - box
                  mode): these sit two-up in a grid row, so one division
                  with a long list would otherwise stretch that whole row. */}
              <DataTable
                columns={[
                  { key: 'name', header: 'Certification', cell: ({ cert }) => cert.name },
                  {
                    key: 'targetDate',
                    header: 'Target date',
                    cellClassName: 'muted due-cell',
                    cell: ({ cert, overdue }) => (
                      <span title={overdue ? 'Past due with the target still unmet' : undefined}>
                        {formatDate(cert.targetDate)}
                      </span>
                    ),
                  },
                  {
                    key: 'certified',
                    header: 'Certified',
                    cell: ({ progress }) => (
                      <span className={progress.onTarget ? 'badge badge-ok' : 'badge badge-warn'}>
                        {progress.completed}/{progress.target}
                      </span>
                    ),
                  },
                ]}
                rows={group.rows}
                getRowId={({ cert }) => cert.id}
                rowClassName={({ overdue }) => (overdue ? 'row-overdue' : '')}
                maxHeight={390}
              />
            </div>
          ))}
        </div>
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

      <h2>Budget</h2>
      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Total budget</span>
          <span className="stat-value">
            {budget > 0 ? `${budget.toFixed(0)} ${preferred}` : 'Not set'}
          </span>
          <span className="muted">
            {budget > 0 ? 'The most the team plans to spend' : 'Set it in Settings → Products'}
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Total spent</span>
          <span className="stat-value">
            {spent.toFixed(0)}
            {budget > 0 && (
              <span className="stat-value-sub"> / {budget.toFixed(0)} {preferred}</span>
            )}
          </span>
          <span className="muted">{spentPercentOfBudget === null ? 'No budget set yet' : `${spentPercentOfBudget}% of budget`}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Projected spent</span>
          <span className="stat-value" style={overBudgetBy > 0 ? { color: 'var(--danger, #dc2626)' } : undefined}>
            {projectedSpent.toFixed(0)}
            {budget > 0 && (
              <span className="stat-value-sub"> / {budget.toFixed(0)} {preferred}</span>
            )}
          </span>
          <span className="muted">
            {budget <= 0
              ? 'No budget set yet'
              : overBudgetBy > 0
                ? `Over budget by ${overBudgetBy.toFixed(0)} ${preferred} (${projectedPercentOfBudget}%)`
                : `${(budget - projectedSpent).toFixed(0)} ${preferred} left after everything on Orders (${projectedPercentOfBudget}%)`}
          </span>
          <span className="muted">
            {spent.toFixed(0)} spent + {toBuyCost.toFixed(0)} still to buy
            {expectedShipping > 0 && ` + ${expectedShipping.toFixed(0)} expected shipping`}
          </span>
        </div>
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-col">
          <h3>Where the budget is going</h3>
          <PieChart slices={plannedSlices} />
        </div>
        <div className="dashboard-col">
          <h3>Spent by category</h3>
          <PieChart slices={spentSlices} />
        </div>
      </div>

      <h3>Budget by category</h3>
      <DataTable
        columns={[
          { key: 'category', header: 'Category', cell: (r) => r.category || 'Uncategorized', footerCell: () => <strong>Total</strong> },
          { key: 'spent', header: 'Spent', cell: (r) => `${r.spent.toFixed(0)} ${preferred}`, footerCell: () => `${spent.toFixed(0)} ${preferred}` },
          {
            key: 'toBuy',
            header: 'Still to buy',
            cell: (r) => `${r.toBuy.toFixed(0)} ${preferred}`,
            footerCell: () => `${(toBuyCost + expectedShipping).toFixed(0)} ${preferred}`,
          },
          {
            key: 'planned',
            header: 'Planned',
            cell: (r) => `${r.planned.toFixed(0)} ${preferred}`,
            footerCell: () => <strong>{projectedSpent.toFixed(0)} {preferred}</strong>,
          },
          {
            key: 'share',
            header: '% of budget',
            cell: (r) => (budget > 0 ? `${Math.round((r.planned / budget) * 100)}%` : '—'),
            footerCell: () => (projectedPercentOfBudget === null ? '—' : `${projectedPercentOfBudget}%`),
          },
        ]}
        rows={categoryTableRows}
        getRowId={(r) => (r.isShipping ? 'expected-shipping' : r.category || 'uncategorized')}
        footer
        emptyMessage="Nothing bought or on the Orders list yet."
      />

      <h3>Spending by supplier</h3>
      <DataTable
        columns={[
          { key: 'supplier', header: 'Supplier', cell: (r) => r.supplier || 'No supplier', footerCell: () => <strong>Total</strong> },
          {
            key: 'spent',
            header: 'Spent',
            cell: (r) => `${r.spent.toFixed(0)} ${preferred}`,
            footerCell: () => `${spent.toFixed(0)} ${preferred}`,
          },
          {
            key: 'toBuy',
            header: 'Still to buy',
            cell: (r) => `${r.toBuy.toFixed(0)} ${preferred}`,
            footerCell: () => `${toBuyCost.toFixed(0)} ${preferred}`,
          },
          {
            key: 'shipping',
            header: 'Expected shipping',
            cell: (r) => (r.expectedShipping > 0 ? `${r.expectedShipping.toFixed(0)} ${preferred}` : '—'),
            footerCell: () => `${expectedShipping.toFixed(0)} ${preferred}`,
          },
          {
            key: 'projected',
            header: 'Projected',
            cell: (r) => `${r.projected.toFixed(0)} ${preferred}`,
            footerCell: () => <strong>{projectedSpent.toFixed(0)} {preferred}</strong>,
          },
        ]}
        rows={supplierRows}
        getRowId={(r) => r.supplier || 'no-supplier'}
        footer
        emptyMessage="Nothing bought or on the Orders list yet."
      />
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
        <div className="events-rest" style={spreadCols(rest.length)}>
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
      <span className="muted">{formatDate(event.date)}</span>
    </div>
  )
}
