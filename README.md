# AttendX

Attendance and training/certification tracking for FRC teams DaVinci 4744 and
The Y Team 3211. Replaces a shared Google Sheet with a small React + Firestore
app.

## How it works

- Signing in and belonging to a team are separate concerns. Every person has
  their own Firebase Auth account (email + password) - `src/context/AuthContext.jsx`.
  Creating an account doesn't require a team at all.
- Each FRC team is a plain Firestore document (`teams/{teamId}`, with a
  `code` field) rather than an account of its own. The document id is the
  team's FRC number (e.g. `3211`) - it's chosen once at creation and can't
  be changed afterwards.
- Which teams a person belongs to is Firestore data too: a
  `users/{uid}/memberships/{teamId}` doc. It can only be created when the
  submitted code matches that team's `code` (enforced in `firestore.rules`),
  which is how joining or creating a team works - after that, logging back in
  is just normal email/password, no code needed again. Deleting a membership
  doc is how leaving a team works. A person can belong to several teams at
  once; `users/{uid}.activeTeamId` picks which one the app currently shows,
  and a switcher (click the team name in the header, or `/teams`) lets them
  change it, join another team, or create a new one. There's no separate
  admin/non-admin tier: anyone who joins a team has full access to it.
- All of a team's data (`students`, `trainings`, `sessions`) lives under
  `teams/{teamId}/...` in Firestore, and security rules only let someone
  with a membership for that team read/write its subtree.
- Attendance percentages, training completion %, and status labels are
  computed on the fly from raw records (see `src/lib/calc.js`) rather than
  stored - no spreadsheet-style formula drift.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in values from the Firebase console
npm run dev
```

## One-time Firebase project setup

1. Firebase Console -> Authentication -> Sign-in method -> enable **Email/Password**.
2. Firebase Console -> Firestore Database -> Create database (production mode).
3. Firestore -> Rules tab -> paste in `firestore.rules` -> Publish (or use the
   CLI commands below).
4. Open the app, create an account, then use "Create a team" with your FRC
   team number (or run the seed script below for team 3211's real roster and
   just "Join a team" with the code you passed it).

Key commands once the Firebase project exists:

```bash
firebase login
firebase use --add          # link this folder to your Firebase project
firebase deploy --only firestore:rules,firestore:indexes
npm run build
firebase deploy --only hosting
```

## Automatic deploys

`.github/workflows/deploy.yml` builds the site and deploys Hosting plus the
Firestore rules/indexes on every push to `main` (a merged PR counts). Set it up
once under GitHub -> Settings -> Secrets and variables -> Actions -> New
repository secret:

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`,
  `VITE_GOOGLE_CLIENT_ID` - same values as in your `.env.local`.
- `FIREBASE_SERVICE_ACCOUNT` - the full contents of a service-account JSON key.
  Firebase Console -> Project settings -> Service accounts -> Generate new
  private key. That account needs the **Firebase Admin** role (the default
  `firebase-adminsdk` account has it). Never commit the key file.

It can also be run by hand from the repository's Actions tab.

## Importing the original roster

`scripts/seed-roster.mjs` creates a team (if it doesn't exist yet) and writes
its student roster from a local JSON file - see
`scripts/data/team3211-roster.example.json` for the shape. Real roster files
live under `scripts/data/` and are gitignored: they contain real students'
names and don't belong in a public repo.

Trainings/certifications and past attendance were intentionally left out of
the auto-import - the original sheet's per-training student columns didn't
map unambiguously onto division/subdivision scope, so add those through the
app UI instead once the team's real data is in place.

```bash
node scripts/seed-roster.mjs scripts/data/team3211-roster.json <team-code-you-choose>
```
