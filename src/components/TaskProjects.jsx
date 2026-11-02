import { formatDMY, isOverdue, projectSummaries } from '../lib/tasks'
import { todayISO } from '../lib/calc'

// One bar per project (a free-text name on tasks): how much of it is finished.
export default function TaskProjects({ tasks, statuses }) {
  const today = todayISO()
  const projects = projectSummaries(tasks, statuses)
  if (projects.length === 0) return <p className="muted">No projects yet. Give tasks a project name in the task form to group them.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {projects.map((p) => {
        const percent = Math.round((p.done / p.total) * 100)
        const late = p.tasks.filter((t) => isOverdue(t, statuses, today)).length
        return (
          <div key={p.name} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>📁 {p.name}</strong>
              <span className="muted">
                {p.done}/{p.total} finished ({percent}%)
                {late > 0 && <span style={{ color: 'var(--danger)' }}>, {late} overdue</span>}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ height: 8, borderRadius: 4, background: 'var(--border)', margin: '8px 0', overflow: 'hidden' }}
            >
              <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
            {(p.start || p.end) && (
              <div className="muted" style={{ fontSize: 12 }}>
                {formatDMY(p.start) || '?'} → {formatDMY(p.end) || '?'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
