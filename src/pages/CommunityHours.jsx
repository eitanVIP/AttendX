import { useEffect, useMemo, useState } from 'react'
import { addDoc, arrayUnion, collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore'
import { communityDb } from '../firebase'
import { effectiveStreak, formatDate, studentCommunityHours, todayISO } from '../lib/calc'
import { logStudentChange } from '../lib/communityLog'
import { useStudentAuth } from '../context/StudentAuthContext'
import { t } from '../lib/i18n'

// A StudentLayout tab - sign-in (including which student this is) already
// happened at /student-login (see StudentAuthContext), so this only has to
// fetch the one thing that's actually per-visit rather than part of that
// shared sign-in: the log entries themselves, needed for the "hours logged
// so far" running total.
export default function CommunityHours() {
  const { verified, studentId, student } = useStudentAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('')
  const [hours, setHours] = useState('')
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)

  useEffect(() => {
    document.title = `AttendX | ${t('Log hours')}`
  }, [])

  useEffect(() => {
    let cancelled = false
    getDocs(collection(communityDb, 'teams', verified.teamId, 'communityLogs')).then((snap) => {
      if (cancelled) return
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [verified.teamId])

  const loggedHours = useMemo(() => studentCommunityHours(logs, studentId), [logs, studentId])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const entry = { studentId, type, hours: Number(hours), notes: notes.trim(), date }
      await addDoc(collection(communityDb, 'teams', verified.teamId, 'communityLogs'), entry)
      setLogs((prev) => [...prev, entry])

      // Advances the community streak the same way a completed training
      // advances the training one (see setTrainingCompletion in
      // actions.js) - one contribution per logged entry, reset the same
      // `streakResetDays` days after the last one. Re-reads the student
      // doc fresh rather than trusting StudentAuthContext's cached
      // `verified.students` snapshot (fetched once at sign-in), since
      // that's the only way to know the CURRENT streak to add 1 to.
      const studentSnap = await getDoc(doc(communityDb, 'teams', verified.teamId, 'students', studentId))
      const currentStudent = studentSnap.exists() ? studentSnap.data() : {}
      const contribution = {
        id: crypto.randomUUID(),
        type: 'log',
        hours: entry.hours,
        communityType: entry.type,
        at: new Date().toISOString(),
      }
      await updateDoc(doc(communityDb, 'teams', verified.teamId, 'students', studentId), {
        communityStreak: effectiveStreak(currentStudent, verified.streakResetDays, 'community') + 1,
        communityStreakUpdatedAt: contribution.at,
        communityStreakContributions: arrayUnion(contribution),
      })

      await logStudentChange(
        verified.teamId,
        'communityLog',
        'create',
        `Logged ${entry.hours}h of ${entry.type} (${formatDate(entry.date)})`,
        student?.fullName
      )

      setJustSubmitted(true)
      setType('')
      setHours('')
      setDate(todayISO())
      setNotes('')
    } catch {
      setError(t('Something went wrong submitting that - please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="page-loading">{t('Loading…')}</div>

  return (
    <div className="page">
      <h1>{t('Log community hours')}</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
        {justSubmitted && <p className="muted">{t('Logged! You can add another entry below.')}</p>}
        {verified.hoursTarget > 0 && (
          <p className="muted" style={{ margin: 0 }}>
            {t('{logged} / {target} hours logged so far', { logged: loggedHours, target: verified.hoursTarget })}
          </p>
        )}
        <label>
          {t('Community type')}
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            disabled={verified.communityTypes.length === 0}
          >
            <option value="" disabled>
              {verified.communityTypes.length === 0 ? t('No types set up yet - ask an admin') : t('Select…')}
            </option>
            {verified.communityTypes.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Hours')}
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
          {t('Date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          {t('Notes')}
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('What did you do?')} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={submitting || verified.communityTypes.length === 0}>
          {submitting ? t('Submitting…') : t('Submit')}
        </button>
      </form>
    </div>
  )
}
