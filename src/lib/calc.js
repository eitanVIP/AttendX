// Pure calculation helpers that replace the Google Sheet's formulas.
// Keeping these as plain functions (not stored fields) means percentages
// and statuses are always derived fresh from raw attendance/training data.

import { convertPrice } from './currency'
import { evaluateFormula } from './formula'

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused']

export const GRADES = ['ט', 'י', 'יא', 'יב']

// Local calendar date as YYYY-MM-DD, matching how session/target dates are
// stored (toISOString would roll over at UTC midnight, hours before it
// does in Israel).
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Time left until an event's date (local midnight at its start). Past
// events report `past`; the event's own day is `today` rather than a
// negative countdown.
export function eventCountdown(dateISO, now = new Date()) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + 1)
  const ms = start - now
  const today = now >= start && now < end
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return {
    past: now >= end,
    today,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

// Training completion per division, broken down by grade: within each
// division, each grade's active students' completed applicable trainings
// over their total applicable trainings. Grades with no students in the
// division are left out; students without a grade pool under "—".
export function trainingCompletionByGrade(students, trainings, divisions) {
  return divisions
    .map((division) => {
      const inDivision = students.filter((s) => s.active && s.divisions.includes(division))
      const grades = [...GRADES, '—'].filter((g) => inDivision.some((s) => (s.grade || '—') === g))
      const rows = grades
        .map((grade) => {
          const members = inDivision.filter((s) => (s.grade || '—') === grade)
          let completed = 0
          let total = 0
          for (const s of members) {
            const stats = studentTrainingStats(s, trainings)
            completed += stats.completed
            total += stats.total
          }
          return {
            grade,
            students: members.length,
            completed,
            total,
            percent: total > 0 ? Math.round((completed / total) * 100) : null,
          }
        })
        .filter((row) => row.total > 0)
      return { division, rows }
    })
    .filter((block) => block.rows.length > 0)
}

// Rows are listed in creation order - `order` is stamped with Date.now()
// when a doc is created - and can be moved with the arrows in each table,
// which renumbers the whole collection 0..n (see reorderDocs). Docs from
// before `order` existed sort first, among themselves by `tieBreak`, until
// the first reorder gives them real positions.
export function sortByOrder(items, tieBreak = () => 0) {
  return [...items].sort((a, b) => (a.order ?? -1) - (b.order ?? -1) || tieBreak(a, b))
}

// The full list to hand reorderDocs after swapping two rows' positions.
export function swappedRows(items, idA, idB) {
  const rows = [...items]
  const i = rows.findIndex((x) => x.id === idA)
  const j = rows.findIndex((x) => x.id === idB)
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  return rows
}

// Moves the item at `index` to `toIndex` within a plain array, clamping
// `toIndex` to the array's own bounds - so a stray out-of-range value (an
// admin typing 0 or 999 into the "move to position" dialog) always lands
// on the closest real position (first or last) instead of doing nothing or
// producing an invalid array. Used by Settings' locally-held lists
// (divisions, their subdivisions, community types), which have no
// Firestore `order` field - just this array's position.
export function movedTo(list, index, toIndex) {
  const clamped = Math.max(0, Math.min(toIndex, list.length - 1))
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(clamped, 0, item)
  return next
}

// The full list to hand reorderDocs after moving one row to a new position
// within its group (e.g. one division's table) - every row outside the
// group keeps its exact slot; the group's own rows trade places among the
// slots they already occupied. `toIndex` is clamped to the group's own
// bounds (see movedTo above), which is what keeps a corrupt or
// out-of-range target - including one computed from a stray negative
// `order` on some doc - from ever landing outside the group.
export function movedWithinGroup(items, groupItems, id, toIndex) {
  const ids = new Set(groupItems.map((x) => x.id))
  const slots = []
  items.forEach((item, i) => {
    if (ids.has(item.id)) slots.push(i)
  })
  const group = movedTo(
    groupItems,
    groupItems.findIndex((x) => x.id === id),
    toIndex
  )
  const rows = [...items]
  slots.forEach((slot, k) => {
    rows[slot] = group[k]
  })
  return rows
}

// A student is active unless marked inactive by hand OR their attendance
// has fallen under the team's minimum (see useStudents, which derives
// `active`/`autoInactive` for every student). The label distinguishes the
// two so an admin can tell why someone dropped out.
export function activityLabel(student) {
  if (student.active) return 'active'
  return student.status === 'inactive' ? 'inactive' : 'auto inactive'
}

export function attendancePercent(counts) {
  const relevant = counts.present + counts.late + counts.absent
  if (relevant === 0) return null
  return Math.round(((counts.present + counts.late) / relevant) * 100)
}

export function attendanceStatusLabel(percent) {
  if (percent === null) return 'No data'
  if (percent >= 80) return 'On target'
  if (percent >= 60) return 'Needs improvement'
  return 'Low'
}

export function summarizeAttendance(records) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const r of records) {
    if (counts[r.status] !== undefined) counts[r.status] += 1
  }
  const percent = attendancePercent(counts)
  return {
    ...counts,
    relevantSessions: counts.present + counts.late + counts.absent,
    percent,
    statusLabel: attendanceStatusLabel(percent),
  }
}

export function trainingScopeStudents(training, students) {
  return students.filter((s) => s.active && trainingAppliesToStudent(training, s))
}

export function trainingProgress(training, students) {
  const completed = training.completedStudentIds?.length ?? 0
  const target =
    training.targetCount ?? trainingScopeStudents(training, students).length
  const percent = target > 0 ? Math.round((completed / target) * 100) : null
  return {
    completed,
    target,
    percent,
    missing: Math.max(target - completed, 0),
    onTarget: completed >= target && target > 0,
  }
}

// Students used to hold a single `division`/`subdivision` pair; they now
// hold `divisions: string[]` plus `subdivisions: { [division]: string[] }`.
// Docs written before that change are reshaped here on read (see
// useStudents), so nothing downstream ever sees the old fields, and they're
// cleared off the doc the next time it's edited (see updateStudent).
// A stable reference for "this team has no product types (yet)" - callers
// that feed team?.productTypes into a useMemo/useEffect dependency need one
// fixed array rather than a fresh `[]` literal every render, or the hook
// would never actually skip recomputing.
export const NO_PRODUCT_TYPES = []

// Inventory and Orders are two views of the same teams/{teamId}/products
// collection - adding a product from either page just leaves the other
// count at 0 rather than creating a second, unlinked doc, so there's no way
// for the two pages to disagree about what "this product" refers to.
export const DEFAULT_PRODUCT = {
  name: '',
  sku: '',
  countInInventory: 0,
  wantedCount: 0,
  category: '',
  price: 0,
  currency: 'NIS',
  supplier: '',
  link: '',
  notes: '',
  customData: {},
  // Whether this product currently belongs in Orders' Bought table - set
  // the moment an edit brings its to-buy down to exactly 0 (see
  // boughtFlagChanges below), not just because it happens to be at 0 right
  // now, and cleared either by an edit that makes it needed again or by an
  // admin dismissing it from that table.
  boughtFlag: false,
}

export function normalizeProduct(raw) {
  return { ...DEFAULT_PRODUCT, ...raw }
}

// How many more need to be bought to cover what's wanted - never negative
// (having more in stock than wanted isn't a shortfall). Stock/wanted can be
// fractional (e.g. metres of sheet stock), but you can only ever order whole
// units, so this always rounds up to the nearest one.
export function toBuyCount(product) {
  return Math.ceil(Math.max((product.wantedCount || 0) - (product.countInInventory || 0), 0))
}

// What a formula (see formula.js) can reference by name - lowercase
// built-ins plus `custom.<field>` for the product's own custom fields. The
// type name itself is stripped out of `custom` so a formula can't see it
// as if it were one of its own fields.
function formulaScope(product, extra) {
  const { type: _type, ...custom } = product.customData || {}
  return {
    sku: product.sku,
    price: product.price,
    stock: product.countInInventory,
    wanted: product.wantedCount,
    custom,
    ...extra,
  }
}

// Looks up the CURRENT type definition by name every time, rather than
// copying its formula onto the product when the product was created -
// editing a type's formula in Settings is meant to change how every
// product of that type computes immediately, not just new ones. A product
// whose type was since renamed or deleted just finds no match and falls
// back to the plain math below, same as a product with no type at all.
function productType(product, productTypes) {
  const name = product.customData?.type
  return name ? productTypes?.find((t) => t.name === name) : undefined
}

// A product's type can replace the plain "wanted minus in stock" math with
// its own formula. Falls back to the default the moment there's no
// formula, and a broken formula reports an error rather than breaking the
// table. Whichever source it comes from, to-buy is always a whole number
// you can actually order - rounded up, same as the default math.
export function computeToBuy(product, productTypes) {
  const formula = productType(product, productTypes)?.toBuyFormula
  if (!formula) return { value: toBuyCount(product), error: null }
  const result = evaluateFormula(formula, formulaScope(product))
  return result.value === null ? result : { ...result, value: Math.ceil(result.value) }
}

// The `boughtFlag` fields to merge into an update's payload, computed by
// comparing to-buy before and after the edit being made (an error counts as
// "needed", same as the needsBuying/bought split in Orders.jsx). Bought
// only wants products at the moment they're actually finished - not every
// product that merely happens to need nothing - so this only touches the
// flag on an actual crossing: {} means to-buy stayed on the same side of
// zero across the edit, so whatever dismissal state already exists is left
// alone.
export function boughtFlagChanges(before, after, productTypes) {
  const wasNeeded = computeToBuy(before, productTypes).value !== 0
  const isNeeded = computeToBuy(after, productTypes).value !== 0
  if (wasNeeded && !isNeeded) return { boughtFlag: true }
  if (!wasNeeded && isNeeded) return { boughtFlag: false }
  return {}
}

// `convertedPrice` is the price already converted to the team's preferred
// currency (what the table actually shows) - `price` stays the product's
// own raw stored value in both formulas, for consistency with the to-buy
// formula's `price`.
export function computeTotalPrice(product, productTypes, convertedPrice, toBuy) {
  const formula = productType(product, productTypes)?.totalPriceFormula
  if (!formula) return { value: convertedPrice !== null && toBuy !== null ? convertedPrice * toBuy : null, error: null }
  return evaluateFormula(formula, formulaScope(product, { tobuy: toBuy ?? NaN, convertedprice: convertedPrice ?? NaN }))
}

// Trim/case/space-insensitive, so "NEO Motor" and "neo   motor" are caught
// as the same product name.
export function normalizeProductName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, '')
}

export function findDuplicateProduct(products, name, excludeId) {
  const target = normalizeProductName(name)
  if (!target) return null
  return products.find((p) => p.id !== excludeId && normalizeProductName(p.name) === target) || null
}

// A product only carries a customData.type when it was created as one of
// Settings' custom product types (e.g. "Aluminum sheet") - a plain product
// never gets a type key written at all, so this alone tells the two apart.
export function hasCustomData(product) {
  return !!product.customData?.type
}

// Free-text search across every field a search box could plausibly mean by
// "this product" - not just the name. customData is deliberately left out:
// its fields vary per product type, so there's no fixed set to search.
const PRODUCT_SEARCH_FIELDS = ['name', 'sku', 'category', 'supplier', 'currency', 'notes', 'link']

// `rates`/`preferred` (the team's currency settings) are optional so this
// still works with no conversion info at all - but when given, the price
// searched is the one actually shown in the table (converted, 2 decimals),
// not the raw stored value, so "166" finds a product priced at $45 once
// that's showing as 166.50 NIS - not before.
export function productMatchesSearch(product, query, { rates, preferred } = {}) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const converted = rates && preferred ? convertPrice(product.price, product.currency, preferred, rates) : null
  const price = converted !== null ? converted.toFixed(2) : product.price
  const numeric = [price, product.countInInventory, product.wantedCount]
  const text = PRODUCT_SEARCH_FIELDS.map((f) => product[f])
  return [...text, ...numeric].some((v) => v != null && String(v).toLowerCase().includes(q))
}

export function normalizeStudent(raw) {
  if (Array.isArray(raw.divisions)) {
    return { ...raw, subdivisions: raw.subdivisions || {} }
  }
  const { division, subdivision, ...rest } = raw
  return {
    ...rest,
    divisions: division ? [division] : [],
    subdivisions: division && subdivision ? { [division]: [subdivision] } : {},
  }
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// Reconciles a student's memberships against the team's division structure:
// renamed divisions/subdivisions follow the rename (`renames` maps old name
// to new, subdivision renames keyed by the division's *old* name), and
// anything the team no longer has is dropped. Returns the corrected fields,
// or null when the student already matches.
export function remapStudentDivisions(student, structure, renames = { divisions: {}, subdivisions: {} }) {
  const teamDivisions = structure.divisions || []
  const teamSubs = structure.subdivisionsByDivision || {}
  const divisions = []
  const subdivisions = {}
  for (const d of student.divisions) {
    const nd = renames.divisions[d] ?? d
    if (!teamDivisions.includes(nd) || divisions.includes(nd)) continue
    divisions.push(nd)
    const validSubs = teamSubs[nd] || []
    const subs = []
    for (const s of student.subdivisions[d] || []) {
      const ns = renames.subdivisions[d]?.[s] ?? s
      if (validSubs.includes(ns) && !subs.includes(ns)) subs.push(ns)
    }
    if (subs.length) subdivisions[nd] = subs
  }
  const unchanged =
    sameList(divisions, student.divisions) &&
    Object.keys(student.subdivisions).length === Object.keys(subdivisions).length &&
    Object.entries(subdivisions).every(([d, subs]) => sameList(subs, student.subdivisions[d] || []))
  return unchanged ? null : { divisions, subdivisions }
}

export function trainingAppliesToStudent(training, student) {
  if (training.scopeDivision && !student.divisions.includes(training.scopeDivision)) return false
  if (
    training.scopeSubdivision &&
    !(student.subdivisions[training.scopeDivision] || []).includes(training.scopeSubdivision)
  ) {
    return false
  }
  return true
}

// The same shape of check as trainingAppliesToStudent, but against a scope
// (a division/subdivision pair, e.g. a certification's own scope) rather
// than a real student - used to decide which trainings a cert scoped to
// that division/subdivision could actually require, since a cert can only
// require trainings every student who'd hold it would actually see.
export function trainingAppliesToScope(training, scopeDivision, scopeSubdivision) {
  if (!training.scopeDivision) return true
  if (training.scopeDivision !== scopeDivision) return false
  if (training.scopeSubdivision && training.scopeSubdivision !== scopeSubdivision) return false
  return true
}

// Joins division + subdivision into one group key; NUL can't appear in a
// name typed into Settings, unlike spaces or slashes.
const SCOPE_SEP = ' '

// Groups items that carry scopeDivision/scopeSubdivision fields (trainings
// and certifications alike - see Trainings.jsx and Certifications.jsx) into
// one bucket per division, or per subdivision within it, ordered by the
// team's own division/subdivision order - a scope that no longer matches a
// real division/subdivision (renamed or removed in Settings) still shows,
// after the known ones, rather than silently disappearing. Division-less
// items sort last. Each item's position within its own bucket is whatever
// order it already had in `items` - callers that want a particular order
// (e.g. by the `order` field) should sort before calling this.
export function groupByScope(items, divisions, subdivisionsByDivision) {
  const byScope = new Map()
  for (const item of items) {
    const key = `${item.scopeDivision || ''}${SCOPE_SEP}${item.scopeSubdivision || ''}`
    if (!byScope.has(key)) byScope.set(key, [])
    byScope.get(key).push(item)
  }
  const divisionRank = (d) => {
    if (!d) return Number.MAX_SAFE_INTEGER
    const i = divisions.indexOf(d)
    return i === -1 ? divisions.length : i
  }
  const subdivisionRank = (d, s) => {
    if (!s) return -1
    const subs = subdivisionsByDivision[d] || []
    const i = subs.indexOf(s)
    return i === -1 ? subs.length : i
  }
  return [...byScope.keys()]
    .map((key) => {
      const [d, s] = key.split(SCOPE_SEP)
      return { key, d, s }
    })
    .sort(
      (a, b) =>
        divisionRank(a.d) - divisionRank(b.d) ||
        a.d.localeCompare(b.d) ||
        subdivisionRank(a.d, a.s) - subdivisionRank(b.d, b.s) ||
        a.s.localeCompare(b.s)
    )
    .map(({ key, d, s }) => ({
      key,
      division: d || null,
      subdivision: s || null,
      items: byScope.get(key),
    }))
}

export function studentTrainingStats(student, trainings) {
  const applicable = trainings.filter((t) => trainingAppliesToStudent(t, student))
  const completed = applicable.filter((t) => t.completedStudentIds?.includes(student.id))
  const total = applicable.length
  const percent = total > 0 ? Math.round((completed.length / total) * 100) : null
  return { total, completed: completed.length, percent }
}

export function isSessionRelevantToStudent(session, student) {
  if (!session.targetDivision || session.targetDivision === 'all') return true
  return student.divisions.includes(session.targetDivision)
}

// "Mechanical (Design, CAD) · Controls" - the one-line summary of where a
// student sits, used wherever there's room for a single cell of text.
export function describeStudentDivisions(student) {
  return student.divisions
    .map((d) => {
      const subs = student.subdivisions[d] || []
      return subs.length ? `${d} (${subs.join(', ')})` : d
    })
    .join(' · ')
}

export function studentCommunityHours(logs, studentId) {
  return logs
    .filter((l) => l.studentId === studentId)
    .reduce((sum, l) => sum + (Number(l.hours) || 0), 0)
}

// Certifications are earned automatically: an admin picks which trainings
// are required, and a student holds the cert once they've completed every
// one of them - no manual "certify this student" step.
export function studentHasCert(cert, studentId, trainings) {
  const required = cert.requiredTrainingIds || []
  if (required.length === 0) return false
  return required.every((tid) => trainings.find((t) => t.id === tid)?.completedStudentIds?.includes(studentId))
}

// Everyone who holds the cert, inactive students included - that's for
// display; certProgress below counts only active holders toward the target.
export function certHolders(cert, students, trainings) {
  return students.filter((s) => studentHasCert(cert, s.id, trainings))
}

export function certProgress(cert, students, trainings) {
  const activeStudents = students.filter((s) => s.active)
  const completed = certHolders(cert, activeStudents, trainings).length
  const target = cert.targetCount ?? activeStudents.length
  const percent = target > 0 ? Math.round((completed / target) * 100) : null
  return {
    completed,
    target,
    percent,
    missing: Math.max(target - completed, 0),
    onTarget: completed >= target && target > 0,
  }
}
