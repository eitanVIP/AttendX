// Creates a team (if it doesn't exist yet) and imports its student roster
// from a local JSON data file - see scripts/data/team3211-roster.example.json
// for the shape. The real roster files live under scripts/data/ and are
// gitignored: they contain real students' names and don't belong in a
// public repo.
//
// Trainings/certifications and past attendance are NOT handled by this
// script: the original sheet's per-training student columns didn't map
// unambiguously onto division/subdivision scope, so add those through the
// app UI instead once the team's real data is in place.
//
// Usage:
//   node scripts/seed-roster.mjs scripts/data/team3211-roster.json <team-code>

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { doc, setDoc } from 'firebase/firestore'
import { connect } from './lib/firebase-node.mjs'

const [, , dataFileArg, code] = process.argv
if (!dataFileArg || !code) {
  console.error('Usage: node scripts/seed-roster.mjs <path-to-roster.json> <team-code>')
  process.exit(1)
}

const rosterPath = resolve(dataFileArg)
const { teamId, team, students } = JSON.parse(readFileSync(rosterPath, 'utf8'))

const { auth, db } = await connect()

await setDoc(doc(db, 'teams', teamId), { ...team, code })
console.log(`Wrote team config for ${teamId}`)

// Writing the students subcollection needs hasAccess(teamId), which in turn
// needs this script's throwaway account to hold a membership doc for it.
await setDoc(doc(db, 'users', auth.currentUser.uid), { email: auth.currentUser.email })
await setDoc(doc(db, 'users', auth.currentUser.uid, 'memberships', teamId), { code })

for (const { id, ...student } of students) {
  await setDoc(doc(db, 'teams', teamId, 'students', id), {
    joinDate: null,
    notes: '',
    ...student,
  })
}
console.log(`Wrote ${students.length} students`)
console.log(`Sign up/sign in at the app, then use "Join a team" with team ID "${teamId}" and the code you chose.`)
process.exit(0)
