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
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import {
  DEFAULT_STREAK_RESET_DAYS,
  effectiveStreak,
  findStreakContribution,
  normalizeStudent,
  remapStudentDivisions,
  streakAfterRemoving,
  streakContributionsField,
  todayISO,
} from './calc'
import { DEFAULT_CURRENCY_RATES } from './currency'

// --- System log ---------------------------------------------------------
// Every meaningful write below ends with one of these, so Settings' System
// Log page can show a full audit trail (who changed what, when) without
// needing Cloud Functions to intercept writes - the client just logs each
// edit itself, right alongside the edit it's describing. `at` is a plain
// ISO string (not serverTimestamp()) for the same reason the streak
// timestamps are: the log has to read correctly from the same optimistic,
// no-round-trip local cache every other write in this file gets, and a
// server-computed value can't be known until the write round-trips.
function logEntry(entity, action, summary) {
  const user = auth.currentUser
  return { at: new Date().toISOString(), uid: user?.uid || '', email: user?.email || '', entity, action, summary }
}

function logChange(teamId, entity, action, summary) {
  return addDoc(collection(db, 'teams', teamId, 'log'), logEntry(entity, action, summary))
}

// Clears every log entry older than `retentionDays` - there's no Cloud
// Function on this free plan to run this on a schedule, so it's triggered
// instead the one place an admin is actually looking at the log: when the
// System Log page itself mounts (see SystemLog.jsx).
export async function purgeOldLogEntries(teamId, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const snap = await getDocs(query(collection(db, 'teams', teamId, 'log'), where('at', '<', cutoff)))
  if (snap.empty) return
  await commitAll(snap.docs.map((d) => (batch) => batch.delete(d.ref)))
}

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
  'streakResetDays',
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
      streakResetDays: team.streakResetDays || DEFAULT_STREAK_RESET_DAYS,
    },
    { merge: true }
  )
}

export function updateTeam(teamId, changes) {
  const mirror = productSettingsMirror(changes)
  const writes = [
    updateDoc(doc(db, 'teams', teamId), changes),
    logChange(teamId, 'team', 'update', `Updated team settings (${Object.keys(changes).join(', ')})`),
  ]
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
// `categoryBudgets` is already keyed by the new names (Settings computes it
// from the same rows `categories` comes from) - it's just written as-is,
// alongside `categories`, on the team doc only (the dashboard budget
// section is admin-only, so it has no need for the student-facing mirror).
export async function updateCategories(teamId, categories, renames, categoryBudgets, consumableCategories) {
  const snap = await getDocs(collection(db, 'teams', teamId, 'products'))
  const writes = [
    (batch) => batch.update(doc(db, 'teams', teamId), { categories, categoryBudgets, consumableCategories }),
    (batch) =>
      batch.set(doc(db, 'teams', teamId, 'settings', 'products'), { categories, consumableCategories }, { merge: true }),
    (batch) => batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('category', 'update', 'Updated product categories')),
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
  const writes = [
    (batch) => batch.update(doc(db, 'teams', teamId), changes),
    (batch) => batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('team', 'update', 'Updated team settings and divisions')),
  ]
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
  await logChange(teamId, 'team', 'create', 'Cloned content from another team')
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
  await logChange(teamId, 'team', 'delete', 'Cleared trainings, certifications, and events ahead of a clone overwrite')
}

// Community-hours settings (target hours + the list of community types
// admins define) live in their own doc rather than on the main team doc, so
// firestore.rules can let verified students read just this - not the admin
// codes and other settings that live on teams/{teamId} itself.
export function setCommunitySettings(teamId, changes) {
  return Promise.all([
    setDoc(doc(db, 'teams', teamId, 'settings', 'community'), changes, { merge: true }),
    logChange(teamId, 'communitySettings', 'update', 'Updated community-hours settings'),
  ])
}

// Takes the whole log entry (not just its id) purely so the audit trail can
// say what was deleted - the caller (StudentProfile.jsx) already has it in
// hand from the table row, so this costs no extra read.
export function deleteCommunityLog(teamId, log) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'communityLogs', log.id)),
    logChange(teamId, 'communityLog', 'delete', `Deleted a community-hours entry (${log.hours}h, ${log.type}, ${log.date})`),
  ])
}

export function addEvent(teamId, event) {
  return Promise.all([
    addDoc(collection(db, 'teams', teamId, 'events'), event),
    logChange(teamId, 'event', 'create', `Added event "${event.name}" (${event.date})`),
  ])
}

export function updateEvent(teamId, eventId, changes) {
  return Promise.all([
    updateDoc(doc(db, 'teams', teamId, 'events', eventId), changes),
    logChange(teamId, 'event', 'update', `Updated event "${changes.name || eventId}"`),
  ])
}

// Takes the whole event (not just its id) - Settings.jsx already has it at
// the call site, so the log can name it without an extra read.
export function deleteEvent(teamId, event) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'events', event.id)),
    logChange(teamId, 'event', 'delete', `Deleted event "${event.name}"`),
  ])
}

export function addStudent(teamId, student) {
  return Promise.all([
    addDoc(collection(db, 'teams', teamId, 'students'), { ...student, order: Date.now() }),
    logChange(teamId, 'student', 'create', `Added student "${student.fullName}"`),
  ])
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
  if (writes.length) {
    writes.push((batch) => batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry(collectionName, 'update', `Reordered ${collectionName}`)))
  }
  return commitAll(writes).catch((err) => {
    alert(`Couldn't save the new order: ${err.message}`)
    throw err
  })
}

export function updateStudent(teamId, studentId, changes) {
  return Promise.all([
    updateDoc(doc(db, 'teams', teamId, 'students', studentId), {
      ...changes,
      // Clears the pre-multi-division fields off docs that still carry them
      // (see normalizeStudent in calc.js); a no-op on docs that don't.
      division: deleteField(),
      subdivision: deleteField(),
    }),
    logChange(teamId, 'student', 'update', `Updated student "${changes.fullName || studentId}"`),
  ])
}

// Takes the whole student (not just its id) - every call site already has
// it in hand from the row it's deleting, so the log can name it without an
// extra read.
export function deleteStudent(teamId, student) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'students', student.id)),
    logChange(teamId, 'student', 'delete', `Deleted student "${student.fullName}"`),
  ])
}

export function addTraining(teamId, training) {
  return Promise.all([
    addDoc(collection(db, 'teams', teamId, 'trainings'), {
      completedStudentIds: [],
      ...training,
      order: Date.now(),
    }),
    logChange(teamId, 'training', 'create', `Added ${training.category === 'professional' ? 'certification' : 'training'} "${training.name}"`),
  ])
}

export function updateTraining(teamId, trainingId, changes) {
  return Promise.all([
    updateDoc(doc(db, 'teams', teamId, 'trainings', trainingId), changes),
    logChange(teamId, 'training', 'update', `Updated training "${changes.name || trainingId}"`),
  ])
}

// Takes the whole training (not an id) for two reasons: the log can name it
// without an extra read, and every student's streak has to be checked for a
// contribution pointing at it - deleting a training a student was credited
// for reverts their streak by exactly that one completion (see
// streakAfterRemoving in calc.js), same as unchecking it would (see
// setTrainingCompletion below), just applied to everyone who had it at
// once. Reads the whole roster because there's no query for "students whose
// streakContributions array contains an entry with this trainingId" -
// arrays of objects can't be queried that specifically - so this is the
// same full-roster-scan pattern updateTeamStructure already uses to fix up
// students on a structural change.
export async function deleteTraining(teamId, training) {
  const studentsSnap = await getDocs(collection(db, 'teams', teamId, 'students'))
  const writes = [(batch) => batch.delete(doc(db, 'teams', teamId, 'trainings', training.id))]
  for (const d of studentsSnap.docs) {
    const student = { id: d.id, ...d.data() }
    const contribution = findStreakContribution(
      student.streakContributions,
      (c) => c.type === 'training' && c.trainingId === training.id
    )
    if (!contribution) continue
    const { streak, lastAt } = streakAfterRemoving(student.streakContributions, contribution)
    writes.push((batch) =>
      batch.update(d.ref, {
        streakContributions: arrayRemove(contribution),
        trainingStreak: streak,
        trainingStreakUpdatedAt: lastAt || deleteField(),
      })
    )
  }
  writes.push((batch) =>
    batch.set(
      doc(collection(db, 'teams', teamId, 'log')),
      logEntry('training', 'delete', `Deleted ${training.category === 'professional' ? 'certification' : 'training'} "${training.name}"`)
    )
  )
  await commitAll(writes)
}

// Checking a training off also advances the student's training streak (see
// effectiveStreak in calc.js) and records which training earned it (see
// DEFAULT_STREAK_CONTRIBUTIONS in calc.js) - that's what lets the streak
// badge on a profile be clicked open into a breakdown of what counted, and
// what lets unchecking (below) or deleting the training (deleteTraining
// above) find exactly the right entry to revert. Takes the whole training
// and student (rather than just ids) since the caller already has both
// live from useTrainings/useStudents - reading them fresh here would mean a
// transaction, and Firestore transactions skip the local-cache optimistic
// echo plain updateDoc gets, which would make the checkbox itself feel
// laggy.
export function setTrainingCompletion(teamId, training, student, completed, resetDays = DEFAULT_STREAK_RESET_DAYS) {
  const trainingRef = doc(db, 'teams', teamId, 'trainings', training.id)
  const writes = [updateDoc(trainingRef, { completedStudentIds: completed ? arrayUnion(student.id) : arrayRemove(student.id) })]
  if (completed) {
    const contribution = {
      id: crypto.randomUUID(),
      type: 'training',
      trainingId: training.id,
      trainingName: training.name,
      at: new Date().toISOString(),
    }
    writes.push(
      updateDoc(doc(db, 'teams', teamId, 'students', student.id), {
        trainingStreak: effectiveStreak(student, resetDays) + 1,
        trainingStreakUpdatedAt: contribution.at,
        streakContributions: arrayUnion(contribution),
      })
    )
    writes.push(logChange(teamId, 'trainingCompletion', 'update', `Marked ${student.fullName} as completing "${training.name}"`))
  } else {
    // Only reverts the streak if this training is actually still one of
    // this student's contributions - toggling a checkbox that's already in
    // whatever state it's headed to (a stale click, a race between two
    // admins) shouldn't silently eat another streak day it didn't earn.
    const contribution = findStreakContribution(
      student.streakContributions,
      (c) => c.type === 'training' && c.trainingId === training.id
    )
    if (contribution) {
      const { streak, lastAt } = streakAfterRemoving(student.streakContributions, contribution)
      writes.push(
        updateDoc(doc(db, 'teams', teamId, 'students', student.id), {
          streakContributions: arrayRemove(contribution),
          trainingStreak: streak,
          trainingStreakUpdatedAt: lastAt || deleteField(),
        })
      )
    }
    writes.push(logChange(teamId, 'trainingCompletion', 'update', `Unmarked ${student.fullName}'s completion of "${training.name}"`))
  }
  return Promise.all(writes)
}

// Admin-only edit to a student's training or community streak - either the
// count itself or the frozen flag (see the streak controls in
// StudentProfileView; attendance has no manual controls at all, since it's
// computed live rather than stored - see attendanceStreak in calc.js).
// Setting the count directly collapses that kind's contributions down to
// just one manual entry recording who set it to what and when (see
// DEFAULT_STREAK_CONTRIBUTIONS in calc.js) - later real completions build
// back up from there, and the breakdown under the streak badge shows the
// override instead of silently keeping old entries an admin just
// overwrote. Setting the count, or unfreezing, both refresh the timestamp
// so the new value isn't immediately wiped out by a stale gap the next
// time it's read. Takes the whole student (not just its id) so the manual
// contribution and the log entry can both name them.
export function updateStudentStreak(teamId, student, kind, changes) {
  const payload = { ...changes }
  const writes = []
  const streakField = `${kind}Streak`
  const frozenField = `${kind}StreakFrozen`
  const updatedAtField = `${kind}StreakUpdatedAt`
  if (streakField in payload) {
    const user = auth.currentUser
    const contribution = {
      id: crypto.randomUUID(),
      type: 'manual',
      value: payload[streakField],
      by: user?.uid || '',
      byEmail: user?.email || '',
      at: new Date().toISOString(),
    }
    payload[streakContributionsField(kind)] = [contribution]
    payload[updatedAtField] = contribution.at
    writes.push(logChange(teamId, 'streak', 'update', `Set ${student.fullName}'s ${kind} streak to ${payload[streakField]}`))
  } else if (payload[frozenField] === false) {
    payload[updatedAtField] = new Date().toISOString()
    writes.push(logChange(teamId, 'streak', 'update', `Unfroze ${student.fullName}'s ${kind} streak`))
  } else if (payload[frozenField] === true) {
    writes.push(logChange(teamId, 'streak', 'update', `Froze ${student.fullName}'s ${kind} streak`))
  }
  writes.push(updateDoc(doc(db, 'teams', teamId, 'students', student.id), payload))
  return Promise.all(writes)
}

export function addSession(teamId, session) {
  return Promise.all([
    addDoc(collection(db, 'teams', teamId, 'sessions'), { ...session, order: Date.now() }),
    logChange(teamId, 'session', 'create', `Added session "${session.name}" (${session.date})`),
  ])
}

export function updateSession(teamId, sessionId, changes) {
  return Promise.all([
    updateDoc(doc(db, 'teams', teamId, 'sessions', sessionId), changes),
    logChange(teamId, 'session', 'update', `Updated session "${changes.name || sessionId}"`),
  ])
}

// Takes the whole session (not just its id) - Sessions.jsx already has it
// at the call site, so the log can name it without an extra read.
export function deleteSession(teamId, session) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'sessions', session.id)),
    logChange(teamId, 'session', 'delete', `Deleted session "${session.name}" (${session.date}) and its attendance`),
  ])
}

// Takes the whole session and student (not just ids) purely so the log can
// name both without an extra read - Sessions.jsx already has them live from
// useSessions/useStudents at the one call site.
export function setAttendance(teamId, session, student, status) {
  return Promise.all([
    setDoc(doc(db, 'teams', teamId, 'sessions', session.id, 'attendance', student.id), { status, studentId: student.id }),
    logChange(teamId, 'attendance', 'update', `Marked ${student.fullName} ${status} for "${session.name}"`),
  ])
}

export function clearAttendance(teamId, session, student) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'sessions', session.id, 'attendance', student.id)),
    logChange(teamId, 'attendance', 'update', `Cleared ${student.fullName}'s attendance for "${session.name}"`),
  ])
}

// Shared by Inventory and Orders - see normalizeProduct in calc.js.
export function addProduct(teamId, product) {
  return Promise.all([
    addDoc(collection(db, 'teams', teamId, 'products'), product),
    logChange(teamId, 'product', 'create', `Added product "${product.name}"`),
  ])
}

export function updateProduct(teamId, productId, changes) {
  return Promise.all([
    updateDoc(doc(db, 'teams', teamId, 'products', productId), changes),
    logChange(teamId, 'product', 'update', `Updated product "${changes.name || productId}"`),
  ])
}

// Takes the whole product (not just its id) - Inventory.jsx/Orders.jsx
// already have it at the call site, so the log can name it without an
// extra read.
export function deleteProduct(teamId, product) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'products', product.id)),
    logChange(teamId, 'product', 'delete', `Deleted product "${product.name}"`),
  ])
}

// Bulk add from Import CSV (see parseProductImport in csv.js, which is what
// validates and builds `products` before this is ever called) - batched via
// commitAll so a large import stays within Firestore's per-batch limits the
// same way a big reorder does. Logged as one entry, not one per row.
export function importProducts(teamId, products) {
  const writes = products.map((product) => (batch) => batch.set(doc(collection(db, 'teams', teamId, 'products')), product))
  writes.push((batch) =>
    batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('product', 'create', `Imported ${products.length} products`))
  )
  return commitAll(writes)
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
  batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('orderRequest', 'update', `Accepted ${request.requestedBy}'s request for "${request.name}"`))
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
  batch.set(
    doc(collection(db, 'teams', teamId, 'log')),
    logEntry('orderRequest', 'update', `Merged ${request.requestedBy}'s request into existing product "${existingProduct.name}"`)
  )
  return batch.commit()
}

// Takes the whole request (not just its id) - Orders.jsx already has it at
// the call site, so the log can name it without an extra read.
export function declineOrderRequest(teamId, request) {
  return Promise.all([
    deleteDoc(doc(db, 'teams', teamId, 'orderRequests', request.id)),
    logChange(teamId, 'orderRequest', 'delete', `Declined ${request.requestedBy}'s request for "${request.name}"`),
  ])
}

// Logging a purchase (the "+ Log a purchase" button on Orders) restocks the
// product by however many were bought and drops a dated record of it - the
// record snapshots the product's current name/category/price/currency
// rather than pointing at the product live (see DEFAULT_PURCHASE in
// calc.js), so it stays an accurate historical fact - and what the
// dashboard's budget section sums up as "spent" - even if the product is
// later renamed, recategorized, repriced, or deleted.
export function logPurchase(teamId, product, quantity) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'teams', teamId, 'products', product.id), {
    countInInventory: (product.countInInventory || 0) + quantity,
  })
  batch.set(doc(collection(db, 'teams', teamId, 'purchases')), {
    productId: product.id,
    productName: product.name,
    category: product.category || '',
    quantity,
    unitPrice: product.price || 0,
    currency: product.currency || 'NIS',
    date: todayISO(),
    dismissed: false,
  })
  batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('purchase', 'create', `Logged buying ${quantity} × "${product.name}"`))
  return batch.commit()
}

// Hides one purchase from Orders' Bought table without touching anything
// else about it - the stock it added and the money it counts toward the
// dashboard's "spent" total are unaffected. Contrast with revertPurchase
// below, which actually undoes it. Takes the whole purchase (not just its
// id) - Orders.jsx already has it at the call site, so the log can name it
// without an extra read.
export function dismissPurchase(teamId, purchase) {
  return Promise.all([
    updateDoc(doc(db, 'teams', teamId, 'purchases', purchase.id), { dismissed: true }),
    logChange(teamId, 'purchase', 'update', `Dismissed the purchase of ${purchase.quantity} × "${purchase.productName}" from Bought`),
  ])
}

// Fully undoes a logged purchase: deletes the record (so it stops counting
// toward spend) and, for a real product, gives back the stock it added.
// Uses increment rather than reading the product's current count first -
// the count may well have moved since the purchase (further purchases, a
// manual edit), and this only ever needs to remove exactly what THIS
// purchase itself added. A manual expense (see logFakePurchase) has no
// productId - there's no real stock to give back, so that half is skipped
// and this just deletes the record.
export function revertPurchase(teamId, purchase) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'teams', teamId, 'purchases', purchase.id))
  if (purchase.productId) {
    batch.update(doc(db, 'teams', teamId, 'products', purchase.productId), {
      countInInventory: increment(-purchase.quantity),
    })
  }
  batch.set(
    doc(collection(db, 'teams', teamId, 'log')),
    logEntry('purchase', 'delete', `Reverted the purchase of ${purchase.quantity} × "${purchase.productName}"`)
  )
  return batch.commit()
}

// A manual expense (the "+ Add a manual expense" button on the Bought
// items page) - money spent on something that was never a real product and
// never needs to be. It's the same purchases doc shape logPurchase writes,
// just with no productId and no inventory update, so it counts toward
// totalSpent/spentByCategory (and shows up in Orders' own Bought table,
// which never dereferences productId) exactly like a real one does.
export function logFakePurchase(teamId, purchase) {
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'teams', teamId, 'purchases')), {
    productId: '',
    productName: purchase.productName,
    category: purchase.category || '',
    quantity: purchase.quantity,
    unitPrice: purchase.unitPrice,
    currency: purchase.currency,
    date: purchase.date,
    dismissed: false,
  })
  batch.set(
    doc(collection(db, 'teams', teamId, 'log')),
    logEntry('purchase', 'create', `Logged a manual expense of ${purchase.quantity} × "${purchase.productName}"`)
  )
  return batch.commit()
}

// Admin-side CRUD for systems (see DEFAULT_SYSTEM in calc.js) - students
// manage their own the same way but through communityDb directly (see
// MySystems.jsx), the same split as products vs. orderRequests.
//
// `inventoryDeltas` (see consumableInventoryDeltas in calc.js) applies each
// consumable-category product's real stock change alongside the system
// write, in the same batch, so a system's claim on a consumable and that
// product's actual stock can never end up out of sync with each other.
export function addSystem(teamId, system, inventoryDeltas = []) {
  const writes = [
    (batch) => batch.set(doc(collection(db, 'teams', teamId, 'systems')), system),
    (batch) => batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('system', 'create', `Added system "${system.name}"`)),
    ...inventoryDeltas.map(
      ({ productId, delta }) =>
        (batch) =>
          batch.update(doc(db, 'teams', teamId, 'products', productId), { countInInventory: increment(-delta) })
    ),
  ]
  return commitAll(writes)
}

export function updateSystem(teamId, systemId, changes, inventoryDeltas = []) {
  const writes = [
    (batch) => batch.update(doc(db, 'teams', teamId, 'systems', systemId), changes),
    (batch) =>
      batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('system', 'update', `Updated system "${changes.name || systemId}"`)),
    ...inventoryDeltas.map(
      ({ productId, delta }) =>
        (batch) =>
          batch.update(doc(db, 'teams', teamId, 'products', productId), { countInInventory: increment(-delta) })
    ),
  ]
  return commitAll(writes)
}

// Takes the whole system (not just its id) - Systems.jsx already has it at
// the call site, so the log can name it without an extra read. Deleting a
// system returns every consumable it claimed (`inventoryDeltas` is the same
// shape as add/updateSystem's, computed by the caller with an empty
// `newNeeds`).
export function deleteSystem(teamId, system, inventoryDeltas = []) {
  const writes = [
    (batch) => batch.delete(doc(db, 'teams', teamId, 'systems', system.id)),
    (batch) => batch.set(doc(collection(db, 'teams', teamId, 'log')), logEntry('system', 'delete', `Deleted system "${system.name}"`)),
    ...inventoryDeltas.map(
      ({ productId, delta }) =>
        (batch) =>
          batch.update(doc(db, 'teams', teamId, 'products', productId), { countInInventory: increment(-delta) })
    ),
  ]
  return commitAll(writes)
}
