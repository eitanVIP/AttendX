import { initializeApp } from 'firebase/app'
import { getAuth, inMemoryPersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

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
