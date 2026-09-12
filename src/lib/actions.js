import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

export function updateTeam(teamId, changes) {
  return updateDoc(doc(db, 'teams', teamId), changes)
}

// Community-hours settings (target hours + the list of community types
// admins define) live in their own doc rather than on the main team doc, so
// firestore.rules can let verified students read just this - not the admin
// codes and other settings that live on teams/{teamId} itself.
export function setCommunitySettings(teamId, changes) {
  return setDoc(doc(db, 'teams', teamId, 'settings', 'community'), changes, { merge: true })
}

export function addStudent(teamId, student) {
  return addDoc(collection(db, 'teams', teamId, 'students'), student)
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
  return addDoc(collection(db, 'teams', teamId, 'sessions'), session)
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
