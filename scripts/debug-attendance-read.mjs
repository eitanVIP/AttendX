// Diagnostic script: signs in as a real admin account and runs the exact same
// Firestore reads the website does for attendance, one at a time, logging
// exactly what succeeds and what fails (with the real Firestore error code) -
// instead of guessing from the UI or the Console.
//
// Usage:
//   node scripts/debug-attendance-read.mjs <admin-email> <admin-password> <team-id>
//
// Example:
//   node scripts/debug-attendance-read.mjs you@example.com yourpassword team4744

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const path = join(__dirname, '..', '.env.local')
  const text = readFileSync(path, 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const [, , email, password, teamId] = process.argv
if (!email || !password || !teamId) {
  console.error('Usage: node scripts/debug-attendance-read.mjs <admin-email> <admin-password> <team-id>')
  process.exit(1)
}

const env = loadEnvLocal()
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const auth = getAuth(app)
const db = getFirestore(app)

async function tryStep(label, fn) {
  console.log(`\n--- ${label} ---`)
  try {
    const result = await fn()
    console.log('OK:', result)
    return { ok: true, result }
  } catch (err) {
    console.log('FAILED')
    console.log('  code:   ', err.code)
    console.log('  message:', err.message)
    return { ok: false, err }
  }
}

async function main() {
  const signInResult = await tryStep('Sign in', async () => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    return `signed in as ${cred.user.email} (uid ${cred.user.uid})`
  })
  if (!signInResult.ok) {
    console.log('\nStopping - sign-in failed, nothing past this point will work.')
    process.exit(1)
  }

  await tryStep(`Read users/{uid}/memberships/${teamId} (proves this account belongs to the team)`, async () => {
    const snap = await getDoc(doc(db, 'users', auth.currentUser.uid, 'memberships', teamId))
    return snap.exists() ? `membership exists: ${JSON.stringify(snap.data())}` : 'membership document does NOT exist'
  })

  await tryStep(`Read teams/${teamId}/sessions (plain collection read - control test)`, async () => {
    const snap = await getDocs(collection(db, 'teams', teamId, 'sessions'))
    return `${snap.size} session doc(s): ${snap.docs.map((d) => d.id).join(', ')}`
  })

  await tryStep(`Read teams/${teamId}/sessions/*/attendance (plain, one session at a time)`, async () => {
    const sessions = await getDocs(collection(db, 'teams', teamId, 'sessions'))
    const out = []
    for (const s of sessions.docs) {
      const attSnap = await getDocs(collection(db, 'teams', teamId, 'sessions', s.id, 'attendance'))
      out.push(`session ${s.id}: ${attSnap.size} doc(s) [${attSnap.docs.map((d) => `${d.id}=${d.data().status}`).join(', ')}]`)
    }
    return out.join(' | ') || 'no sessions to check'
  })

  await tryStep('collectionGroup("attendance") UNFILTERED (what the Attendance page / Dashboard use)', async () => {
    const snap = await getDocs(collectionGroup(db, 'attendance'))
    return `${snap.size} doc(s) returned across the whole project`
  })

  await tryStep('collectionGroup("attendance") FILTERED by studentId (what Student Profile uses)', async () => {
    const studentsSnap = await getDocs(collection(db, 'teams', teamId, 'students'))
    if (studentsSnap.empty) return 'no students in this team to test with'
    const studentId = studentsSnap.docs[0].id
    const snap = await getDocs(query(collectionGroup(db, 'attendance'), where('studentId', '==', studentId)))
    return `queried studentId=${studentId} (${studentsSnap.docs[0].data().fullName}), got ${snap.size} doc(s)`
  })

  console.log('\nDone.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected script error:', err)
  process.exit(1)
})
