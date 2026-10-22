import { initializeApp } from 'firebase/app'
import { getAuth, inMemoryPersistence } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

// `npm run dev` (localhost) talks to the local Firestore emulator (`npm run
// emulators`); a production build (`npm run build`, i.e. whatever is deployed
// to Firebase Hosting) always talks to the real Firestore. Set
// VITE_USE_REAL_FIRESTORE=true in .env.local to point `npm run dev` at the
// real database instead.
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_REAL_FIRESTORE !== 'true'
const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 8080
// Emulator project ids starting with "demo-" are guaranteed never to touch
// a real Firebase project, whatever else is in the config.
const EMULATOR_PROJECT_ID = 'demo-attendx'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: useEmulator ? EMULATOR_PROJECT_ID : import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
// Firestore's default (memory) cache drops a document the moment its last
// listener goes away, and every page owns its own listeners - so each
// navigation used to re-read the entire team from the server (~1,500 reads
// a click on a real roster, against a 50K/day free allowance). The
// persistent cache keeps documents plus each query's resume token in
// IndexedDB: re-attaching a listener then fetches only what changed since,
// and a full page load starts from what's on disk. (The server still
// charges a full re-read for a listener that was away over 30 minutes.)
// Multi-tab so extra tabs share the cache and one connection rather than
// each falling back to memory. Queued writes persist too, so an edit made
// while the daily quota was out survives the reload the quota page does.
// (Against the emulator the cache stays in memory instead: a persistent one
// would keep showing documents from before the emulator's data was reset.)
export const db = initializeFirestore(app, {
  localCache: useEmulator ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// The public community-hours page (src/pages/CommunityHours.jsx) signs in
// anonymously without any admin ever "logging in" it. Firebase Auth syncs
// signed-in state across every tab of the same browser via local storage by
// default, so if it shared the app above, opening /log-hours in one tab
// would silently sign an admin out of their real session in another tab.
// A second named app with in-memory-only persistence keeps it fully
// isolated per-tab.
//
// The Firestore SDK attaches whichever auth state belongs to the SAME app
// instance it was created from - it does NOT look at other apps' signed-in
// users. So CommunityHours.jsx must use `communityDb` (bound to
// `communityApp`) for every read/write, never the plain `db` above, or its
// requests go out unauthenticated and every rule check fails.
export const communityApp = initializeApp(firebaseConfig, 'community')
export const communityAuth = getAuth(communityApp)
export const communityDb = getFirestore(communityApp)
communityAuth.setPersistence(inMemoryPersistence)

if (useEmulator) {
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT)
  connectFirestoreEmulator(communityDb, EMULATOR_HOST, EMULATOR_PORT)
  console.info(`[firebase] Using the local Firestore emulator at ${EMULATOR_HOST}:${EMULATOR_PORT} (project ${EMULATOR_PROJECT_ID})`)
}
