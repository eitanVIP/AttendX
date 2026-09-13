import { useSyncExternalStore } from 'react'
import { onLog } from 'firebase/app'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

// Whether Firestore has rejected us with resource-exhausted (the Spark
// plan's daily read/write cap). Read by the route guard in App.jsx, which
// bounces the whole app to /quota-exceeded while it's set. Kept in
// sessionStorage so a refresh lands straight back on that page instead of
// on an app that looks fine (reads still serve from cache) while every
// write silently piles up in the queue.
const STORAGE_KEY = 'attendx.quotaExceeded'
const RETRY_MS = 30000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readStored() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let exceeded = readStored()
const listeners = new Set()

function setExceeded(next) {
  if (exceeded === next) return
  exceeded = next
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, '1')
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // no storage - the in-memory flag still covers this page load
  }
  listeners.forEach((l) => l())
}

// The SDK never hands a quota error to app code. It classifies
// resource-exhausted as retryable, so listeners keep serving cached data
// without calling their error callback, the write stream backs off (a
// minute at a time) and retries, and the promise from addDoc/updateDoc
// just stays pending - the change shows up in the UI from the local cache
// and is never saved. The one trace it leaves is the error it logs on
// every failed retry, and onLog is Firebase's public hook into that
// logging. It only attaches to logger instances that already exist, which
// is why this lives here rather than in firebase.js: importing db above
// guarantees Firestore's logger is one of them by the time this runs.
onLog(
  ({ message }) => {
    if (message.includes('resource-exhausted')) setExceeded(true)
  },
  { level: 'error' }
)

export function useQuotaExceeded() {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => exceeded
  )
}

// Resolves once Firestore accepts a read AND a write again - reads and
// writes have separate daily caps, so one working says nothing about the
// other. Neither probe needs to be allowed by the rules: a permission-
// denied is still the backend answering, which is all "quota's back"
// means, and nothing gets written.
//
// The two behave differently while the cap is hit. The write doesn't
// reject: the SDK queues it behind its own backoff-and-retry loop, so
// awaiting it IS the polling - it settles the moment a retry gets through
// (any real pending write from before is queued ahead of it and lands
// first). The read does reject, but with `unavailable`: after one failed
// connection the SDK declares the client offline and answers reads from
// cache at once. That's the SDK talking, not the server, so it's asked
// again after a pause until it says something else. Rejects only if the
// SDK ever starts throwing resource-exhausted instead of retrying, so a
// caller can back off itself.
export async function waitForQuota() {
  const probe = doc(db, 'quotaProbe', 'ping')
  async function readAnswered() {
    for (;;) {
      try {
        await getDoc(probe)
        return
      } catch (err) {
        if (err?.code !== 'unavailable' && err?.code !== 'resource-exhausted') return
        await sleep(RETRY_MS)
      }
    }
  }
  const writeAnswered = setDoc(probe, { at: Date.now() }).catch((err) => {
    if (err?.code === 'resource-exhausted') throw err
  })
  await Promise.all([readAnswered(), writeAnswered])
  setExceeded(false)
}
