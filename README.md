# AttendX

**One place to run your FRC team's people, practice and parts.**

AttendX replaces the sprawling team spreadsheet with a purpose-built web app.
It tracks who showed up, who is trained on what, how many community hours
each student has logged, and what's in the parts bin and the budget - live,
shared, and never out of sync.

Built for **FRC mentors, team leads and students**, and in daily use by FRC
teams DaVinci 4744 and The Y Team 3211.

## The problem

Most teams run on a Google Sheet that grew one tab at a time. Attendance is a
grid of colored cells, training sign-offs live in another tab, the shopping
list in a third, and every percentage is a formula someone eventually breaks.
Nobody knows who changed what, students can't see their own progress, and
asking a mentor "did I get certified yet?" is the only way to find out.

AttendX puts all of it in one app, with one source of truth, and gives
students a place of their own instead of a spreadsheet they're afraid to
touch.

## People

### Students
Keep your roster organized by division and sub-division, mark students active
or inactive, and reorder them the way your team thinks about them. Each
student has a profile with their attendance, trainings, certifications and
community hours in one view.

### Attendance
Create a session, then mark every student present, late, absent or excused.
Sessions are grouped by division, inactive students stay available so their
records can still be filled in, and percentages and status labels update the
moment you change a cell.

### Streaks and leaderboards
Completing trainings, logging community hours and showing up each build a
streak. The dashboard shows the top streaks, and students get a full
leaderboard with their own row highlighted - a little friendly competition
that actually moves the numbers.

## Skills

### Trainings
Define the trainings your team needs, scoped to a division or sub-division so
students only see what applies to them. Add sub-trainings, set target dates,
and tick off completions straight from a table with frozen columns that stays
usable on a phone.

### Certifications
Bundle trainings into certifications - "can use the mill", "can drive the
robot" - and let the app work out who qualifies. A certification can only
require trainings its holders would actually see, and existing requirements
are never silently dropped when scopes change.

### Community hours
Set a required hours target and the types of community work your team does.
Students log their own hours from a dedicated page, and each entry feeds their
streak and their progress toward the target.

## Parts and money

### Inventory
A categorized, sub-categorized catalog of everything the team owns, with
filters, product types, per-product quantities and CSV export.

### Orders
See at a glance what still needs buying. Each product tracks how many the team
wants versus how many it has, with configurable "to buy" formulas, and
purchases are logged against the product, supplier and category.

### Student order requests
Students request a product from their own page instead of messaging a mentor.
Requests land in the Orders page, where an admin accepts or declines them.

### Budget
Set a budget and watch it against reality: what's been spent, by category and
by supplier, and where the money is going. Multiple currencies are supported
with configurable rates, and discounts and shipping can be logged too.

### Systems
Model the robot's systems and the parts each one needs. Systems claim items
from inventory, shortfalls can turn straight into order requests, and
consumable parts adjust real stock so the numbers can't drift apart.

## For students

Students don't get the mentor dashboard - they sign in with a student code and
get a focused set of pages of their own:

- **My profile** - attendance, trainings, certifications and streaks.
- **Log hours** - record community work in seconds.
- **Request order** - ask for the parts they need.
- **My systems** - plan the parts their systems use, with live availability
  that accounts for everyone else's claims.
- **Streaks** - the full leaderboard.

Team admins and students use separate codes, set from the team's settings.

## Overview

### Dashboard
Charts for attendance by student, training completion by grade, certification
coverage, top streaks and budget breakdowns, all computed from the raw records.

### Teams
One account can belong to several teams and switch between them. Joining a
team takes its code; creating one takes your FRC number.

### Events and Google Calendar
Track upcoming events with countdowns, and sync your session dates to a shared
Google Calendar.

### Audit log
Every change - who made it and when - is recorded in a system log, so "who
edited this?" always has an answer.

### Exports
Download any table as CSV, or save an offline copy of the site.

## Why it's different

**Nothing is stored that can be calculated.** Attendance percentages,
training completion and statuses are derived from raw records on the fly, not
kept in cells. No broken formulas, no copy-paste drift.

**Every team's data is walled off.** Firestore security rules ensure only
members of a team can read or write its records, and students can touch only
the small slice of data their pages need.

**It respects the free tier.** AttendX is designed to run on Firebase's free
plan, and shows a clear notice rather than breaking if the daily quota is hit.

## Tech stack

- **React 19** with **React Router 7**
- **Vite** for tooling, **oxlint** for linting
- **Firebase**: Authentication, Cloud Firestore, Hosting
- **Google Calendar API** for session sync
- **GitHub Actions** for continuous delivery
