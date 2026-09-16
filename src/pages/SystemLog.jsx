import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StickyTableScroll from '../components/StickyTableScroll'
import { useLog } from '../lib/firestore-hooks'
import { purgeOldLogEntries } from '../lib/actions'
import { DEFAULT_LOG_RETENTION_DAYS } from '../lib/calc'

// Every change made in this team's dashboard, who made it, and when (see
// logChange in actions.js, called alongside virtually every write in that
// file). There's no Cloud Function on this free plan to prune old entries
// on a schedule, so it happens here instead, once, the one place an admin
// is actually looking at the log.
export default function SystemLog() {
  const { team } = useAuth()
  const { data: entries, loading } = useLog(team?.id)
  const purgedFor = useRef(null)

  useEffect(() => {
    if (!team?.id || purgedFor.current === team.id) return
    purgedFor.current = team.id
    purgeOldLogEntries(team.id, team.logRetentionDays || DEFAULT_LOG_RETENTION_DAYS)
  }, [team?.id, team?.logRetentionDays])

  if (loading) return <div className="page-loading">Loading system log…</div>

  return (
    <div className="page">
      <Link to="/settings" className="back-link">
        ← Settings
      </Link>
      <div className="page-header">
        <h1>System log</h1>
      </div>
      <p className="muted" style={{ marginTop: -12 }}>
        Every change made in this dashboard, who made it, and when. Entries older than{' '}
        {team?.logRetentionDays || DEFAULT_LOG_RETENTION_DAYS} days are cleared automatically.
      </p>
      <StickyTableScroll>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {e.at ? e.at.slice(0, 16).replace('T', ' ') : '—'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{e.email || e.uid || 'Unknown'}</td>
                <td>{e.summary}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-cell">
                  Nothing logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StickyTableScroll>
    </div>
  )
}
