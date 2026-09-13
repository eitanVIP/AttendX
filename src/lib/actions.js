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

export function updateTeam(teamId, changes) {
  return updateDoc(doc(db, 'teams', teamId), changes)
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

function commitAll(writes) {
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
  const writes = [(batch) => batch.update(doc(db, 'teams', teamId), changes)]
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
