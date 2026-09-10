import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'

export default function Teams() {
  const { user, team, loading } = useAuth()
  const [mode, setMode] = useState('join')

  useEffect(() => {
    document.title = 'AttendX | Teams'
  }, [])

  if (loading) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <img src="/logo.png" alt="AttendX" className="auth-logo" />
        <p className="login-sub">Signed in as {user.email}</p>
        {team && (
          <p>
            <Link to="/">← Back to {team.name || team.id}</Link>
          </p>
        )}

        <MembershipsList />

        <div className="login-tabs">
          <button className={mode === 'join' ? 'chip active' : 'chip'} onClick={() => setMode('join')}>
            Join a team
          </button>
          <button className={mode === 'create' ? 'chip active' : 'chip'} onClick={() => setMode('create')}>
            Create a team
          </button>
        </div>
        {mode === 'join' ? <JoinForm /> : <CreateForm />}
      </div>
    </div>
  )
}

function MembershipsList() {
  const { memberships, profile, switchTeam, leaveTeam } = useAuth()
  const [teamsById, setTeamsById] = useState({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      memberships.map(async (teamId) => {
        const snap = await getDoc(doc(db, 'teams', teamId))
        return [teamId, snap.exists() ? snap.data() : { name: teamId }]
      })
    ).then((entries) => {
      if (!cancelled) setTeamsById(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [memberships])

  if (memberships.length === 0) return null

  async function handleLeave(teamId, name) {
    if (!confirm(`Leave ${name}? You'll need the team code again to rejoin.`)) return
    await leaveTeam(teamId)
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Your teams</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {memberships.map((teamId) => {
          const name = teamsById[teamId]?.name || teamId
          const isActive = profile?.activeTeamId === teamId
          return (
            <li
              key={teamId}
              className="card"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}
            >
              <span>{name}</span>
              <span className="row-actions">
                {isActive ? (
                  <span className="badge badge-ok">Active</span>
                ) : (
                  <button className="link-btn" onClick={() => switchTeam(teamId)}>
                    Switch to this team
                  </button>
                )}
                <button className="link-btn danger" onClick={() => handleLeave(teamId, name)}>
                  Leave
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function JoinForm() {
  const { joinTeam } = useAuth()
  const [teamId, setTeamId] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await joinTeam(teamId.trim().toLowerCase(), code)
      setTeamId('')
      setCode('')
    } catch {
      setError('Team ID or code is incorrect.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Team ID
        <input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="e.g. team3211" required />
      </label>
      <label>
        Admin code
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      <p className="muted" style={{ margin: '-6px 0 0' }}>
        This is the admin code, not the student code from the hour-logging page.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Joining…' : 'Join team'}
      </button>
    </form>
  )
}

function CreateForm() {
  const { createTeam } = useAuth()
  const [teamId, setTeamId] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [divisions, setDivisions] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (code.length < 4 || studentCode.length < 4) {
      setError('Both codes must be at least 4 characters.')
      return
    }
    if (code === studentCode) {
      setError('Admin and student codes must be different.')
      return
    }
    setSubmitting(true)
    try {
      const divisionList = divisions
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
      await createTeam(teamId.trim().toLowerCase(), code, studentCode, {
        name: name.trim() || teamId,
        divisions: divisionList,
        subdivisionsByDivision: Object.fromEntries(divisionList.map((d) => [d, []])),
      })
    } catch {
      setError('That team ID is already taken - pick another one.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Team ID
        <input
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          placeholder="e.g. team4744"
          pattern="[a-z0-9\-]+"
          title="Lowercase letters, numbers and dashes only"
          required
        />
      </label>
      <label>
        Team name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DaVinci 4744" />
      </label>
      <label>
        Choose an admin code
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} minLength={4} required />
      </label>
      <label>
        Choose a student code
        <input type="password" value={studentCode} onChange={(e) => setStudentCode(e.target.value)} minLength={4} required />
      </label>
      <p className="muted" style={{ margin: '-6px 0 0' }}>
        The admin code opens the full dashboard. The student code only unlocks the community-hours
        logging page - give that one out to students.
      </p>
      <label>
        Divisions (comma separated, optional)
        <input value={divisions} onChange={(e) => setDivisions(e.target.value)} placeholder="e.g. Mechanical, Controls" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create team'}
      </button>
    </form>
  )
}
