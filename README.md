# AttendX

**One place to run your FRC team's people, practice and parts.**

AttendX replaces the sprawling team spreadsheet with a purpose-built web app.
It tracks who showed up, who is trained on what, how many community hours
they've logged, and what's in the parts bin - all live, all shared, and never
out of sync.

Built for **FRC mentors and student leads**, and in daily use by FRC teams
DaVinci 4744 and The Y Team 3211.

## What you get

- **Attendance** - log sessions, mark each student present, late or absent, and
  see attendance percentages and status labels update instantly. Streaks keep
  students motivated to show up.
- **Trainings and certifications** - define trainings per division or
  sub-division, track who has completed them, and see exactly who still needs
  what before they touch the machines.
- **Community hours** - record outreach and service hours per student.
- **Inventory** - categorized and sub-categorized parts and materials, with
  filters and a purchase log.
- **Orders** - students request parts, mentors review and approve them.
- **Systems** - keep a log of robot systems and who is responsible for them.
- **Student profiles** - every student gets their own login to see their
  attendance, certifications and systems.
- **Multi-team** - one account can belong to several teams and switch between
  them. Joining a team takes a team code; creating one takes your FRC number.
- **Google Calendar sync** - push your session dates to a shared calendar.
- **Exports** - download any table as CSV, or save an offline copy of the site.

## Why it's different

Attendance percentages, training completion and statuses are **calculated from
raw records on the fly**, not stored in cells. No broken formulas, no
copy-paste drift, no "who edited this column?"

Each team's data is walled off by Firestore security rules - only members of a
team can read or write its records.

## Tech stack

- **React 19** with **React Router 7**
- **Vite** for tooling, **oxlint** for linting
- **Firebase**: Authentication, Cloud Firestore, Hosting
- **GitHub Actions** for continuous delivery
