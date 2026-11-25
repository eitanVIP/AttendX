import { useState } from 'react'
import { TaskRequestList } from './TaskRequests'
import { needsYou, taskDateLabel } from '../lib/tasks'

const SHOWN = 3

// One kind of thing that needs the admin: a heading with a count and the first
// few rows, with the rest one click away.
function Group({ icon, title, count, color, children }) {
  const [all, setAll] = useState(false)
  const rows = Array.isArray(children) ? children : [children]
  return (
    <section style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 600, color }}>
        {icon} {title} <span className="muted">{count}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>{all ? rows : rows.slice(0, SHOWN)}</ul>
      {rows.length > SHOWN && (
        <button type="button" className="link-btn" style={{ padding: 0, marginTop: 4, fontSize: 13 }} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show ${rows.length - SHOWN} more`}
        </button>
      )}
    </section>
  )
}

function Row({ task, detail, detailColor, onOpen, children }) {
  return (
    <li className="needs-row">
      <div className="needs-row-text">
        <button type="button" className="link-btn" style={{ padding: 0, fontWeight: 600, textAlign: 'left' }} onClick={() => onOpen(task)}>
          {task.title}
        </button>{' '}
        <span className="muted" style={detailColor ? { color: detailColor } : undefined}>
          {detail}
        </span>
      </div>
      {children && <div className="needs-row-actions">{children}</div>}
    </li>
  )
}

// The top of the admin Tasks page: only what needs a decision right now -
// finish requests, student requests, blocked, overdue and unassigned tasks -
// each with the button to deal with it. Everything else lives in the views below.
export default function TaskNeedsYou({ tasks, statuses, students, requests, today, onOpen, onApprove, onReject, onAssign, onAcceptRequest, onDeclineRequest }) {
  const { approvals, blocked, overdue, unassigned } = needsYou(tasks, statuses, today)
  const pending = requests.filter((r) => r.status === 'pending')
  const total = approvals.length + blocked.length + overdue.length + unassigned.length + pending.length
  const who = (t) => students.find((s) => s.id === t.assigneeId)?.fullName || (t.assigneeId ? '(removed student)' : 'Unassigned')
  if (total === 0) {
    return (
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <strong>✓ Nothing needs you right now</strong>
      </div>
    )
  }
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <strong>Needs you</strong> <span className="muted">{total}</span>
      {approvals.length > 0 && (
        <Group icon="✋" title="Waiting for your approval" count={approvals.length} color="var(--warn-text)">
          {approvals.map((t) => (
            <Row key={t.id} task={t} detail={`${who(t)} says it is done`} onOpen={onOpen}>
              <button type="button" onClick={() => onApprove(t)} style={{ fontSize: 12, padding: '3px 8px' }}>
                Approve done
              </button>
              <button type="button" className="secondary" onClick={() => onReject(t)} style={{ fontSize: 12, padding: '3px 8px' }}>
                Send back
              </button>
            </Row>
          ))}
        </Group>
      )}
      {pending.length > 0 && (
        <section style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600 }}>
            📝 Task requests <span className="muted">{pending.length}</span>
          </div>
          <TaskRequestList embedded requests={requests} onAccept={onAcceptRequest} onDecline={onDeclineRequest} />
        </section>
      )}
      {blocked.length > 0 && (
        <Group icon="⛔" title="Blocked" count={blocked.length} color="var(--danger)">
          {blocked.map((t) => (
            <Row key={t.id} task={t} detail={`${who(t)}${t.blockedReason ? ` - ${t.blockedReason}` : ''}`} onOpen={onOpen} />
          ))}
        </Group>
      )}
      {overdue.length > 0 && (
        <Group icon="⚠" title="Overdue" count={overdue.length} color="var(--danger)">
          {overdue.map((t) => (
            <Row key={t.id} task={t} detail={`${who(t)} - ${taskDateLabel(t)}`} detailColor="var(--danger)" onOpen={onOpen} />
          ))}
        </Group>
      )}
      {unassigned.length > 0 && (
        <Group icon="👤" title="Not assigned" count={unassigned.length}>
          {unassigned.map((t) => (
            <Row key={t.id} task={t} detail={taskDateLabel(t)} onOpen={onOpen}>
              <select value="" onChange={(e) => e.target.value && onAssign(t, e.target.value)} aria-label={`Assign ${t.title}`} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }}>
                <option value="">Assign to…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            </Row>
          ))}
        </Group>
      )}
    </div>
  )
}
