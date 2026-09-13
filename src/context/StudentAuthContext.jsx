import { createContext, useContext, useState } from 'react'
import { signInAnonymously, signOut as firebaseSignOut } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { communityAuth, communityDb } from '../firebase'
import { DEFAULT_CURRENCY_RATES } from '../lib/currency'

const StudentAuthContext = createContext(null)

// One shared sign-in for every student-facing page (Community Hours,
// Request Order, My Systems) - each used to separately ask for the team
// number + student code itself (see the old CodeStep in CommunityHours.jsx/
// RequestOrder.jsx); now StudentLogin.jsx does it once, in two steps (team +
// code, then which student), and every page under StudentLayout just reads
// `verified`/`studentId` from here instead of asking again. Uses the
// isolated `communityAuth` instance (see firebase.js) so it never disturbs
// an admin signed into this same browser in another tab.
export function StudentAuthProvider({ children }) {
  const [verified, setVerified] = useState(null)
  const [studentId, setStudentId] = useState(null)

  async function verify(teamId, code) {
    // Read the uid off the resolved credential rather than
    // communityAuth.currentUser - more robust against any timing gap
    // between sign-in resolving and the auth instance's own state update.
    const uid = communityAuth.currentUser
      ? communityAuth.currentUser.uid
      : (await signInAnonymously(communityAuth)).user.uid
    // Fails with permission-denied if the code doesn't match - see the
    // studentAccess create rule in firestore.rules.
    await setDoc(doc(communityDb, 'studentAccess', uid), { teamId, code })

    // Team name/categories/product types/currencies live on the team doc,
    // which this access level can't read (it carries the admin join code) -
    // see the PRODUCT_SETTINGS_FIELDS comment in actions.js for why they're
    // mirrored onto their own settings/products doc instead. Fetched here
    // (not lazily per-page) so every tab renders immediately off the same
    // `verified` bag with no per-page loading state of its own.
    const [studentsSnap, productSettingsSnap, communitySettingsSnap] = await Promise.all([
      getDocs(collection(communityDb, 'teams', teamId, 'students')),
      getDoc(doc(communityDb, 'teams', teamId, 'settings', 'products')),
      getDoc(doc(communityDb, 'teams', teamId, 'settings', 'community')),
    ])
    // Inactive students are listed too: someone under the attendance
    // minimum still needs to log their hours or request a product, and
    // this page can't tell them apart from anyone else anyway.
    const students = studentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
    const productSettings = productSettingsSnap.exists() ? productSettingsSnap.data() : {}
    const communitySettings = communitySettingsSnap.exists() ? communitySettingsSnap.data() : {}

    setStudentId(null)
    setVerified({
      teamId,
      teamName: productSettings.name || '',
      students,
      categories: productSettings.categories || [],
      productTypes: productSettings.productTypes || [],
      currencyCodes: Object.keys(productSettings.currencyRates || DEFAULT_CURRENCY_RATES),
      communityTypes: communitySettings.types || [],
      hoursTarget: communitySettings.hoursTarget || 0,
    })
  }

  // Drops back to picking a name without re-verifying the team/code (that
  // stays valid) - what clicking your own name in StudentLayout's header
  // does.
  function changeStudent() {
    setStudentId(null)
  }

  async function logout() {
    setVerified(null)
    setStudentId(null)
    await firebaseSignOut(communityAuth)
  }

  const student = verified?.students.find((s) => s.id === studentId) || null

  return (
    <StudentAuthContext.Provider
      value={{ verified, studentId, student, verify, selectStudent: setStudentId, changeStudent, logout }}
    >
      {children}
    </StudentAuthContext.Provider>
  )
}

export function useStudentAuth() {
  const ctx = useContext(StudentAuthContext)
  if (!ctx) throw new Error('useStudentAuth must be used within StudentAuthProvider')
  return ctx
}
