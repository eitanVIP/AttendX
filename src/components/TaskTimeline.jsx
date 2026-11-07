import { addDays, daysBetween, divisionColor, formatDMY, isOverdue, sortTasksByDate, statusOf, waitingOn } from '../lib/tasks'
import { todayISO } from '../lib/calc'
import usePhone from '../lib/usePhone'

const DAY_W = 28
const ROW_H = 30
const LABEL_W = 190

// A task's bar runs from its start to its due date (either alone is one day).
function span(task) {
  const start = task.startDate || task.dueDate
  const end = task.dueDate || task.startDate
  return start ? [start, end < start ? start : end] : null
}

// Gantt-style view: one row per dated task with a bar across its days, a line
// for today, and an arrow from each prerequisite's end to the task waiting on it.
export default function TaskTimeline({ tasks, allTasks = tasks, statuses, students, divisions, onOpen }) {
  const today = todayISO()
  const labelW = usePhone() ? 110 : LABEL_W
  const dated = sortTasksByDate(tasks.filter((t) => span(t)))
  const undated = tasks.filter((t) => !span(t))
  if (dated.length === 0) return <p className="muted">No dated tasks to show. Give tasks a start or due date.</p>

  const earliest = dated.map((t) => span(t)[0]).sort()[0]
  const first = addDays(earliest < today ? earliest : today, -1)
  const lastTask = dated.map((t) => span(t)[1]).sort().pop()
  const last = addDays(lastTask > today ? lastTask : today, 2)
  const totalDays = daysBetween(first, last) + 1
  const x = (iso) => daysBetween(first, iso) * DAY_W
  const rowOf = Object.fromEntries(dated.map((t, i) => [t.id, i]))
  const width = totalDays * DAY_W
  const height = dated.length * ROW_H

  const ticks = Array.from({ length: totalDays }, (_, i) => addDays(first, i)).filter((iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1)

  // Arrows: prerequisite end -> dependent start, for both dated tasks shown.
  const arrows = []
  for (const t of dated) {
    for (const pid of t.blockedBy || []) {
      const p = dated.find((d) => d.id === pid)
      if (!p) continue
      const x1 = x(addDays(span(p)[1], 1))
      const x2 = x(span(t)[0])
      const y1 = rowOf[p.id] * ROW_H + ROW_H / 2
      const y2 = rowOf[t.id] * ROW_H + ROW_H / 2
      arrows.push({ key: `${pid}-${t.id}`, x1, x2, y1, y2 })
    }
  }

  return (
    <>
    <div className="card" style={{ display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: labelW, flexShrink: 0, borderRight: '1px solid var(--border)' }}>
        <div style={{ height: 24 }} />
        {dated.map((t) => (
          <div key={t.id} style={{ height: ROW_H, display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 13, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={t.title}>
            {waitingOn(t, allTasks, statuses).length > 0 && '🔒 '}
            {t.title}
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <div style={{ position: 'relative', width, minHeight: height + 24 }}>
          <div style={{ height: 24, position: 'relative' }}>
            {ticks.map((iso) => (
              <span key={iso} className="muted" style={{ position: 'absolute', left: x(iso), fontSize: 11, whiteSpace: 'nowrap' }}>
                {formatDMY(iso).slice(0, 5)}
              </span>
            ))}
          </div>
          <div style={{ position: 'relative', height }}>
            {ticks.map((iso) => (
              <div key={iso} style={{ position: 'absolute', left: x(iso), top: 0, bottom: 0, borderLeft: '1px solid var(--border)', opacity: 0.5 }} />
            ))}
            <div title="Today" style={{ position: 'absolute', left: x(today), width: DAY_W, top: 0, bottom: 0, background: 'var(--accent-soft)' }} />
            {dated.map((t) => {
              const [s, e] = span(t)
              const done = statusOf(t, statuses).done
              const color = divisionColor(t.division, divisions)
              const assignee = students.find((st) => st.id === t.assigneeId)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={onOpen ? () => onOpen(t) : undefined}
                  disabled={!onOpen}
                  title={`${t.title}${assignee ? ` - ${assignee.fullName}` : ''} (${formatDMY(s)}${e !== s ? ` → ${formatDMY(e)}` : ''})`}
                  style={{
                    position: 'absolute',
                    top: rowOf[t.id] * ROW_H + 4,
                    left: x(s),
                    width: (daysBetween(s, e) + 1) * DAY_W - 2,
                    height: ROW_H - 8,
                    padding: '0 6px',
                    border: isOverdue(t, statuses, today) ? '1px solid var(--danger)' : 'none',
                    borderRadius: 4,
                    background: `color-mix(in srgb, ${color} ${done ? 25 : 70}%, transparent)`,
                    color: 'var(--text-h)',
                    fontSize: 11,
                    textAlign: 'left',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    textDecoration: done ? 'line-through' : 'none',
                    cursor: onOpen ? 'pointer' : 'default',
                  }}
                >
                  {assignee ? assignee.fullName : ''}
                </button>
              )
            })}
            <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
              {arrows.map((a) => {
                const mid = Math.max(a.x1 + 8, Math.min(a.x2 - 8, a.x1 + 8))
                return (
                  <g key={a.key} stroke="var(--muted, #888)" fill="none" strokeWidth="1.5">
                    <path d={`M ${a.x1} ${a.y1} H ${mid} V ${a.y2} H ${a.x2 - 4}`} />
                    <polygon points={`${a.x2},${a.y2} ${a.x2 - 6},${a.y2 - 3.5} ${a.x2 - 6},${a.y2 + 3.5}`} fill="var(--muted, #888)" stroke="none" />
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
    {undated.length > 0 && (
      <p className="muted" style={{ fontSize: 13 }}>
        No dates ({undated.length}): {undated.map((t) => t.title).join(', ')}
      </p>
    )}
    </>
  )
}
