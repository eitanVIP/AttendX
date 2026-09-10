import { useMemo, useState } from 'react'
import { loadSavedLogHoursCode, saveLogHoursCode } from '../lib/logHoursCode'
import { Link } from 'react-router-dom'
import { signInAnonymously } from 'firebase/auth'
import { addDoc, collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { communityAuth, communityDb } from '../firebase'
import { studentCommunityHours } from '../lib/calc'

// Public, no-account page: a student enters their team's *student* code
// (different from the admin code - see Teams.jsx) to unlock a simple
// hour-logging form. Uses the isolated `communityAuth` instance (see
// firebase.js) so it never disturbs an admin signed into this same browser
// in another tab.
export default function CommunityHours() {
  const [verified, setVerified] = useState(null) // { teamId, students, types, hoursTarget, logs }

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <h1>Log community hours</h1>
        {!verified ? (
          <CodeStep onVerified={setVerified} />
        ) : (
          <LogForm
            teamId={verified.teamId}
            students={verified.students}
            types={verified.types}
            hoursTarget={verified.hoursTarget}
            initialLogs={verified.logs}
          />
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          <Link to="/login">Admin? Sign in here</Link>
        </p>
      </div>
    </div>
  )
}

function friendlyError(err) {
  if (err.code === 'auth/admin-restricted-operation') {
    return 'This page is not enabled yet - ask your admin to turn on Anonymous sign-in in Firebase.'
  }
  if (err.code === 'permission-denied') {
    return 'Team ID or student code is incorrect.'
  }
  return `Something went wrong (${err.code || err.message || 'unknown error'}). Please try again.`
}

function CodeStep({ onVerified }) {
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
      const cleanTeamId = teamId.trim().toLowerCase()
      // Read the uid off the resolved credential rather than
      // communityAuth.currentUser - more robust against any timing gap
      // between sign-in resolving and the auth instance's own state update.
      const uid = communityAuth.currentUser
        ? communityAuth.currentUser.uid
        : (await signInAnonymously(communityAuth)).user.uid
      // Fails with permission-denied if the code doesn't match - see the
      // studentAccess create rule in firestore.rules. Must use communityDb
      // (bound to the same named app as communityAuth) - the default `db`
      // doesn't know about this app's signed-in user at all.
      await setDoc(doc(communityDb, 'studentAccess', uid), { teamId: cleanTeamId, code })

      const [studentsSnap, settingsSnap, logsSnap] = await Promise.all([
        getDocs(collection(communityDb, 'teams', cleanTeamId, 'students')),
        getDoc(doc(communityDb, 'teams', cleanTeamId, 'settings', 'community')),
        getDocs(collection(communityDb, 'teams', cleanTeamId, 'communityLogs')),
      ])
      const students = studentsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.status !== 'inactive')
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
      const settingsData = settingsSnap.exists() ? settingsSnap.data() : {}
      const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

      saveLogHoursCode(cleanTeamId, code)
      onVerified({
        teamId: cleanTeamId,
        students,
        types: settingsData.types || [],
        hoursTarget: settingsData.hoursTarget || 0,
        logs,
      })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="login-sub">Enter your team ID and the student code your mentors gave you.</p>
      <label>
        Team ID
        <input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="e.g. team3211" required />
      </label>
      <label>
        Student code
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Checking…' : 'Continue'}
      </button>
    </form>
  )
}

function LogForm({ teamId, students, types, hoursTarget, initialLogs }) {
  const [logs, setLogs] = useState(initialLogs)
  const [studentId, setStudentId] = useState('')
  const [type, setType] = useState('')
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)

  const loggedHours = useMemo(() => studentCommunityHours(logs, studentId), [logs, studentId])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const entry = {
        studentId,
        type,
        hours: Number(hours),
        notes: notes.trim(),
        date: new Date().toISOString().slice(0, 10),
      }
      await addDoc(collection(communityDb, 'teams', teamId, 'communityLogs'), entry)
      setLogs((prev) => [...prev, entry])
      setJustSubmitted(true)
      setType('')
      setHours('')
      setNotes('')
    } catch {
      setError('Something went wrong submitting that - please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {justSubmitted && <p className="muted">Logged! You can add another entry below.</p>}
      <label>
        Your name
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
          <option value="" disabled>
            Select…
          </option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName}
            </option>
          ))}
        </select>
      </label>
      {studentId && hoursTarget > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {loggedHours} / {hoursTarget} hours logged so far
        </p>
      )}
      <label>
        Community type
        <select value={type} onChange={(e) => setType(e.target.value)} required disabled={types.length === 0}>
          <option value="" disabled>
            {types.length === 0 ? 'No types set up yet - ask an admin' : 'Select…'}
          </option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hours
        <input
          type="number"
          min="0.25"
          step="0.25"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          required
        />
      </label>
      <label>
        Notes
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you do?" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting || types.length === 0}>
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  )
}
