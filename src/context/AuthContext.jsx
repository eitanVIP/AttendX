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
