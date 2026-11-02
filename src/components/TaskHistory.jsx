// The list of changes made to a task, newest first, tucked into a disclosure.
export default function TaskHistory({ history = [] }) {
  if (history.length === 0) return null
  const entries = [...history].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>
        History ({entries.length})
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, maxHeight: 140, overflowY: 'auto' }}>
        {entries.map((h, i) => (
          <li key={i}>
            {h.text} <span className="muted">- {h.by}, {new Date(h.at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
