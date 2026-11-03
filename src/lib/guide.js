// The in-app guide. Each section has topics; a topic is a heading plus any of
// `body` (paragraphs), `steps` (a numbered list) and `tips` (short extra
// notes). `keywords` only help the search box find a topic.

export const ADMIN_GUIDE = [
  {
    id: 'start',
    title: 'Getting started',
    intro: 'The first things to set up, in order.',
    topics: [
      {
        heading: 'First-time setup',
        steps: [
          'Sign in and pick your team (or create one with your FRC number). One account can belong to several teams.',
          'Settings → Divisions: add your divisions (Mechanical, Electrical, Software...) and any sub-divisions. They colour-code tasks and decide who sees which trainings.',
          'Settings → Codes: set the admin code (for mentors) and the student code (for students). Students sign in with the team number and the student code.',
          'Students: add your roster and put each student in a division.',
          'Create your first attendance session, trainings and tasks. Everything else can wait.',
        ],
        keywords: 'setup begin new team codes divisions',
      },
      {
        heading: 'Admins and students',
        body: [
          'Admins (mentors) see every page in the top bar. Students sign in with the student code and see only their own pages: Community Hours, Request Order, My Systems, Tasks, My Profile, Streaks and this guide.',
          'Students pick their name after signing in. There are no personal passwords, so treat the student code like a shared key. If a student reloads the page they have to sign in again.',
        ],
        keywords: 'login sign in student code admin code permissions',
      },
      {
        heading: 'Task leads',
        body: ['A task lead is a student you trust to run tasks. On Students, edit the student and tick "Task lead". Leads can create, edit, assign and move any task, approve finish requests and decide task requests - from their own Tasks page.'],
        keywords: 'lead permissions approve',
      },
    ],
  },
  {
    id: 'students',
    title: 'Students',
    intro: 'Your roster and each student\'s profile.',
    topics: [
      {
        heading: 'Adding and editing students',
        steps: ['Open Students and press the add button.', 'Enter the name, divisions and sub-divisions.', 'Reorder the list with the arrows to match how your team thinks of it.'],
        tips: ['A student\'s profile (click their name) shows attendance, trainings, certifications, community hours and streaks in one place.'],
        keywords: 'roster add edit profile order',
      },
      {
        heading: 'Active and inactive',
        body: [
          'Mark a student inactive by hand when they leave or pause. Inactive students are dimmed but still keep their records, and you can still fill in their attendance.',
          'If you set a minimum attendance percentage in Settings, a student who falls under it becomes "auto inactive". They become active again when their attendance recovers.',
        ],
        keywords: 'inactive auto inactive minimum attendance left team',
      },
      {
        heading: 'Deleting a student',
        body: ['Deleting a student removes them from the roster. Their old checkmarks no longer count towards training progress, so numbers stay correct.'],
        keywords: 'remove delete left',
      },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    intro: 'Sessions, statuses and how percentages are worked out.',
    topics: [
      {
        heading: 'Creating a session and marking attendance',
        steps: [
          'Attendance → New session. Pick the date, name and who it applies to (everyone or one division).',
          'In the table, set each student to Present, Late, Absent or Excused. Percentages update immediately.',
        ],
        tips: ['Sessions are grouped by division. Press Edit on a session to change its details, or use the arrows to reorder.'],
        keywords: 'meeting session present late absent excused mark',
      },
      {
        heading: 'Optional meetings',
        body: [
          'Some meetings are optional. Edit the session and tick "Optional meeting". The row turns purple with an "Optional" badge.',
          'Everyone counts as excused automatically, so staying home never hurts. Mark a student Present (or Late) only if they came: that counts as +1 and raises their percentage.',
        ],
        keywords: 'optional voluntary excused bonus',
      },
      {
        heading: 'How the percentage works',
        body: ['Percentage = (present + late) ÷ (present + late + absent). Excused and unmarked cells are ignored. Nothing is stored: it is recalculated from the records every time.'],
        keywords: 'percent calculation formula',
      },
      {
        heading: 'Attendance plans and skipped weeks',
        body: [
          'In Settings → Attendance plans you can define plans such as "3 meetings a week" and "1 a week". Each student is judged per week against their own plan, and the app flags students who miss their plan several weeks in a row.',
          'Skipped weeks (holidays, off weeks) are left out of attendance entirely. "Week starts on" sets which day a week begins.',
        ],
        keywords: 'plan per week skipped weeks holiday flag',
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    intro: 'Plan, assign and track the team\'s work.',
    topics: [
      {
        heading: 'Creating tasks',
        steps: [
          'Fast: type a title in the "+ Add task" box at the bottom of any column and press Enter. The current division and assignee filters carry over.',
          'Full: press "+ New task" for the form: title, description, assignee, division, start and due dates, status, priority and more.',
        ],
        tips: ['Duplicate (in the task form) makes a copy back in the first status with the checklist unticked.'],
        keywords: 'new add create quick add duplicate copy',
      },
      {
        heading: 'Statuses',
        body: ['Tasks move through statuses (To do, Doing, Done by default). Press Statuses to add, rename, reorder or remove them.'],
        steps: [
          'Tick "Finished" on the status(es) that mean a task is done. Finished tasks are never overdue and count for streaks and stats.',
          'Tick "Blocked" on a status such as Blocked. Moving a task there asks why, and the reason shows on the card.',
        ],
        tips: ['You cannot delete a status that still has tasks in it.'],
        keywords: 'statuses columns finished blocked custom',
      },
      {
        heading: 'Assignees, divisions and dates',
        body: [
          'A task has one assignee. Its colour comes from its division. Dates show as dd/mm/yy.',
          'Pick a start and due date to make a range (wiring the robot: 3 days). Tasks with dates appear in the Calendar, Timeline and workload views and sync to Google Calendar.',
        ],
        keywords: 'assign student colour division date range',
      },
      {
        heading: 'Waiting on other tasks',
        body: [
          'In the task form, "Waits for" lists the tasks that must be finished first. While any of them is unfinished the task shows a lock, stays in the first status, and cannot be scheduled to start before the prerequisite ends (the same day is fine).',
          'If you add a prerequisite to a task that is already in progress, it is moved back to the first status with a notice.',
        ],
        keywords: 'dependency waits for prerequisite lock blocked order',
      },
      {
        heading: 'Needs parts and robot systems',
        body: [
          'Under "Needs parts" pick products from your inventory. While a part is still on the to-buy list the task shows "Waiting for parts" and is locked. Log the purchase on Orders and the task unlocks by itself.',
          'A task can also be tagged with a robot system (from Systems). Use the "All systems" filter to see one system\'s tasks.',
        ],
        keywords: 'parts order inventory system link unlock',
      },
      {
        heading: 'Checklists, comments, links and projects',
        body: [
          'Checklist: small steps inside a task; the card shows progress like 2/5.',
          'Comments: a running discussion on the task. Links: Onshape documents, drawings, photos (web addresses only). Project: a free-text group name such as "Drivetrain v2" - see the Projects view for a progress bar per project.',
          'History (in the task form) lists who changed what and when.',
        ],
        keywords: 'checklist comment link project history notes',
      },
      {
        heading: 'Repeating tasks',
        body: ['Set "Repeats" to every day, week, 2 weeks or month. When you finish the task, the next copy is created with the dates moved on and the checklist reset. A task needs a start or due date to repeat, and it only creates the next copy once.'],
        keywords: 'repeat recurring weekly',
      },
      {
        heading: 'Student finish approval',
        body: [
          'An assignee who is not a lead can move their own task between the unfinished statuses, tick the checklist, comment, and press "Request done". They cannot move it to Done themselves.',
          'You see a banner and the card shows "Awaiting approval". Approve done moves it to the first Finished status; Send back clears the request and lets you leave a note, which goes into the task comments.',
        ],
        keywords: 'approve request done send back assignee',
      },
      {
        heading: 'Task requests from students',
        body: ['Any student can ask for a task. Requests appear above the board for you and the task leads. Accept opens the new-task form already filled in; Decline takes an optional reason that the student sees.'],
        keywords: 'request propose suggest',
      },
      {
        heading: 'Views',
        body: [
          'Board: a column per status, drag cards between them. List: ordered by date. Calendar: drag a task onto a day, move it, stretch it from either end, drop it on "No date" to clear its dates, or drop it on "Unassigned" to take its assignee off.',
          'Stats: open, overdue, finished per week, by division and student. Workload: who is busy over the next two weeks. Projects: progress per project. Timeline: a Gantt-style view with arrows for dependencies.',
        ],
        keywords: 'board list calendar stats workload projects timeline gantt drag',
      },
      {
        heading: 'Undo and hiding old tasks',
        body: [
          'After a drag, move, reschedule or unassign, an Undo bar appears for a few seconds.',
          'Tasks finished more than two weeks ago are hidden to keep the board clean. Tick "Show finished over 2 weeks ago" to see them. Stats always count everything.',
        ],
        keywords: 'undo archive hide old finished',
      },
      {
        heading: 'Google Calendar',
        body: ['Every task with a date syncs to the team Google Calendar as a multi-day entry. Syncing happens from an admin\'s browser after connecting in Settings → Google Calendar. Changes made by task leads sync the next time an admin opens Tasks.'],
        keywords: 'google calendar sync connect',
      },
      {
        heading: 'Celebrations, streak and reminders',
        body: [
          'Finishing a task plays a short confetti burst. The Tasks streak tab on the Dashboard and the student Streaks page counts finished tasks in a row.',
          'The Dashboard\'s "Needs attention" card lists finish requests, task requests, overdue tasks and tasks due in 3 days. Students see a badge on their Tasks tab for their own overdue or soon-due tasks.',
        ],
        keywords: 'confetti streak reminder badge attention overdue',
      },
    ],
  },
  {
    id: 'progress',
    title: 'Trainings, certifications and community hours',
    intro: 'What students have learned and given back.',
    topics: [
      {
        heading: 'Trainings',
        body: ['Define the trainings your team needs, optionally scoped to a division or sub-division so students only see what applies to them. Add sub-trainings and target dates, then tick completions straight from the table.'],
        keywords: 'training complete tick scope sub-training',
      },
      {
        heading: 'Certifications',
        body: ['A certification bundles trainings. A student earns it automatically once they have completed every required training - there is no manual step. If a required training is later deleted, it simply stops being required.'],
        tips: ['The progress badge on each training counts only students still on the team.'],
        keywords: 'certification certified earn required',
      },
      {
        heading: 'Community hours',
        body: ['Settings → Community hours sets the target and the types of work. Students log their own hours from their Community Hours page; each entry feeds their streak and progress.'],
        keywords: 'community hours log target',
      },
    ],
  },
  {
    id: 'parts',
    title: 'Parts and money',
    intro: 'Inventory, orders, borrowing and robot systems.',
    topics: [
      {
        heading: 'Inventory',
        body: ['A categorized catalog of everything the team owns, with filters, product types, quantities and CSV export. Product types can define their own fields and a "to buy" formula.'],
        keywords: 'inventory products stock catalog',
      },
      {
        heading: 'Orders and purchases',
        body: [
          'Orders shows what still needs buying: how many are wanted versus in stock, by supplier and category. Log purchases in the cart; stock goes up and the item leaves the to-buy list.',
          'Import an invoice as CSV (other formats are rejected), and export the order list with filters.',
        ],
        keywords: 'orders buy purchase cart invoice csv export',
      },
      {
        heading: 'Order ranges and spools',
        body: [
          'Settings → Suppliers has an optional order range per supplier (for example free shipping from 45 USD, customs under 75 USD). Orders tells you whether a supplier\'s total fits whole shipments.',
          'Products sold in spools can list spool sizes (like "7.6 m = 54, 15.2 m = 104"); Orders then suggests the cheapest combination that covers what you need.',
        ],
        keywords: 'range shipment spool wire supplier minimum maximum',
      },
      {
        heading: 'Budget and currencies',
        body: ['Settings → Budget and Currencies set your budget and exchange rates. The Dashboard shows spending by category and supplier.'],
        keywords: 'budget currency money spend',
      },
      {
        heading: 'Student order requests',
        body: ['Students request a product from their Request Order page. Requests land on Orders where you accept or decline them.'],
        keywords: 'request product student order',
      },
      {
        heading: 'Borrowing',
        body: ['Track items you lend to or borrow from other teams, what they owe you, and mark them returned.'],
        keywords: 'lend borrow loan other team',
      },
      {
        heading: 'Systems',
        body: ['Model the robot\'s systems and the parts each needs. A system claims items from inventory, shortfalls can become order requests, and consumable parts adjust real stock.'],
        keywords: 'systems robot parts claim',
      },
    ],
  },
  {
    id: 'overview',
    title: 'Dashboard, streaks and settings',
    intro: 'The big picture and where to change things.',
    topics: [
      {
        heading: 'Dashboard and streaks',
        body: [
          'The Dashboard shows attendance, training completion, certification coverage, budget breakdowns, events, top streaks and the Needs attention card.',
          'Streaks: Training, Community, Attendance and Tasks. Training and community streaks add one per completion and reset after the "streak reset days" in Settings. Attendance resets on an absence. The Tasks streak adds one per finished task.',
        ],
        keywords: 'dashboard streak leaderboard reset days',
      },
      {
        heading: 'What lives in Settings',
        body: [
          'Divisions, Team number, Your account, Events, Product categories, Budget, Suppliers, Product types, Currencies, Attendance plans (with skipped weeks and week start), Codes, Community hours, and Google Calendar.',
          'Also the minimum attendance percentage and the streak reset days.',
        ],
        keywords: 'settings configure codes',
      },
      {
        heading: 'Audit log and exports',
        body: ['Every change is recorded with who made it and when (Settings → Log). Tables can be downloaded as CSV.'],
        keywords: 'log history who changed export csv',
      },
    ],
  },
  {
    id: 'help',
    title: 'Troubleshooting',
    intro: 'The usual "why can\'t I...?" answers.',
    topics: [
      {
        heading: 'A task will not move or be scheduled',
        body: [
          'A lock icon means it is waiting on another task or a part. Finish that task, or log the part\'s purchase on Orders.',
          'A task cannot start before its prerequisite ends. A student cannot move a task to Done - they request it and a lead approves.',
        ],
        keywords: 'cannot move locked waiting refuse',
      },
      {
        heading: 'A student cannot see or change something',
        body: ['Plain students only see their own tasks. If a lead\'s changes are refused, they may have just been removed as a lead: have them sign out and back in.'],
        keywords: 'student cannot permission lead refused not saved',
      },
      {
        heading: 'Numbers look wrong',
        body: ['Percentages are recalculated from raw records, so wrong numbers usually mean a record is missing or a week was skipped. Check the session\'s cells and Settings → skipped weeks.'],
        keywords: 'wrong percentage progress',
      },
      {
        heading: 'Google Calendar stopped syncing',
        body: ['Reconnect in Settings → Google Calendar and open Tasks again; anything that changed meanwhile is caught up.'],
        keywords: 'google calendar reconnect',
      },
      {
        heading: 'A quota notice appears',
        body: ['The site runs on a free plan and shows a notice when the daily limit is reached. It resets daily.'],
        keywords: 'quota limit free tier',
      },
    ],
  },
]

export const STUDENT_GUIDE = [
  {
    id: 'signin',
    title: 'Signing in',
    intro: 'Getting into the site.',
    topics: [
      {
        heading: 'How to sign in',
        steps: ['Open the site and press "Log in as a student".', 'Enter your team number and the student code from your mentors.', 'Pick your name from the list.'],
        tips: ['If you reload the page you have to sign in again. Use the links at the top to move around.'],
        keywords: 'login code team number name',
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    intro: 'Your work for the team.',
    topics: [
      {
        heading: 'Your tasks',
        body: [
          'The Tasks tab shows the tasks assigned to you. The "Due this week" box lists what is overdue or due in the next 7 days, and a badge on the tab counts your tasks that are overdue (red) or due within 3 days.',
          'Switch between Board, List and Calendar at the top. Click a task to open it.',
        ],
        keywords: 'my tasks due week badge board list calendar',
      },
      {
        heading: 'Working on a task',
        steps: [
          'Move it between To do, Doing and Blocked with the status box on the card. If you pick Blocked, you will be asked why.',
          'Tick checklist items as you finish them and add comments to tell people how it is going.',
          'When it is finished, press "Request done". A lead or mentor approves it - you cannot move it to Done yourself. You will see a confetti burst when it is approved.',
        ],
        tips: ['A lock means the task is waiting on another task or on a part being bought, so it cannot be started yet.'],
        keywords: 'status move blocked checklist comment request done approve',
      },
      {
        heading: 'Asking for a new task',
        body: ['Press "Request a task", say what needs doing, and send it. You can see whether it is waiting, accepted or declined (with the reason) under "Your task requests".'],
        keywords: 'request suggest new task',
      },
      {
        heading: 'If you are a task lead',
        body: ['You see every task, can create, edit, assign and move them, approve finish requests, and accept or decline task requests. If a change does not save, you may have just lost lead status - sign out and back in.'],
        keywords: 'lead approve decline create edit',
      },
    ],
  },
  {
    id: 'hours',
    title: 'Community hours and orders',
    intro: 'Logging your work and asking for parts.',
    topics: [
      {
        heading: 'Log community hours',
        body: ['Open Community Hours, choose the type of work, enter the hours and save. Each entry counts towards your target and your streak.'],
        keywords: 'hours log community',
      },
      {
        heading: 'Request an order',
        body: ['Open Request Order, fill in the product you need and send it. Mentors accept or decline requests on their Orders page.'],
        keywords: 'order request product parts',
      },
      {
        heading: 'My Systems',
        body: ['Plan the parts your robot system uses. The page shows live availability that accounts for what everyone else has claimed.'],
        keywords: 'systems parts claim availability',
      },
    ],
  },
  {
    id: 'progress',
    title: 'Your progress',
    intro: 'Where you stand.',
    topics: [
      {
        heading: 'My Profile',
        body: ['Your attendance, trainings, certifications and streaks in one place. You earn a certification automatically when you finish all its trainings.'],
        keywords: 'profile attendance training certification',
      },
      {
        heading: 'Streaks',
        body: ['The Streaks page ranks the team on Training, Community, Attendance and Tasks streaks, with your own row highlighted. Keep finishing things regularly - streaks reset after a few days without progress.'],
        keywords: 'streak leaderboard rank',
      },
    ],
  },
]
