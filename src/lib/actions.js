import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeStudent, remapStudentDivisions } from './calc'
import { DEFAULT_CURRENCY_RATES } from './currency'

// Mirrors just what the student area needs to read - the request-a-product
// form's own fields, the team name shown in its header, and the division
// structure My Profile needs to group a student's own certs/trainings and
// judge their auto-inactive status - not the admin join codes and
// everything else that lives on teams/{teamId} itself. Firestore rules
// can't expose part of a document, so this is its own doc under settings/
// (same reasoning as setCommunitySettings below), which firestore.rules
// lets a student read while the team doc stays admin-only.
const PRODUCT_SETTINGS_FIELDS = [
  'categories',
  'productTypes',
  'currencyRates',
  'name',
  'divisions',
  'subdivisionsByDivision',
  'minAttendancePercent',
]

function productSettingsMirror(changes) {
  const mirror = {}
  for (const key of PRODUCT_SETTINGS_FIELDS) {
    if (key in changes) mirror[key] = changes[key]
  }
  return mirror
}

// Keeps teams/{teamId}/settings/products in sync with whatever the team doc
// currently has for PRODUCT_SETTINGS_FIELDS - always merges the current
// values in, not just when the mirror doc is missing outright, so a field
// added to that list after a team's mirror doc already existed (e.g.
// divisions, added after name) still shows up without needing an admin to
// happen to re-save the section that owns it. Called once per team per
// admin session (see AuthContext), and right after creating/cloning a team,
// so the student area is never left reading a stale or incomplete mirror.
export async function ensureProductSettingsMirror(team) {
  const ref = doc(db, 'teams', team.id, 'settings', 'products')
  await setDoc(
    ref,
    {
      categories: team.categories || [],
      productTypes: team.productTypes || [],
      currencyRates: team.currencyRates || DEFAULT_CURRENCY_RATES,
      name: team.name || '',
      divisions: team.divisions || [],
      subdivisionsByDivision: team.subdivisionsByDivision || {},
      minAttendancePercent: team.minAttendancePercent || 0,
    },
    { merge: true }
  )
}

export function updateTeam(teamId, changes) {
  const mirror = productSettingsMirror(changes)
  const writes = [updateDoc(doc(db, 'teams', teamId), changes)]
  if (Object.keys(mirror).length) {
    writes.push(setDoc(doc(db, 'teams', teamId, 'settings', 'products'), mirror, { merge: true }))
  }
  return Promise.all(writes)
}

// Saving the category list has to reach every product referencing a
// renamed or removed category, same spirit as updateTeamStructure below for
// divisions/students. `renames` only needs actual renames (old name -> new
// name, for rows that survived under a different name) - a product whose
// category isn't in the new list AND isn't a rename's old name simply had
// that category removed outright, so it's cleared rather than looked up.
export async function updateCategories(teamId, categories, renames) {
  const snap = await getDocs(collection(db, 'teams', teamId, 'products'))
  const writes = [
    (batch) => batch.update(doc(db, 'teams', teamId), { categories }),
    (batch) => batch.set(doc(db, 'teams', teamId, 'settings', 'products'), { categories }, { merge: true }),
  ]
  for (const d of snap.docs) {
    const current = d.data().category || ''
    if (!current || categories.includes(current)) continue
    const next = renames[current] || ''
    writes.push((batch) => batch.update(d.ref, { category: next }))
  }
  await commitAll(writes)
}

// Firestore budgets 20 rules exists()/get() calls per batched write,
// counted across the batch's operations, and hasAccess() spends one per
// document. Identical calls are cached and cached calls don't count, and in
// practice 128-document reorder batches did go through (they're what used
// up the write quota on 12 Sep 2026 - the reverts seen that evening were
// the quota, not a rejection), so the budget shouldn't bite. The split is
// kept anyway as a cheap guard, since the docs only promise calls "may" be
// cached. Each `write` is a (batch) => void; the batches are committed
// together, so the local cache still applies them in one step.
const BATCH_LIMIT = 15

export function commitAll(writes) {
  const commits = []
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const write of writes.slice(i, i + BATCH_LIMIT)) write(batch)
    commits.push(batch.commit())
  }
  return Promise.all(commits)
}

// Saving the division structure has to reach every student that references
// a renamed or removed division/subdivision alongside the team doc, so no
// reader is left with a roster pointing at names the team no longer has.
// Students are re-read here rather than taken from the caller because
// useStudents already hides stale references (see firestore-hooks), and
// the fix has to be computed against what's actually stored.
export async function updateTeamStructure(teamId, changes, renames) {
  const structure = { divisions: changes.divisions, subdivisionsByDivision: changes.subdivisionsByDivision }
  const snap = await getDocs(collection(db, 'teams', teamId, 'students'))
  const mirror = productSettingsMirror(changes)
  const writes = [(batch) => batch.update(doc(db, 'teams', teamId), changes)]
  if (Object.keys(mirror).length) {
    writes.push((batch) => batch.set(doc(db, 'teams', teamId, 'settings', 'products'), mirror, { merge: true }))
  }
  for (const d of snap.docs) {
    const fixed = remapStudentDivisions(normalizeStudent(d.data()), structure, renames)
    if (fixed) writes.push((batch) => batch.update(d.ref, { ...fixed, division: deleteField(), subdivision: deleteField() }))
  }
  await commitAll(writes)
}

// The two halves of "clone a team": read everything the new team should
// copy off the source (requires the caller already has hasAccess to it -
// see cloneTeam in AuthContext, which arranges that via a temporary
// membership), then write it under the freshly created team. Split so the
// caller can create the new team doc in between (writeClonedContent needs
// hasAccess to the destination, which only exists once that doc and the
// caller's membership on it are in place).
export async function readTeamForClone(teamId) {
  const [teamSnap, trainingsSnap, eventsSnap, communitySnap] = await Promise.all([
    getDoc(doc(db, 'teams', teamId)),
    getDocs(collection(db, 'teams', teamId, 'trainings')),
    getDocs(collection(db, 'teams', teamId, 'events')),
    getDoc(doc(db, 'teams', teamId, 'settings', 'community')),
  ])
  return {
    team: teamSnap.data() || {},
    trainings: trainingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    events: eventsSnap.docs.map((d) => d.data()),
    communitySettings: communitySnap.exists() ? communitySnap.data() : null,
  }
}

// Trainings get new document ids (rather than reusing the source's) since
// they're being copied into a different collection; a certification's
// requiredTrainingIds has to follow along, or it would end up pointing at
// training ids that don't exist in the new team. completedStudentIds always
// resets to empty - the new team has none of the source's students.
export async function writeClonedContent(teamId, source) {
  const idMap = new Map(source.trainings.map((t) => [t.id, doc(collection(db, 'teams', teamId, 'trainings')).id]))
  const writes = source.trainings.map((t) => (batch) => {
    const { id, requiredTrainingIds, completedStudentIds: _completedStudentIds, ...rest } = t
    batch.set(doc(db, 'teams', teamId, 'trainings', idMap.get(id)), {
      ...rest,
      completedStudentIds: [],
      ...(requiredTrainingIds && { requiredTrainingIds: requiredTrainingIds.map((rid) => idMap.get(rid)).filter(Boolean) }),
    })
  })
  for (const event of source.events) {
    writes.push((batch) => batch.set(doc(collection(db, 'teams', teamId, 'events')), event))
  }
  await commitAll(writes)
  if (source.communitySettings) await setCommunitySettings(teamId, source.communitySettings)
}

// Wipes a team's trainings, certifications, events, and community-hours
// settings ahead of a destructive clone overriding them (see
// overrideTeamWithClone in AuthContext) - students and the team doc itself
// (its number, name, codes, accent) are untouched. Community settings reset
// to empty rather than being left as whatever the destination had, so a
// source with none of its own doesn't leave the old ones behind.
export async function clearTeamContent(teamId) {
  const [trainingsSnap, eventsSnap] = await Promise.all([
    getDocs(collection(db, 'teams', teamId, 'trainings')),
    getDocs(collection(db, 'teams', teamId, 'events')),
  ])
  const writes = [
    ...trainingsSnap.docs.map((d) => (batch) => batch.delete(d.ref)),
    ...eventsSnap.docs.map((d) => (batch) => batch.delete(d.ref)),
  ]
  await commitAll(writes)
  await setCommunitySettings(teamId, { hoursTarget: 0, types: [] })
}

// Community-hours settings (target hours + the list of community types
// admins define) live in their own doc rather than on the main team doc, so
// firestore.rules can let verified students read just this - not the admin
// codes and other settings that live on teams/{teamId} itself.
export function setCommunitySettings(teamId, changes) {
  return setDoc(doc(db, 'teams', teamId, 'settings', 'community'), changes, { merge: true })
}

export function deleteCommunityLog(teamId, logId) {
  return deleteDoc(doc(db, 'teams', teamId, 'communityLogs', logId))
}

export function addEvent(teamId, event) {
  return addDoc(collection(db, 'teams', teamId, 'events'), event)
}

export function updateEvent(teamId, eventId, changes) {
  return updateDoc(doc(db, 'teams', teamId, 'events', eventId), changes)
}

export function deleteEvent(teamId, eventId) {
  return deleteDoc(doc(db, 'teams', teamId, 'events', eventId))
}

export function addStudent(teamId, student) {
  return addDoc(collection(db, 'teams', teamId, 'students'), { ...student, order: Date.now() })
}

// Makes `order` equal each row's index in `orderedRows` (see sortByOrder in
// calc.js), writing only the rows whose stored value differs - after the
// first reorder that's just the two rows that swapped. Callers don't await
// this (the local cache re-sorts the table at once), so a rejected write is
// reported here rather than vanishing.
export function reorderDocs(teamId, collectionName, orderedRows) {
  const writes = []
  orderedRows.forEach((row, i) => {
    if (row.order === i) return
    writes.push((batch) => batch.update(doc(db, 'teams', teamId, collectionName, row.id), { order: i }))
  })
  return commitAll(writes).catch((err) => {
    alert(`Couldn't save the new order: ${err.message}`)
    throw err
  })
}

export function updateStudent(teamId, studentId, changes) {
  return updateDoc(doc(db, 'teams', teamId, 'students', studentId), {
    ...changes,
    // Clears the pre-multi-division fields off docs that still carry them
    // (see normalizeStudent in calc.js); a no-op on docs that don't.
    division: deleteField(),
    subdivision: deleteField(),
  })
}

export function deleteStudent(teamId, studentId) {
  return deleteDoc(doc(db, 'teams', teamId, 'students', studentId))
}

export function addTraining(teamId, training) {
  return addDoc(collection(db, 'teams', teamId, 'trainings'), {
    completedStudentIds: [],
    ...training,
    order: Date.now(),
  })
}

export function updateTraining(teamId, trainingId, changes) {
  return updateDoc(doc(db, 'teams', teamId, 'trainings', trainingId), changes)
}

export function deleteTraining(teamId, trainingId) {
  return deleteDoc(doc(db, 'teams', teamId, 'trainings', trainingId))
}

export function setTrainingCompletion(teamId, trainingId, studentId, completed) {
  return updateDoc(doc(db, 'teams', teamId, 'trainings', trainingId), {
    completedStudentIds: completed ? arrayUnion(studentId) : arrayRemove(studentId),
  })
}

export function addSession(teamId, session) {
  return addDoc(collection(db, 'teams', teamId, 'sessions'), { ...session, order: Date.now() })
}

export function updateSession(teamId, sessionId, changes) {
  return updateDoc(doc(db, 'teams', teamId, 'sessions', sessionId), changes)
}

export function deleteSession(teamId, sessionId) {
  return deleteDoc(doc(db, 'teams', teamId, 'sessions', sessionId))
}

export function setAttendance(teamId, sessionId, studentId, status) {
  return setDoc(doc(db, 'teams', teamId, 'sessions', sessionId, 'attendance', studentId), {
    status,
    studentId,
  })
}

export function clearAttendance(teamId, sessionId, studentId) {
  return deleteDoc(doc(db, 'teams', teamId, 'sessions', sessionId, 'attendance', studentId))
}

// Shared by Inventory and Orders - see normalizeProduct in calc.js.
export function addProduct(teamId, product) {
  return addDoc(collection(db, 'teams', teamId, 'products'), product)
}

export function updateProduct(teamId, productId, changes) {
  return updateDoc(doc(db, 'teams', teamId, 'products', productId), changes)
}

export function deleteProduct(teamId, productId) {
  return deleteDoc(doc(db, 'teams', teamId, 'products', productId))
}

// Bulk add from Import CSV (see parseProductImport in csv.js, which is what
// validates and builds `products` before this is ever called) - batched via
// commitAll so a large import stays within Firestore's per-batch limits the
// same way a big reorder does.
export function importProducts(teamId, products) {
  return commitAll(products.map((product) => (batch) => batch.set(doc(collection(db, 'teams', teamId, 'products')), product)))
}

// Accepting a student's request turns it into a real product - which is all
// "add it to inventory and orders" means, since those two pages are just two
// views of one products collection (see normalizeProduct in calc.js).
// Batched with deleting the request itself so the two can't ever end up
// half-applied (a product created but the request left behind, or vice
// versa).
export function acceptOrderRequest(teamId, request) {
  const { id, requestedBy: _requestedBy, requestedAt: _requestedAt, ...product } = request
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'teams', teamId, 'products')), product)
  batch.delete(doc(db, 'teams', teamId, 'orderRequests', id))
  return batch.commit()
}

// The Orders page offers this instead of acceptOrderRequest when the
// request's name matches a product that already exists (see
// findDuplicateProduct in calc.js) - rather than create a near-duplicate
// doc, it's really the same product, so only the requested quantity gets
// folded in. Everything else about the request (price, notes, custom
// fields, ...) is discarded - the existing product's own fields are left
// exactly as they were.
export function mergeOrderRequestIntoProduct(teamId, request, existingProduct, extraChanges = {}) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'teams', teamId, 'products', existingProduct.id), {
    wantedCount: (existingProduct.wantedCount || 0) + (request.wantedCount || 0),
    ...extraChanges,
  })
  batch.delete(doc(db, 'teams', teamId, 'orderRequests', request.id))
  return batch.commit()
}

export function declineOrderRequest(teamId, requestId) {
  return deleteDoc(doc(db, 'teams', teamId, 'orderRequests', requestId))
}

// Hides one product from Orders' Bought table without touching anything
// else about it - the product itself, and its to-buy math, are unaffected.
export function dismissBought(teamId, productId) {
  return updateDoc(doc(db, 'teams', teamId, 'products', productId), { boughtFlag: false })
}

export function dismissAllBought(teamId, productIds) {
  return commitAll(productIds.map((id) => (batch) => batch.update(doc(db, 'teams', teamId, 'products', id), { boughtFlag: false })))
}

// Admin-side CRUD for systems (see DEFAULT_SYSTEM in calc.js) - students
// manage their own the same way but through communityDb directly (see
// MySystems.jsx), the same split as products vs. orderRequests.
export function addSystem(teamId, system) {
  return addDoc(collection(db, 'teams', teamId, 'systems'), system)
}

export function updateSystem(teamId, systemId, changes) {
  return updateDoc(doc(db, 'teams', teamId, 'systems', systemId), changes)
}

export function deleteSystem(teamId, systemId) {
  return deleteDoc(doc(db, 'teams', teamId, 'systems', systemId))
}
