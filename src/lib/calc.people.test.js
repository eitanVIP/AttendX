import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activityLabel,
  attendancePercent,
  attendanceStatusLabel,
  attendanceStreak,
  certHolders,
  certProgress,
  certTargetForTraining,
  countedRecords,
  describeStudentDivisions,
  effectiveStreak,
  eventCountdown,
  formatDate,
  formatLocalDateTime,
  groupByScope,
  isCountableTraining,
  isSessionRelevantToStudent,
  movedTo,
  movedWithinGroup,
  normalizeStudent,
  normalizeStudentForView,
  remapStudentDivisions,
  skippedWeekStarts,
  sortByOrder,
  streakAfterRemoving,
  streakBoard,
  streakContributionsField,
  streakResetHours,
  streakTier,
  studentCommunityHours,
  studentHasCert,
  studentPlanAttendance,
  studentTrainingStats,
  summarizeAttendance,
  swappedRows,
  trainingAppliesToScope,
  trainingAppliesToStudent,
  trainingCompletionByGrade,
  trainingCompletionCascade,
  trainingProgress,
  weekStartISO,
} from './calc'

const student = (extra = {}) => ({ id: 's1', fullName: 'Sam', active: true, divisions: [], subdivisions: {}, ...extra })

// --- dates ------------------------------------------------------------------

describe('date formatting', () => {
  it('shows a stored date as DD/MM/YYYY', () => {
    expect(formatDate('2026-11-03')).toBe('03/11/2026')
    expect(formatDate('')).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('garbage')).toBe('garbage')
  })

  it('shows a UTC timestamp in Israel time, winter and summer', () => {
    expect(formatLocalDateTime('2026-01-15T10:30:00Z')).toBe('15/01/2026 12:30')
    expect(formatLocalDateTime('2026-07-15T10:30:00Z')).toBe('15/07/2026 13:30')
    expect(formatLocalDateTime('')).toBe('—')
    expect(formatLocalDateTime('not a date')).toBe('—')
  })

  it('counts down to an event, and knows today and past', () => {
    const before = eventCountdown('2026-11-10', new Date(2026, 10, 8, 12, 0, 0))
    expect(before).toMatchObject({ past: false, today: false, days: 1, hours: 12, minutes: 0, seconds: 0 })
    expect(eventCountdown('2026-11-10', new Date(2026, 10, 10, 9, 0, 0))).toMatchObject({ today: true, past: false, days: 0 })
    expect(eventCountdown('2026-11-10', new Date(2026, 10, 11, 0, 0, 0))).toMatchObject({ past: true, today: false })
  })

  it('finds the start of a week for either first day', () => {
    // 8 Nov 2026 is a Sunday.
    expect(weekStartISO('2026-11-12', 0)).toBe('2026-11-08')
    expect(weekStartISO('2026-11-08', 0)).toBe('2026-11-08')
    expect(weekStartISO('2026-11-12', 1)).toBe('2026-11-09')
    expect(weekStartISO('2026-11-08', 1)).toBe('2026-11-02')
  })
})

// --- ordering ----------------------------------------------------------------

describe('reordering', () => {
  const list = ['a', 'b', 'c', 'd']

  it('moves an item to a position, clamping out-of-range targets', () => {
    expect(movedTo(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(movedTo(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(movedTo(list, 1, 999)).toEqual(['a', 'c', 'd', 'b'])
    expect(movedTo(list, 2, -5)).toEqual(['c', 'a', 'b', 'd'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('swaps two rows by id without touching the original', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(swappedRows(rows, 1, 3).map((r) => r.id)).toEqual([3, 2, 1])
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('sorts by order, with unordered rows first and a tie-break', () => {
    const items = [
      { id: 'late', order: 20 },
      { id: 'old-b' },
      { id: 'early', order: 10 },
      { id: 'old-a' },
    ]
    const sorted = sortByOrder(items, (x, y) => x.id.localeCompare(y.id))
    expect(sorted.map((i) => i.id)).toEqual(['old-a', 'old-b', 'early', 'late'])
  })

  it('moves a row within its group while every other row keeps its slot', () => {
    const items = [{ id: 'a1' }, { id: 'b1' }, { id: 'a2' }, { id: 'b2' }, { id: 'a3' }]
    const group = items.filter((i) => i.id.startsWith('a'))
    expect(movedWithinGroup(items, group, 'a3', 0).map((i) => i.id)).toEqual(['a3', 'b1', 'a1', 'b2', 'a2'])
    expect(movedWithinGroup(items, group, 'a1', 99).map((i) => i.id)).toEqual(['a2', 'b1', 'a3', 'b2', 'a1'])
  })
})

// --- attendance ---------------------------------------------------------------

describe('attendance summary', () => {
  it('counts present and late as attended, ignoring excused', () => {
    expect(attendancePercent({ present: 3, late: 1, absent: 1, excused: 5 })).toBe(80)
    expect(attendancePercent({ present: 0, late: 0, absent: 0, excused: 4 })).toBeNull()
  })

  it('labels percentages with the team thresholds', () => {
    expect(attendanceStatusLabel(null)).toBe('No data')
    expect(attendanceStatusLabel(100)).toBe('On target')
    expect(attendanceStatusLabel(80)).toBe('On target')
    expect(attendanceStatusLabel(79)).toBe('Needs improvement')
    expect(attendanceStatusLabel(60)).toBe('Needs improvement')
    expect(attendanceStatusLabel(59)).toBe('Low')
  })

  it('summarizes a list of records', () => {
    const records = [{ status: 'present' }, { status: 'late' }, { status: 'absent' }, { status: 'excused' }, { status: 'weird' }]
    expect(summarizeAttendance(records)).toMatchObject({
      present: 1,
      late: 1,
      absent: 1,
      excused: 1,
      relevantSessions: 3,
      percent: 67,
      statusLabel: 'Needs improvement',
    })
    expect(summarizeAttendance([]).statusLabel).toBe('No data')
  })

  it('names why a student is not active', () => {
    expect(activityLabel({ active: true })).toBe('active')
    expect(activityLabel({ active: false, status: 'inactive' })).toBe('inactive')
    expect(activityLabel({ active: false, status: 'active' })).toBe('auto inactive')
  })
})

describe('attendance streak', () => {
  const sessionById = {
    s1: { date: '2026-11-01' },
    s2: { date: '2026-11-02' },
    s3: { date: '2026-11-03' },
    s4: { date: '2026-11-04' },
  }
  const rec = (sessionId, status) => ({ sessionId, status })

  it('counts back from the latest session until the first absence', () => {
    const records = [rec('s1', 'absent'), rec('s2', 'present'), rec('s3', 'late'), rec('s4', 'present')]
    expect(attendanceStreak(records, sessionById)).toBe(3)
  })

  it('skips excused sessions without breaking or building the streak', () => {
    const records = [rec('s1', 'present'), rec('s2', 'excused'), rec('s3', 'present')]
    expect(attendanceStreak(records, sessionById)).toBe(2)
  })

  it('is 0 when the latest session was missed, and ignores records with no session', () => {
    expect(attendanceStreak([rec('s1', 'present'), rec('s4', 'absent')], sessionById)).toBe(0)
    expect(attendanceStreak([rec('missing', 'present')], sessionById)).toBe(0)
  })
})

describe('attendance plans', () => {
  const plans = [
    { name: 'A', perWeek: 3 },
    { name: 'B', perWeek: 1 },
  ]
  // Weeks start on Sunday: 1, 8, 15 Nov 2026 (and 11, 18, 25 Oct, 1 Nov).
  const make = (dates) => {
    const sessionById = {}
    dates.forEach((date, i) => (sessionById[`x${i}`] = { date }))
    return sessionById
  }

  it('is null when the team has no plans', () => {
    expect(studentPlanAttendance(student(), [], {}, { plans: [] })).toBeNull()
    expect(studentPlanAttendance(student(), [], {}, {})).toBeNull()
  })

  it('judges each week against the student\'s own plan', () => {
    const sessionById = make(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11'])
    const records = [
      { sessionId: 'x0', status: 'present' },
      { sessionId: 'x1', status: 'absent' },
      { sessionId: 'x2', status: 'absent' },
      { sessionId: 'x3', status: 'absent' },
    ]
    const result = studentPlanAttendance(student({ plan: 'B' }), records, sessionById, { plans, today: '2026-11-12' })
    expect(result.plan).toBe('B')
    expect(result.perWeek).toBe(1)
    expect(result.weeks.map((w) => [w.week, w.required, w.credited, w.met])).toEqual([
      ['2026-11-01', 1, 1, true],
      ['2026-11-08', 1, 0, false],
    ])
    expect(result.percent).toBe(50)
    expect(result.flag).toBeNull()
  })

  it('uses the first plan for a student with no plan of their own', () => {
    expect(studentPlanAttendance(student(), [], {}, { plans }).plan).toBe('A')
  })

  it('ignores a week where the student was only excused', () => {
    const sessionById = make(['2026-11-02'])
    const result = studentPlanAttendance(student(), [{ sessionId: 'x0', status: 'excused' }], sessionById, { plans })
    expect(result.weeks).toEqual([])
    expect(result.percent).toBeNull()
  })

  it('flags four weeks in a row under the plan, but not once the data is stale', () => {
    const sessionById = make(['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04'])
    const records = Object.keys(sessionById).map((sessionId) => ({ sessionId, status: 'absent' }))
    const fresh = studentPlanAttendance(student({ plan: 'A' }), records, sessionById, { plans, today: '2026-11-08' })
    expect(fresh.flag).toEqual({ type: 'short', message: 'Under their A (3 a week) for 4 weeks in a row - time to talk' })
    const stale = studentPlanAttendance(student({ plan: 'A' }), records, sessionById, { plans, today: '2027-01-10' })
    expect(stale.flag).toBeNull()
  })

  it('suggests the next plan up after four weeks of coming more than the plan', () => {
    const sessionById = make([
      '2026-10-14', '2026-10-15', '2026-10-21', '2026-10-22',
      '2026-10-28', '2026-10-29', '2026-11-04', '2026-11-05',
    ])
    const records = Object.keys(sessionById).map((sessionId) => ({ sessionId, status: 'present' }))
    const result = studentPlanAttendance(student({ plan: 'B' }), records, sessionById, { plans, today: '2026-11-08' })
    expect(result.flag).toEqual({ type: 'extra', message: 'Came more than their B (1 a week) for 4 weeks in a row - consider A' })
  })

  it('leaves out weeks the team switched off', () => {
    const skipped = skippedWeekStarts([{ date: '2026-11-04', label: 'Holiday' }, {}, null])
    expect(skipped).toEqual(['2026-11-01'])
    const sessionById = { a: { date: '2026-11-04' }, b: { date: '2026-11-10' } }
    const records = [{ sessionId: 'a', status: 'absent' }, { sessionId: 'b', status: 'present' }]
    expect(countedRecords(records, sessionById, skipped)).toEqual([records[1]])
    expect(countedRecords(records, sessionById, [])).toBe(records)
  })
})

// --- trainings ----------------------------------------------------------------

describe('trainings', () => {
  const sam = student({ divisions: ['Mechanical'], subdivisions: { Mechanical: ['CAD'] } })

  it('applies by division and subdivision', () => {
    expect(trainingAppliesToStudent({}, sam)).toBe(true)
    expect(trainingAppliesToStudent({ scopeDivision: 'Mechanical' }, sam)).toBe(true)
    expect(trainingAppliesToStudent({ scopeDivision: 'Electrical' }, sam)).toBe(false)
    expect(trainingAppliesToStudent({ scopeDivision: 'Mechanical', scopeSubdivision: 'CAD' }, sam)).toBe(true)
    expect(trainingAppliesToStudent({ scopeDivision: 'Mechanical', scopeSubdivision: 'CNC' }, sam)).toBe(false)
  })

  it('applies to a scope the same way', () => {
    expect(trainingAppliesToScope({}, 'Mechanical', 'CAD')).toBe(true)
    expect(trainingAppliesToScope({ scopeDivision: 'Mechanical' }, 'Electrical')).toBe(false)
    expect(trainingAppliesToScope({ scopeDivision: 'Mechanical', scopeSubdivision: 'CNC' }, 'Mechanical', 'CAD')).toBe(false)
    expect(trainingAppliesToScope({ scopeDivision: 'Mechanical' }, 'Mechanical', 'CAD')).toBe(true)
  })

  it('counts a student\'s own trainings', () => {
    const trainings = [
      { id: 't1', completedStudentIds: ['s1'] },
      { id: 't2', completedStudentIds: [] },
      { id: 't3', scopeDivision: 'Electrical', completedStudentIds: ['s1'] },
    ]
    expect(studentTrainingStats(sam, trainings)).toEqual({ total: 2, completed: 1, percent: 50 })
    expect(studentTrainingStats(sam, [])).toEqual({ total: 0, completed: 0, percent: null })
  })

  it('measures progress against an explicit target, a cert target, or the scope', () => {
    const students = [student({ id: 'a' }), student({ id: 'b' }), student({ id: 'c', active: false })]
    const training = { id: 't', completedStudentIds: ['a', 'ghost'] }
    // Scope: the two active students. The deleted student's leftover id is not counted.
    expect(trainingProgress(training, students, [])).toEqual({ completed: 1, target: 2, percent: 50, missing: 1, onTarget: false })
    expect(trainingProgress({ ...training, targetCount: 1 }, students, [])).toMatchObject({ target: 1, onTarget: true, missing: 0 })
    const cert = { id: 'cert', category: 'professional', requiredTrainingIds: ['t'], targetCount: 5 }
    expect(trainingProgress(training, students, [cert])).toMatchObject({ target: 5, missing: 4 })
  })

  it('takes the biggest headcount any cert needs from a training', () => {
    const students = [student({ id: 'a' }), student({ id: 'b' })]
    const certs = [
      { id: 'c1', category: 'professional', requiredTrainingIds: ['t'], targetCount: 1 },
      { id: 'c2', category: 'professional', requiredTrainingIds: ['t'] },
    ]
    expect(certTargetForTraining({ id: 't' }, certs, students)).toBe(2)
    expect(certTargetForTraining({ id: 'other' }, certs, students)).toBeNull()
  })

  it('counts neither certifications nor sub-trainings as countable', () => {
    expect(isCountableTraining({})).toBe(true)
    expect(isCountableTraining({ category: 'professional' })).toBe(false)
    expect(isCountableTraining({ parentTrainingId: 'p' })).toBe(false)
  })

  it('groups items by division then subdivision in the team\'s order, unscoped last', () => {
    const items = [
      { id: 'none' },
      { id: 'e', scopeDivision: 'Electrical' },
      { id: 'm-cnc', scopeDivision: 'Mechanical', scopeSubdivision: 'CNC' },
      { id: 'm', scopeDivision: 'Mechanical' },
      { id: 'm-cad', scopeDivision: 'Mechanical', scopeSubdivision: 'CAD' },
      { id: 'old', scopeDivision: 'Removed' },
    ]
    const groups = groupByScope(items, ['Mechanical', 'Electrical'], { Mechanical: ['CAD', 'CNC'] })
    expect(groups.map((g) => [g.division, g.subdivision, g.items.map((i) => i.id)])).toEqual([
      ['Mechanical', null, ['m']],
      ['Mechanical', 'CAD', ['m-cad']],
      ['Mechanical', 'CNC', ['m-cnc']],
      ['Electrical', null, ['e']],
      ['Removed', null, ['old']],
      [null, null, ['none']],
    ])
  })

  it('breaks completion down by division and grade', () => {
    const students = [
      student({ id: 'a', grade: 'ט', divisions: ['Mechanical'] }),
      student({ id: 'b', grade: 'ט', divisions: ['Mechanical'] }),
      student({ id: 'c', grade: 'י', divisions: ['Electrical'], active: false }),
    ]
    const trainings = [
      { id: 'g', completedStudentIds: ['a'] },
      { id: 'm', scopeDivision: 'Mechanical', completedStudentIds: ['a', 'b'] },
    ]
    const result = trainingCompletionByGrade(students, trainings, ['Mechanical', 'Electrical'])
    expect(result).toEqual([
      { division: 'General', rows: [{ grade: 'ט', students: 2, completed: 1, total: 2, percent: 50 }] },
      { division: 'Mechanical', rows: [{ grade: 'ט', students: 2, completed: 2, total: 2, percent: 100 }] },
    ])
  })
})

describe('trainingCompletionCascade', () => {
  const sam = { id: 's1' }
  const plain = { id: 't', completedStudentIds: [] }
  const parent = { id: 'p', completedStudentIds: [] }
  const sub1 = { id: 'u1', parentTrainingId: 'p', completedStudentIds: [] }
  const sub2 = { id: 'u2', parentTrainingId: 'p', completedStudentIds: [] }
  const ids = (changes) => changes.map((c) => [c.training.id, c.completed])

  it('changes just itself for a plain training, which earns the streak', () => {
    const { changes, streakTarget } = trainingCompletionCascade([plain, parent, sub1, sub2], plain, sam, true)
    expect(ids(changes)).toEqual([['t', true]])
    expect(streakTarget).toEqual({ training: plain, completed: true })
  })

  it('cascades a parent onto every sub-training, and the parent earns the streak', () => {
    const { changes, streakTarget } = trainingCompletionCascade([parent, sub1, sub2], parent, sam, true)
    expect(ids(changes)).toEqual([['p', true], ['u1', true], ['u2', true]])
    expect(streakTarget.training).toBe(parent)
  })

  it('leaves a sub-training that already matches alone', () => {
    const done = { ...sub1, completedStudentIds: ['s1'] }
    const { changes } = trainingCompletionCascade([parent, done, sub2], parent, sam, true)
    expect(ids(changes)).toEqual([['p', true], ['u2', true]])
  })

  it('finishes the parent when the last sibling is ticked', () => {
    const done = { ...sub2, completedStudentIds: ['s1'] }
    const { changes, streakTarget } = trainingCompletionCascade([parent, sub1, done], sub1, sam, true)
    expect(ids(changes)).toEqual([['u1', true], ['p', true]])
    expect(streakTarget).toEqual({ training: parent, completed: true })
  })

  it('earns no streak while a sibling is still open', () => {
    const { changes, streakTarget } = trainingCompletionCascade([parent, sub1, sub2], sub1, sam, true)
    expect(ids(changes)).toEqual([['u1', true]])
    expect(streakTarget).toBeNull()
  })

  it('un-finishes the parent when one sub-training is reopened', () => {
    const doneParent = { ...parent, completedStudentIds: ['s1'] }
    const done1 = { ...sub1, completedStudentIds: ['s1'] }
    const done2 = { ...sub2, completedStudentIds: ['s1'] }
    const { changes, streakTarget } = trainingCompletionCascade([doneParent, done1, done2], done1, sam, false)
    expect(ids(changes)).toEqual([['u1', false], ['p', false]])
    expect(streakTarget).toEqual({ training: doneParent, completed: false })
  })
})

// --- certifications -----------------------------------------------------------

describe('certifications', () => {
  const trainings = [
    { id: 't1', completedStudentIds: ['a', 'b'] },
    { id: 't2', completedStudentIds: ['a'] },
  ]
  const cert = { id: 'c', requiredTrainingIds: ['t1', 't2', 'deleted'] }
  const students = [student({ id: 'a' }), student({ id: 'b' }), student({ id: 'c', active: false })]

  it('is held once every still-existing required training is done', () => {
    expect(studentHasCert(cert, 'a', trainings)).toBe(true)
    expect(studentHasCert(cert, 'b', trainings)).toBe(false)
    expect(certHolders(cert, students, trainings).map((s) => s.id)).toEqual(['a'])
  })

  it('is never held with nothing required', () => {
    expect(studentHasCert({ requiredTrainingIds: [] }, 'a', trainings)).toBe(false)
    expect(studentHasCert({ requiredTrainingIds: ['deleted'] }, 'a', trainings)).toBe(false)
  })

  it('counts only active students toward the target', () => {
    expect(certProgress(cert, students, trainings)).toEqual({ completed: 1, target: 2, percent: 50, missing: 1, onTarget: false })
    expect(certProgress({ ...cert, targetCount: 1 }, students, trainings)).toMatchObject({ onTarget: true })
  })
})

// --- students -----------------------------------------------------------------

describe('student shape', () => {
  it('reshapes the old single division on read', () => {
    expect(normalizeStudent({ id: 'x', division: 'Mechanical', subdivision: 'CAD' })).toEqual({
      id: 'x',
      divisions: ['Mechanical'],
      subdivisions: { Mechanical: ['CAD'] },
    })
    expect(normalizeStudent({ id: 'x' })).toEqual({ id: 'x', divisions: [], subdivisions: {} })
    const modern = { id: 'x', divisions: ['A'] }
    expect(normalizeStudent(modern)).toEqual({ id: 'x', divisions: ['A'], subdivisions: {} })
  })

  it('follows renames and drops divisions the team no longer has', () => {
    const sam = student({ divisions: ['Old', 'Gone', 'Keep'], subdivisions: { Old: ['x', 'z'], Keep: ['k'] } })
    const structure = { divisions: ['New', 'Keep'], subdivisionsByDivision: { New: ['y'], Keep: ['k'] } }
    const renames = { divisions: { Old: 'New' }, subdivisions: { Old: { x: 'y' } } }
    expect(remapStudentDivisions(sam, structure, renames)).toEqual({
      divisions: ['New', 'Keep'],
      subdivisions: { New: ['y'], Keep: ['k'] },
    })
  })

  it('reports null when nothing needs fixing', () => {
    const sam = student({ divisions: ['Keep'], subdivisions: { Keep: ['k'] } })
    expect(remapStudentDivisions(sam, { divisions: ['Keep'], subdivisionsByDivision: { Keep: ['k'] } })).toBeNull()
  })

  it('marks a student auto-inactive when attendance falls under the minimum', () => {
    const records = [{ sessionId: 'a', status: 'present' }, { sessionId: 'b', status: 'absent' }]
    const structure = { divisions: [], subdivisionsByDivision: {}, minAttendancePercent: 80 }
    const low = normalizeStudentForView({ id: 'x', fullName: 'X', status: 'active' }, structure, records)
    expect(low).toMatchObject({ attendancePercent: 50, autoInactive: true, active: false })
    const noMinimum = normalizeStudentForView({ id: 'x', fullName: 'X' }, { ...structure, minAttendancePercent: 0 }, records)
    expect(noMinimum).toMatchObject({ attendancePercent: null, autoInactive: false, active: true })
    const manual = normalizeStudentForView({ id: 'x', status: 'inactive' }, { ...structure, minAttendancePercent: 0 }, records)
    expect(manual.active).toBe(false)
  })

  it('describes divisions on one line', () => {
    expect(describeStudentDivisions(student({ divisions: ['Mechanical', 'Controls'], subdivisions: { Mechanical: ['Design', 'CAD'] } }))).toBe(
      'Mechanical (Design, CAD) · Controls'
    )
  })

  it('knows which sessions are relevant to a student', () => {
    const sam = student({ divisions: ['Mechanical'] })
    expect(isSessionRelevantToStudent({}, sam)).toBe(true)
    expect(isSessionRelevantToStudent({ targetDivision: 'all' }, sam)).toBe(true)
    expect(isSessionRelevantToStudent({ targetDivision: 'Mechanical' }, sam)).toBe(true)
    expect(isSessionRelevantToStudent({ targetDivision: 'Electrical' }, sam)).toBe(false)
  })

  it('adds up community hours for one student', () => {
    const logs = [{ studentId: 'a', hours: 2 }, { studentId: 'a', hours: '1.5' }, { studentId: 'b', hours: 9 }, { studentId: 'a', hours: 'x' }]
    expect(studentCommunityHours(logs, 'a')).toBe(3.5)
  })
})

// --- streaks ------------------------------------------------------------------

describe('streaks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

  it('keeps a streak until resetDays pass without another', () => {
    expect(effectiveStreak({ trainingStreak: 4, trainingStreakUpdatedAt: daysAgo(3) }, 7)).toBe(4)
    expect(effectiveStreak({ trainingStreak: 4, trainingStreakUpdatedAt: daysAgo(8) }, 7)).toBe(0)
  })

  it('never resets a frozen streak, and treats a missing timestamp as current', () => {
    expect(effectiveStreak({ trainingStreak: 4, trainingStreakFrozen: true, trainingStreakUpdatedAt: daysAgo(99) }, 7)).toBe(4)
    expect(effectiveStreak({ trainingStreak: 4 }, 7)).toBe(4)
    expect(effectiveStreak({}, 7)).toBe(0)
  })

  it('keeps separate counters per kind', () => {
    const s = { trainingStreak: 2, communityStreak: 5, communityStreakUpdatedAt: daysAgo(1) }
    expect(effectiveStreak(s, 7, 'community')).toBe(5)
    expect(effectiveStreak(s, 7, 'training')).toBe(2)
    expect(streakContributionsField('training')).toBe('streakContributions')
    expect(streakContributionsField('community')).toBe('communityStreakContributions')
  })

  it('counts down the hours left before a streak resets', () => {
    const s = { trainingStreak: 1, trainingStreakUpdatedAt: new Date(Date.now() - 24 * 3600000).toISOString() }
    expect(streakResetHours(s, 7)).toBeCloseTo(6 * 24)
    expect(streakResetHours({ ...s, trainingStreakFrozen: true }, 7)).toBeNull()
    expect(streakResetHours({}, 7)).toBeNull()
  })

  it('recomputes the streak from what is left after taking a contribution out', () => {
    const list = [
      { id: '1', type: 'manual', value: 5, at: '2026-11-01T00:00:00Z' },
      { id: '2', type: 'training', at: '2026-11-02T00:00:00Z' },
      { id: '3', type: 'training', at: '2026-11-03T00:00:00Z' },
    ]
    expect(streakAfterRemoving(list, list[1])).toEqual({ streak: 6, contributions: [list[0], list[2]], lastAt: '2026-11-03T00:00:00Z' })
    expect(streakAfterRemoving([list[1]], list[1])).toEqual({ streak: 0, contributions: [], lastAt: null })
  })

  it('ranks the board by streak for each kind', () => {
    const a = { id: 'a', trainingStreak: 1 }
    const b = { id: 'b', trainingStreak: 3 }
    expect(streakBoard([a, b], 'training', 7).map((r) => r.student.id)).toEqual(['b', 'a'])
    expect(streakBoard([a, b], 'tasks', 7, {}, {}, { a: 9 }).map((r) => [r.student.id, r.streak])).toEqual([['a', 9], ['b', 0]])
    const sessionById = { x: { date: '2026-11-01' } }
    const byStudent = { a: [{ sessionId: 'x', status: 'present' }] }
    expect(streakBoard([a, b], 'attendance', 7, byStudent, sessionById)[0].student.id).toBe('a')
  })

  it('picks a tier by streak length', () => {
    expect([0, 1, 2, 4, 5, 6, 7, 9, 10, 50].map(streakTier)).toEqual([
      'none', 'spark', 'flame', 'flame', 'blaze', 'blaze', 'inferno', 'inferno', 'legend', 'legend',
    ])
  })
})
