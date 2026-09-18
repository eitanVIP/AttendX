import { addDoc, collection } from 'firebase/firestore'
import { communityDb } from '../firebase'

// The student-side equivalent of logChange in actions.js - writes into the
// same teams/{teamId}/log collection the System Log page reads, but through
// communityDb (there's no admin Firebase Auth identity to attribute a
// student's own action to - see hasStudentAccess in firestore.rules). The
// signed-in student's name goes in `email`, the same field SystemLog.jsx
// already renders as "Who" for admin entries, so the log doesn't need its
// own separate "who" column just for student-initiated rows.
export function logStudentChange(teamId, entity, action, summary, studentName) {
  return addDoc(collection(communityDb, 'teams', teamId, 'log'), {
    at: new Date().toISOString(),
    uid: '',
    email: studentName || 'Unknown student',
    entity,
    action,
    summary,
  })
}
