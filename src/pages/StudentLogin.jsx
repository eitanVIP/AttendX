import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { loadSavedLogHoursCode, saveLogHoursCode } from '../lib/logHoursCode'
import { useStudentAuth } from '../context/StudentAuthContext'
import PasswordInput from '../components/PasswordInput'
import TeamNumberInput from '../components/TeamNumberInput'

function friendlyError(err) {
  if (err.code === 'auth/admin-restricted-operation') {
    return 'This page is not enabled yet - ask your admin to turn on Anonymous sign-in in Firebase.'
  }
  if (err.code === 'permission-denied') {
    return 'Team number or student code is incorrect.'
  }
  return `Something went wrong (${err.code || err.message || 'unknown error'}). Please try again.`
}

// Public, no-account entry point for every student-facing page, in two
// steps: the team's student code (TeamCodeStep), then which student this is
// (StudentPickStep) - once both are done, StudentLayout's tabs (Community
// Hours, Request Order, My Systems) are all unlocked and already know who's
// using them, with no per-page "your name" field. See StudentAuthContext
// for the shared sign-in itself. Clicking your own name in StudentLayout's
// header comes back here to re-run just the second step (the team stays
// verified).
export default function StudentLogin() {
  const { verified, studentId } = useStudentAuth()

  useEffect(() => {
    document.title = 'AttendX | Student sign in'
  }, [])

  if (verified && studentId) return <Navigate to="/log-hours" replace />

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <h1>Student sign in</h1>
        {!verified ? <TeamCodeStep /> : <StudentPickStep />}
        <p className="muted" style={{ marginTop: 8 }}>
          <Link to="/login">Admin? Sign in here</Link>
        </p>
      </div>
    </div>
  )
}

function TeamCodeStep() {
  const { verify } = useStudentAuth()
  const saved = useMemo(() => loadSavedLogHoursCode(), [])
  const [teamId, setTeamId] = useState(saved?.teamId || '')
  const [code, setCode] = useState(saved?.code || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await verify(teamId, code)
      saveLogHoursCode(teamId, code)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="login-sub">Enter your team number and the student code your mentors gave you.</p>
      <label>
        Team number
        <TeamNumberInput value={teamId} onChange={setTeamId} />
      </label>
      <label>
        Student code
        <PasswordInput value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Continue'}
      </button>
    </form>
  )
}

function StudentPickStep() {
  const { verified, selectStudent } = useStudentAuth()
  const navigate = useNavigate()
  const [studentId, setStudentId] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    selectStudent(studentId)
    navigate('/log-hours')
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="login-sub">
        {verified.teamName ? `Signed in to ${verified.teamName}. ` : ''}Which one are you?
      </p>
      <label>
        Your name
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
          <option value="" disabled>
            Select…
          </option>
          {verified.students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={!studentId}>
        Continue
      </button>
    </form>
  )
}
