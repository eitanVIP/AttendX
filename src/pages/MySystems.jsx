import { useEffect } from 'react'

// Placeholder tab - not built yet.
export default function MySystems() {
  useEffect(() => {
    document.title = 'AttendX | My Systems'
  }, [])

  return (
    <div className="page">
      <h1>My Systems</h1>
      <p className="muted">Coming soon.</p>
    </div>
  )
}
