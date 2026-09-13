import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import PasswordInput from '../components/PasswordInput'
import TeamNumberInput from '../components/TeamNumberInput'

export default function Teams() {
  const { user, team, loading, logout } = useAuth()
  const [mode, setMode] = useState('join')

  useEffect(() => {
    document.title = 'AttendX | Teams'
  }, [])

  if (loading) return <div className="page-loading">Loading…</div>
  // Also where "Sign in as another account" lands: logout clears `user`,
  // and this redirect takes over.
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <Logo className="auth-logo" />
        <p className="login-sub" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>Signed in as {user.email}</span>
          <button type="button" className="link-btn" onClick={logout}>
            Sign in as another account
          </button>
        </p>
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
          <button className={mode === 'clone' ? 'chip active' : 'chip'} onClick={() => setMode('clone')}>
            Clone a team
          </button>
        </div>
        {mode === 'join' && <JoinForm />}
        {mode === 'create' && <CreateForm />}
        {mode === 'clone' && <CloneForm />}
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
  const [teamNumber, setTeamNumber] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await joinTeam(teamNumber, code)
      setTeamNumber('')
      setCode('')
    } catch {
      setError('Team number or code is incorrect.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Team number
        <TeamNumberInput value={teamNumber} onChange={setTeamNumber} />
      </label>
      <label>
        Admin code
        <PasswordInput value={code} onChange={(e) => setCode(e.target.value)} required />
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
  const [teamNumber, setTeamNumber] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [studentCode, setStudentCode] = useState('')
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
      await createTeam(teamNumber, code, studentCode, { name: name.trim() || `Team ${teamNumber}` })
    } catch {
      setError(`Team ${teamNumber} already exists on AttendX - ask its admin for the code and join it instead.`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        FRC team number
        <TeamNumberInput value={teamNumber} onChange={setTeamNumber} placeholder="e.g. 4744" />
      </label>
      <label>
        Team name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DaVinci 4744" />
      </label>
      <label>
        Choose an admin code
        <PasswordInput value={code} onChange={(e) => setCode(e.target.value)} minLength={4} required />
      </label>
      <label>
        Choose a student code
        <PasswordInput value={studentCode} onChange={(e) => setStudentCode(e.target.value)} minLength={4} required />
      </label>
      <p className="muted" style={{ margin: '-6px 0 0' }}>
        The admin code opens the full dashboard. The student code only unlocks the community-hours
        logging page - give that one out to students.
      </p>
      <p className="muted" style={{ margin: '-6px 0 0' }}>
        You'll set up the team's divisions in Settings right after.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create team'}
      </button>
    </form>
  )
}

function CloneForm() {
  const { cloneTeam, overrideTeamWithClone } = useAuth()
  const [teamNumber, setTeamNumber] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [sourceTeamNumber, setSourceTeamNumber] = useState('')
  const [sourceCode, setSourceCode] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [destinationCode, setDestinationCode] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function toggleOverwrite(checked) {
    setOverwrite(checked)
    setError('')
    setConfirmed(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (overwrite) {
      setSubmitting(true)
      try {
        await overrideTeamWithClone(teamNumber, destinationCode, sourceTeamNumber, sourceCode)
      } catch (err) {
        setError(
          err.message === 'source-access'
            ? 'Source team number or admin code is incorrect.'
            : err.message === 'same-team'
              ? "Can't overwrite a team with itself - pick a different team to clone from."
              : `Team ${teamNumber}'s number or admin code is incorrect.`
        )
      } finally {
        setSubmitting(false)
      }
      return
    }

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
      await cloneTeam(
        teamNumber,
        code,
        studentCode,
        { name: name.trim() || `Team ${teamNumber}` },
        sourceTeamNumber,
        sourceCode
      )
    } catch (err) {
      setError(
        err.message === 'source-access'
          ? 'Source team number or admin code is incorrect.'
          : `Team ${teamNumber} already exists on AttendX - ask its admin for the code and join it instead.`
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="muted" style={{ margin: '-6px 0 0' }}>
        Copies trainings, certifications, events, community-hours settings, divisions, and the
        auto-inactive threshold from an existing team. Not its students, number, accent, name, or
        codes.
      </p>
      <label>
        Team to clone from - number
        <TeamNumberInput value={sourceTeamNumber} onChange={setSourceTeamNumber} placeholder="e.g. 4744" />
      </label>
      <label>
        Team to clone from - admin code
        <PasswordInput value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} required />
      </label>

      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={overwrite} onChange={(e) => toggleOverwrite(e.target.checked)} />
        Overwrite an existing team instead of creating a new one
      </label>

      {overwrite ? (
        <>
          <div className="notice-danger">
            <strong>This permanently replaces the target team's data.</strong>
            Its trainings, certifications, events, and community-hours settings are deleted and
            replaced with the source's above. Its roster, name, number, accent, and codes stay as
            they are. There is no undo.
          </div>
          <label>
            Team to overwrite - number
            <TeamNumberInput value={teamNumber} onChange={setTeamNumber} placeholder="e.g. 4744" />
          </label>
          <label>
            Team to overwrite - admin code
            <PasswordInput value={destinationCode} onChange={(e) => setDestinationCode(e.target.value)} required />
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I understand this permanently deletes {teamNumber ? `team ${teamNumber}'s` : "the target team's"}{' '}
            existing trainings, certifications, events, and community-hours settings.
          </label>
        </>
      ) : (
        <>
          <label>
            New team's FRC number
            <TeamNumberInput value={teamNumber} onChange={setTeamNumber} placeholder="e.g. 4744" />
          </label>
          <label>
            New team's name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DaVinci 4744" />
          </label>
          <label>
            Choose an admin code
            <PasswordInput value={code} onChange={(e) => setCode(e.target.value)} minLength={4} required />
          </label>
          <label>
            Choose a student code
            <PasswordInput value={studentCode} onChange={(e) => setStudentCode(e.target.value)} minLength={4} required />
          </label>
        </>
      )}

      {error && <p className="form-error">{error}</p>}
      <button type="submit" className={overwrite ? 'danger' : undefined} disabled={submitting || (overwrite && !confirmed)}>
        {submitting ? (overwrite ? 'Overwriting…' : 'Cloning…') : overwrite ? 'Overwrite team' : 'Clone team'}
      </button>
    </form>
  )
}
