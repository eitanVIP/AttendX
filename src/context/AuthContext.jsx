import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { DEFAULT_ACCENT } from '../lib/theme'
import { clearTeamContent, readTeamForClone, writeClonedContent } from '../lib/actions'

const AuthContext = createContext(null)

// Signing in (a Firebase Auth account) and belonging to a team are
// separate: `user` below is just an account. Teams are plain Firestore
// documents (teams/{teamId}, with a `code` field). Which teams someone
// belongs to lives in Firestore too, as users/{uid}/memberships/{teamId}
// docs - joining/creating a team creates one (gated by the team's code in
// firestore.rules), leaving a team deletes it. `activeTeamId` on the user's
// own doc picks which membership's data `team` currently reflects. `team`
// is a live subscription (not a one-time fetch) so edits made anywhere -
// e.g. the Settings page - show up immediately everywhere else.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null) // { email, activeTeamId }
  const [memberships, setMemberships] = useState([]) // [teamId, ...]
  const [team, setTeam] = useState(null) // the active team's full doc
  const [authLoading, setAuthLoading] = useState(true)

  const refreshProfile = useCallback(async (uid) => {
    const profileSnap = await getDoc(doc(db, 'users', uid))
    setProfile(profileSnap.exists() ? profileSnap.data() : null)

    const membershipsSnap = await getDocs(collection(db, 'users', uid, 'memberships'))
    setMemberships(membershipsSnap.docs.map((d) => d.id))
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (!firebaseUser) {
        setProfile(null)
        setMemberships([])
        setAuthLoading(false)
        return
      }
      try {
        await refreshProfile(firebaseUser.uid)
      } catch {
        setProfile(null)
        setMemberships([])
      }
      setAuthLoading(false)
    })
    return unsubscribe
  }, [refreshProfile])

  const activeTeamId =
    profile?.activeTeamId && memberships.includes(profile.activeTeamId)
      ? profile.activeTeamId
      : memberships[0] || null

  // Tracks which teamId the current `team` value actually reflects (a
  // resolved fetch, success or not-found alike) - computing "pending" from
  // this instead of a separate loading flag avoids a one-render race where
  // authLoading has already flipped false but the team effect hasn't run
  // yet, which would otherwise bounce a fresh sign-in out to /teams.
  const [teamCheckedFor, setTeamCheckedFor] = useState(null)
  const teamLoading = !!activeTeamId && teamCheckedFor !== activeTeamId

  useEffect(() => {
    if (!activeTeamId) {
      setTeam(null)
      setTeamCheckedFor(null)
      return
    }
    const unsubscribe = onSnapshot(
      doc(db, 'teams', activeTeamId),
      (snap) => {
        setTeam(snap.exists() ? { id: activeTeamId, ...snap.data() } : null)
        setTeamCheckedFor(activeTeamId)
      },
      () => {
        setTeam(null)
        setTeamCheckedFor(activeTeamId)
      }
    )
    return unsubscribe
  }, [activeTeamId])

  // Everything accent-coloured in the app reads --accent off the document
  // root - /login and /teams render outside the app shell, so scoping it to
  // any one subtree would leave them on the default blue.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', team?.colorPrimary || DEFAULT_ACCENT)
  }, [team?.colorPrimary])

  async function signup(email, password) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await setDoc(doc(db, 'users', cred.user.uid), { email })
    await refreshProfile(cred.user.uid)
  }

  async function login(email, password) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    setProfile(null)
    setMemberships([])
    await firebaseSignOut(auth)
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email)
  }

  async function joinTeam(teamId, code) {
    const uid = auth.currentUser.uid
    await setDoc(doc(db, 'users', uid, 'memberships', teamId), { code })
    await updateDoc(doc(db, 'users', uid), { activeTeamId: teamId })
    await refreshProfile(uid)
  }

  async function createTeam(teamId, code, studentCode, teamData) {
    const uid = auth.currentUser.uid
    const teamDoc = {
      divisions: [],
      subdivisionsByDivision: {},
      colorPrimary: DEFAULT_ACCENT,
      ...teamData,
      code,
      studentCode,
    }
    await setDoc(doc(db, 'teams', teamId), teamDoc)
    await setDoc(doc(db, 'users', uid, 'memberships', teamId), { code })
    await updateDoc(doc(db, 'users', uid), { activeTeamId: teamId })
    await refreshProfile(uid)
  }

  // Reading another team's subcollections needs hasAccess(sourceTeamId),
  // which means a membership doc - the same thing joining it would create.
  // Rather than requiring the admin to join first, this creates that
  // membership itself (which is also what checks the code is right: the
  // membership's create rule verifies it server-side), then removes it
  // again once the read is done - unless the caller already had it, i.e.
  // they're also an admin of the source team, in which case it's left
  // alone. Shared by both clone flows below.
  async function readSourceForClone(uid, sourceTeamId, sourceCode) {
    const sourceMembershipRef = doc(db, 'users', uid, 'memberships', sourceTeamId)
    const alreadyMember = (await getDoc(sourceMembershipRef)).exists()
    if (!alreadyMember) {
      try {
        await setDoc(sourceMembershipRef, { code: sourceCode })
      } catch {
        throw new Error('source-access')
      }
    }
    try {
      return await readTeamForClone(sourceTeamId)
    } finally {
      if (!alreadyMember) await deleteDoc(sourceMembershipRef).catch(() => {})
    }
  }

  // Copies another team's trainings, certifications, events, community
  // settings, divisions/subdivisions, and auto-inactive threshold into a
  // brand-new team - not its students, number, accent, name, or codes,
  // which the form below already asks for like any other new team.
  async function cloneTeam(teamId, code, studentCode, teamData, sourceTeamId, sourceCode) {
    const uid = auth.currentUser.uid
    const source = await readSourceForClone(uid, sourceTeamId, sourceCode)

    const teamDoc = {
      divisions: source.team.divisions || [],
      subdivisionsByDivision: source.team.subdivisionsByDivision || {},
      minAttendancePercent: source.team.minAttendancePercent || 0,
      colorPrimary: DEFAULT_ACCENT,
      ...teamData,
      code,
      studentCode,
    }
    await setDoc(doc(db, 'teams', teamId), teamDoc)
    await setDoc(doc(db, 'users', uid, 'memberships', teamId), { code })
    await writeClonedContent(teamId, source)
    await updateDoc(doc(db, 'users', uid), { activeTeamId: teamId })
    await refreshProfile(uid)
  }

  // The destructive twin of cloneTeam: instead of creating a new team,
  // replaces an EXISTING one's trainings, certifications, events, community
  // settings, divisions/subdivisions, and auto-inactive threshold with the
  // source's - permanently. Its students, number, name, codes, and accent
  // are untouched, same exclusions as a normal clone. The UI is expected to
  // have already made the caller confirm this in plain terms before calling
  // it; this only enforces that they actually have the destination's code.
  //
  // Gaining access to the destination reuses the join-by-code trick when
  // the caller isn't a member yet (and, unlike the source, keeps that
  // membership afterward - they've just proven they administer it). If
  // they're already a member, that trick can't re-verify the code (the
  // membership doc already exists, and updates to it are rule-blocked), so
  // the code is instead checked directly against the team doc they can
  // already read - still a real check, just not the security boundary
  // being tested, since they had access either way.
  async function overrideTeamWithClone(teamId, destinationCode, sourceTeamId, sourceCode) {
    if (teamId === sourceTeamId) throw new Error('same-team')
    const uid = auth.currentUser.uid
    const source = await readSourceForClone(uid, sourceTeamId, sourceCode)

    const destMembershipRef = doc(db, 'users', uid, 'memberships', teamId)
    const alreadyDestMember = (await getDoc(destMembershipRef)).exists()
    if (alreadyDestMember) {
      const destTeamSnap = await getDoc(doc(db, 'teams', teamId))
      if (!destTeamSnap.exists() || destTeamSnap.data().code !== destinationCode) throw new Error('dest-access')
    } else {
      try {
        await setDoc(destMembershipRef, { code: destinationCode })
      } catch {
        throw new Error('dest-access')
      }
    }

    await updateDoc(doc(db, 'teams', teamId), {
      divisions: source.team.divisions || [],
      subdivisionsByDivision: source.team.subdivisionsByDivision || {},
      minAttendancePercent: source.team.minAttendancePercent || 0,
    })
    await clearTeamContent(teamId)
    await writeClonedContent(teamId, source)
    await updateDoc(doc(db, 'users', uid), { activeTeamId: teamId })
    await refreshProfile(uid)
  }

  async function switchTeam(teamId) {
    const uid = auth.currentUser.uid
    await updateDoc(doc(db, 'users', uid), { activeTeamId: teamId })
    await refreshProfile(uid)
  }

  async function leaveTeam(teamId) {
    const uid = auth.currentUser.uid
    await deleteDoc(doc(db, 'users', uid, 'memberships', teamId))
    if (profile?.activeTeamId === teamId) {
      await updateDoc(doc(db, 'users', uid), { activeTeamId: null })
    }
    await refreshProfile(uid)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        memberships,
        team,
        loading: authLoading || teamLoading,
        signup,
        login,
        logout,
        resetPassword,
        joinTeam,
        createTeam,
        cloneTeam,
        overrideTeamWithClone,
        switchTeam,
        leaveTeam,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
