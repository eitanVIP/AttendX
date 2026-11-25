import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_STATUSES,
  addDays,
  becameDone,
  checklistProgress,
  completionFields,
  daysBetween,
  assigneeOptions,
  describeChange,
  filterTasksByAssignee,
  divisionColor,
  dueSoon,
  duplicateOf,
  formatDMY,
  isOldDone,
  isOverdue,
  isWebLink,
  moveBlockedReason,
  nextOccurrence,
  parseDMY,
  prerequisiteCandidates,
  projectNames,
  projectSummaries,
  scheduleBlockedReason,
  sortTasks,
  sortTasksByDate,
  statusOf,
  taskDateLabel,
  taskLinks,
  taskStats,
  taskStatuses,
  taskStreaksByStudent,
  waitingOn,
  waitingParts,
  workloadRows,
} from './tasks'

const statuses = DEFAULT_TASK_STATUSES
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, statusId: 'todo', ...extra })

describe('statuses', () => {
  it('falls back to the default statuses', () => {
    expect(taskStatuses(undefined)).toBe(DEFAULT_TASK_STATUSES)
    expect(taskStatuses({ statuses: [] })).toBe(DEFAULT_TASK_STATUSES)
    const own = [{ id: 'a', name: 'A' }]
    expect(taskStatuses({ statuses: own })).toBe(own)
  })

  it('puts a task whose status was deleted in the first column', () => {
    expect(statusOf({ statusId: 'doing' }, statuses).id).toBe('doing')
    expect(statusOf({ statusId: 'deleted' }, statuses).id).toBe('todo')
    expect(statusOf({}, statuses).id).toBe('todo')
  })

  it('stamps completion only when a task becomes or stops being finished', () => {
    expect(completionFields(task('a'), 'done', statuses).completedAt).toBeTruthy()
    expect(completionFields(task('a', { statusId: 'done' }), 'todo', statuses)).toEqual({ completedAt: '' })
    expect(completionFields(task('a'), 'doing', statuses)).toEqual({})
    expect(completionFields(task('a', { statusId: 'done' }), 'done', statuses)).toEqual({})
    expect(completionFields(null, 'done', statuses).completedAt).toBeTruthy()
  })

  it('knows when a move finishes a task', () => {
    expect(becameDone(task('a'), 'done', statuses)).toBe(true)
    expect(becameDone(task('a', { statusId: 'done' }), 'done', statuses)).toBe(false)
    expect(becameDone(task('a'), 'doing', statuses)).toBe(false)
  })
})

describe('sorting', () => {
  it('sorts by priority, then due date, then age', () => {
    const tasks = [
      task('low', { priority: 'low', dueDate: '2026-01-01' }),
      task('normal-late', { priority: 'normal', dueDate: '2026-12-01' }),
      task('high-nodate', { priority: 'high' }),
      task('normal-soon', { priority: 'normal', dueDate: '2026-11-01' }),
      task('high-soon', { priority: 'high', dueDate: '2026-11-10' }),
    ]
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['high-soon', 'high-nodate', 'normal-soon', 'normal-late', 'low'])
  })

  it('sorts by the day a task starts, undated last', () => {
    const tasks = [task('c'), task('b', { dueDate: '2026-11-05' }), task('a', { startDate: '2026-11-01', dueDate: '2026-11-09' })]
    expect(sortTasksByDate(tasks).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('colours a division by its place in the team list', () => {
    expect(divisionColor('A', ['A', 'B'])).not.toBe(divisionColor('B', ['A', 'B']))
    expect(divisionColor('Z', ['A'])).toBe('#71717a')
    expect(divisionColor('', ['A'])).toBe('#71717a')
  })
})

describe('dates', () => {
  it('shows ISO dates as dd/mm/yy', () => {
    expect(formatDMY('2026-11-03')).toBe('03/11/26')
    expect(formatDMY('')).toBe('')
    expect(formatDMY('nonsense')).toBe('')
  })

  it('reads typed dates, rejecting ones that are not real', () => {
    expect(parseDMY('3/11/26')).toBe('2026-11-03')
    expect(parseDMY('03/11/2026')).toBe('2026-11-03')
    expect(parseDMY('3.11.26')).toBe('2026-11-03')
    expect(parseDMY('29/2/2028')).toBe('2028-02-29')
    expect(parseDMY('')).toBe('')
    expect(parseDMY('31/2/2026')).toBeNull()
    expect(parseDMY('32/1/2026')).toBeNull()
    expect(parseDMY('tomorrow')).toBeNull()
  })

  it('does whole-day arithmetic that daylight saving cannot skew', () => {
    expect(daysBetween('2026-03-20', '2026-03-30')).toBe(10)
    expect(daysBetween('2026-11-08', '2026-11-01')).toBe(-7)
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('labels a task\'s dates', () => {
    expect(taskDateLabel({ startDate: '2026-11-03', dueDate: '2026-11-05' })).toBe('03/11/26 → 05/11/26')
    expect(taskDateLabel({ startDate: '2026-11-03', dueDate: '2026-11-03' })).toBe('Due 03/11/26')
    expect(taskDateLabel({ dueDate: '2026-11-05' })).toBe('Due 05/11/26')
    expect(taskDateLabel({ startDate: '2026-11-03' })).toBe('Starts 03/11/26')
    expect(taskDateLabel({})).toBe('')
  })

  it('is overdue only when past due and not finished', () => {
    expect(isOverdue(task('a', { dueDate: '2026-11-07' }), statuses, '2026-11-08')).toBe(true)
    expect(isOverdue(task('a', { dueDate: '2026-11-08' }), statuses, '2026-11-08')).toBe(false)
    expect(isOverdue(task('a', { dueDate: '2026-11-07', statusId: 'done' }), statuses, '2026-11-08')).toBe(false)
    expect(isOverdue(task('a'), statuses, '2026-11-08')).toBe(false)
  })
})

describe('prerequisites', () => {
  const a = task('a', { dueDate: '2026-11-10' })
  const b = task('b', { blockedBy: ['a'] })
  const c = task('c', { blockedBy: ['b'] })
  const all = [a, b, c]

  it('waits on prerequisites that exist and are not finished', () => {
    expect(waitingOn(b, all, statuses).map((t) => t.id)).toEqual(['a'])
    expect(waitingOn(b, [{ ...a, statusId: 'done' }, b], statuses)).toEqual([])
    expect(waitingOn(b, [b], statuses)).toEqual([])
  })

  it('keeps a waiting task in the first status', () => {
    expect(moveBlockedReason(b, 'todo', all, statuses)).toBe('')
    expect(moveBlockedReason(b, 'doing', all, statuses)).toContain('waiting on "Task a"')
    expect(moveBlockedReason(a, 'doing', all, statuses)).toBe('')
    expect(moveBlockedReason(a, 'doing', all, statuses, [{ name: 'Gearbox' }])).toContain('the part "Gearbox"')
  })

  it('stops a task starting before a prerequisite ends', () => {
    expect(scheduleBlockedReason(b, '2026-11-09', '', all, statuses)).toContain("can't start before")
    expect(scheduleBlockedReason(b, '2026-11-10', '', all, statuses)).toBe('')
    expect(scheduleBlockedReason(b, '', '', all, statuses)).toBe('')
    expect(scheduleBlockedReason(a, '2026-01-01', '', all, statuses)).toBe('')
  })

  it('cannot pick a task, or anything downstream of it, as a prerequisite', () => {
    expect(prerequisiteCandidates('a', all).map((t) => t.id)).toEqual([])
    expect(prerequisiteCandidates('b', all).map((t) => t.id)).toEqual(['a'])
    expect(prerequisiteCandidates('c', all).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('waits on parts that are still on the to-buy list', () => {
    const products = [
      { id: 'p1', wantedCount: 4, countInInventory: 1 },
      { id: 'p2', wantedCount: 2, countInInventory: 5 },
    ]
    expect(waitingParts({ partIds: ['p1', 'p2', 'gone'] }, products, []).map((p) => p.id)).toEqual(['p1'])
    expect(waitingParts({}, products, [])).toEqual([])
  })
})

describe('repeating tasks', () => {
  const weekly = { title: 'T', repeat: 'weekly', startDate: '2026-11-02', dueDate: '2026-11-04', checklist: [{ text: 'a', done: true }], blockedBy: ['x'] }

  it('moves the dates on by the interval and resets the checklist', () => {
    expect(nextOccurrence(weekly, '2026-11-01')).toMatchObject({
      title: 'T',
      repeat: 'weekly',
      repeatSpawned: false,
      startDate: '2026-11-09',
      dueDate: '2026-11-11',
      blockedBy: [],
      checklist: [{ text: 'a', done: false }],
    })
  })

  it('pushes on further when finished late', () => {
    expect(nextOccurrence(weekly, '2026-12-01')).toMatchObject({ startDate: '2026-11-30', dueDate: '2026-12-02' })
  })

  it('clamps a monthly task to the end of a short month', () => {
    expect(nextOccurrence({ repeat: 'monthly', dueDate: '2026-01-31' }, '2026-01-01')).toMatchObject({ dueDate: '2026-02-28', startDate: '' })
  })

  it('does not repeat without a rule or a date', () => {
    expect(nextOccurrence({ repeat: '', dueDate: '2026-11-04' })).toBeNull()
    expect(nextOccurrence({ repeat: 'weekly' })).toBeNull()
    expect(nextOccurrence({ repeat: 'bogus', dueDate: '2026-11-04' })).toBeNull()
  })
})

describe('tasks streaks', () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const done = (id, assigneeId, completedAt) => task(id, { assigneeId, statusId: 'done', completedAt })

  it('counts finished tasks while each is within resetDays of the next', () => {
    const tasks = [
      done('1', 's1', '2026-11-07T10:00:00Z'),
      done('2', 's1', '2026-11-03T10:00:00Z'),
      done('3', 's1', '2026-10-20T10:00:00Z'),
      done('4', 's2', '2026-10-19T10:00:00Z'),
      task('5', { assigneeId: 's3' }),
      done('6', '', '2026-11-07T10:00:00Z'),
    ]
    expect(taskStreaksByStudent(tasks, statuses, 7, now)).toEqual({ s1: 2, s2: 0 })
  })
})

describe('task lists', () => {
  it('lists a student\'s unfinished tasks due soon, soonest first', () => {
    const tasks = [
      task('late', { assigneeId: 's', dueDate: '2026-11-01' }),
      task('soon', { assigneeId: 's', dueDate: '2026-11-12' }),
      task('far', { assigneeId: 's', dueDate: '2026-12-25' }),
      task('done', { assigneeId: 's', dueDate: '2026-11-09', statusId: 'done' }),
      task('other', { assigneeId: 'x', dueDate: '2026-11-09' }),
      task('undated', { assigneeId: 's' }),
    ]
    expect(dueSoon(tasks, statuses, 's', '2026-11-08', 7).map((t) => t.id)).toEqual(['late', 'soon'])
  })

  it('hides finished tasks only after the archive period', () => {
    const now = Date.parse('2026-11-30T00:00:00Z')
    const old = task('a', { statusId: 'done', completedAt: '2026-11-01T00:00:00Z' })
    const recent = task('b', { statusId: 'done', completedAt: '2026-11-25T00:00:00Z' })
    expect(isOldDone(old, statuses, now)).toBe(true)
    expect(isOldDone(recent, statuses, now)).toBe(false)
    expect(isOldDone(task('c', { completedAt: '2026-01-01T00:00:00Z' }), statuses, now)).toBe(false)
  })

  it('lists projects A to Z and summarizes them', () => {
    const tasks = [
      task('1', { project: 'Robot', startDate: '2026-11-05', dueDate: '2026-11-09' }),
      task('2', { project: ' Robot ', dueDate: '2026-11-20', statusId: 'done' }),
      task('3', { project: 'Arm' }),
      task('4'),
    ]
    expect(projectNames(tasks)).toEqual(['Arm', 'Robot'])
    const robot = projectSummaries(tasks, statuses).find((p) => p.name === 'Robot')
    expect(robot).toMatchObject({ total: 2, done: 1, start: '2026-11-05', end: '2026-11-20' })
  })

  it('counts, per student and day, the open tasks that run that day', () => {
    const students = [
      { id: 'a', fullName: 'Ann' },
      { id: 'b', fullName: 'Ben' },
    ]
    const tasks = [
      task('1', { assigneeId: 'a', startDate: '2026-11-09', dueDate: '2026-11-10' }),
      task('2', { assigneeId: 'a', dueDate: '2026-11-01' }),
      task('3', { assigneeId: 'a', startDate: '2026-11-09', statusId: 'done' }),
    ]
    const { days, rows } = workloadRows(tasks, statuses, students, '2026-11-08', 14)
    expect(days).toHaveLength(14)
    expect(days[0].iso).toBe('2026-11-08')
    expect(rows.map((r) => r.student.id)).toEqual(['a', 'b'])
    expect(rows[0]).toMatchObject({ open: 2, overdue: 1 })
    expect(rows[0].cells.slice(0, 4)).toEqual([0, 1, 1, 0])
    expect(rows[1]).toMatchObject({ open: 0, overdue: 0 })
  })

  it('works out the stats numbers', () => {
    const now = Date.parse('2026-11-08T12:00:00Z')
    const tasks = [
      task('open-late', { assigneeId: 'a', dueDate: '2026-11-01', division: 'Mech' }),
      task('finished', { assigneeId: 'a', statusId: 'done', startDate: '2026-11-05', completedAt: '2026-11-07T00:00:00Z', division: 'Mech' }),
    ]
    const stats = taskStats(tasks, statuses, now, 8)
    expect(stats).toMatchObject({ open: 1, done: 1, overdue: 1, recent: 1, avgDays: 2 })
    expect(stats.weekly).toHaveLength(8)
    expect(stats.weekly[7].count).toBe(1)
    expect(stats.byDivision.Mech).toEqual({ open: 1, done: 1 })
    expect(stats.byStudent.a).toMatchObject({ open: 1, done: 1, recent: 1, overdue: 1 })
  })
})

describe('checklists, links and copies', () => {
  it('counts ticked checklist items', () => {
    expect(checklistProgress({ checklist: [{ done: true }, { done: false }, { done: true }] })).toEqual({ done: 2, total: 3 })
    expect(checklistProgress({})).toEqual({ done: 0, total: 0 })
  })

  it('keeps only web links, so a link can never be a script', () => {
    expect(isWebLink('https://cad.onshape.com/doc')).toBe(true)
    expect(isWebLink(' http://example.test ')).toBe(true)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
    expect(isWebLink('data:text/html,hi')).toBe(false)
    expect(isWebLink('not a url')).toBe(false)
    expect(isWebLink('')).toBe(false)
    expect(taskLinks({ links: [{ url: 'https://a.test' }, { url: 'javascript:1' }] })).toEqual([{ url: 'https://a.test' }])
  })

  it('duplicates a task back into the first status without its progress', () => {
    const copy = duplicateOf(task('a', { checklist: [{ text: 'x', done: true }], comments: [{ text: 'hi' }], completedAt: 'now', assigneeId: 's' }), 'todo')
    expect(copy).toMatchObject({ title: 'Task a (copy)', statusId: 'todo', assigneeId: 's', checklist: [{ text: 'x', done: false }] })
    expect(copy).not.toHaveProperty('comments')
    expect(copy).not.toHaveProperty('completedAt')
  })
})

describe('describeChange', () => {
  const students = [{ id: 's', fullName: 'Sam' }]
  const before = task('a', { assigneeId: '', startDate: '', dueDate: '', priority: 'normal' })

  it('describes each changed field', () => {
    expect(describeChange(before, { statusId: 'doing' }, { statuses, students })).toBe('Status: To do → Doing')
    expect(describeChange(before, { assigneeId: 's' }, { statuses, students })).toBe('Assignee: nobody → Sam')
    expect(describeChange(before, { dueDate: '2026-11-05' }, { statuses, students })).toBe('Dates: none → Due 05/11/26')
    expect(describeChange(before, { priority: 'high', title: 'New' }, { statuses, students })).toBe('Title: "Task a" → "New"; Priority: normal → high')
  })

  it('says nothing when nothing changed', () => {
    expect(describeChange(before, { title: 'Task a', priority: 'normal' }, { statuses, students })).toBe('')
    expect(describeChange(before, {}, { statuses, students })).toBe('')
  })
})

describe('Needs attention - narrowing to one person', () => {
  const tasks = [
    { id: 't1', assigneeId: 's1', title: 'A' },
    { id: 't2', assigneeId: 's2', title: 'B' },
    { id: 't3', assigneeId: 's1', title: 'C' },
    { id: 't4', title: 'D' },
    { id: 't5', assigneeId: '', title: 'E' },
  ]
  const students = [
    { id: 's2', fullName: 'Zed' },
    { id: 's1', fullName: 'Amy' },
    { id: 's3', fullName: 'Nobody has tasks' },
  ]

  it('keeps everything for everyone', () => {
    expect(filterTasksByAssignee(tasks, 'all')).toBe(tasks)
    expect(filterTasksByAssignee(tasks, undefined)).toBe(tasks)
  })

  it('keeps only one student\'s tasks', () => {
    expect(filterTasksByAssignee(tasks, 's1').map((t) => t.id)).toEqual(['t1', 't3'])
  })

  it('can pick the tasks nobody is assigned to', () => {
    expect(filterTasksByAssignee(tasks, 'none').map((t) => t.id)).toEqual(['t4', 't5'])
  })

  it('offers only students who have tasks, by name, and says whether some are unassigned', () => {
    const { people, hasUnassigned } = assigneeOptions(tasks, students)
    expect(people.map((s) => s.fullName)).toEqual(['Amy', 'Zed'])
    expect(hasUnassigned).toBe(true)
    expect(assigneeOptions([{ id: 'x', assigneeId: 's1' }], students).hasUnassigned).toBe(false)
  })
})
