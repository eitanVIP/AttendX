import { STREAK_KINDS } from '../lib/calc'

// The Training/Community/Attendance switcher shown everywhere a streak
// shows up - the Dashboard's leaderboard, the student-facing Streaks page,
// and a student's own profile stat card - so all three read as the same
// feature in three places rather than three separately-built ones.
export default function StreakTabs({ kind, onChange }) {
  return (
    <div className="filter-row" style={{ margin: '0 0 10px' }}>
      {STREAK_KINDS.map((k) => (
        <button key={k.id} type="button" className={kind === k.id ? 'chip active' : 'chip'} onClick={() => onChange(k.id)}>
          {k.label}
        </button>
      ))}
    </div>
  )
}
