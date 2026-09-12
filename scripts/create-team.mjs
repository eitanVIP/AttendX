// Creates a brand-new team doc directly in Firestore (teams/{teamNumber}).
// Teams themselves are just data, gated by the `code` field and the
// firestore.rules create rule (a team number can only be claimed once) -
// nobody is added as a member by this script, since it's not a real
// person's account. Whoever will actually use the team should sign up/sign
// in at the app and use "Join a team" with this team number and code.
//
// Usage:
//   node scripts/create-team.mjs <frc-team-number> <code> "<display name>"

import { doc, setDoc } from 'firebase/firestore'
import { connect } from './lib/firebase-node.mjs'

const [, , teamNumber, code, name] = process.argv
if (!teamNumber || !code) {
  console.error('Usage: node scripts/create-team.mjs <frc-team-number> <code> "<display name>"')
  process.exit(1)
}
if (!/^[1-9][0-9]{0,4}$/.test(teamNumber)) {
  console.error('Team number must be 1-5 digits with no leading zero (firestore.rules enforces this).')
  process.exit(1)
}
if (code.length < 4) {
  console.error('Code must be at least 4 characters (firestore.rules enforces this).')
  process.exit(1)
}

const { db } = await connect()

await setDoc(doc(db, 'teams', teamNumber), {
  name: name || `Team ${teamNumber}`,
  code,
  divisions: [],
  subdivisionsByDivision: {},
  colorPrimary: '#2563eb',
})

console.log(`Created teams/${teamNumber}. Sign up/sign in at the app, then use "Join a team" with team number ${teamNumber} and the code you chose.`)
process.exit(0)
