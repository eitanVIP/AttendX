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

// Every timestamp this app stores (log entries, streak contributions) is a
// plain UTC ISO string (see logEntry in actions.js) - this is the one place
// that renders one in the team's own local time (Israel) rather than every
// call site slicing the raw UTC string as if it were already local, which
// is off by 2-3 hours depending on daylight saving.
export function formatLocalDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
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

// Training completion per division, broken down by grade - plus a leading
// "General" block of its own for trainings with no scopeDivision at all
// (every active student, not scoped to any particular division). Each
// block only counts trainings actually scoped to THAT block: a division's
// numbers never include General's trainings, and a student who belongs to
// two divisions doesn't have one division's trainings bleed into the
// other's total - unlike trainingAppliesToStudent's "any division the
// student is in" check (right for a student's own profile, wrong for a
// chart trying to isolate one division's completion), each block pre-
// filters `trainings` down to its own scope before handing them to
// studentTrainingStats. Grades with no students in a block are left out;
// students without a grade pool under "—".
export function trainingCompletionByGrade(students, trainings, divisions) {
  const blocks = [
    { label: 'General', inBlock: (s) => s.active, ownTrainings: (t) => !t.scopeDivision },
    ...divisions.map((division) => ({
      label: division,
      inBlock: (s) => s.active && s.divisions.includes(division),
      ownTrainings: (t) => t.scopeDivision === division,
    })),
  ]
  return blocks
    .map(({ label, inBlock, ownTrainings }) => {
      const inScope = students.filter(inBlock)
      const scoped = trainings.filter(ownTrainings)
      const grades = [...GRADES, '—'].filter((g) => inScope.some((s) => (s.grade || '—') === g))
      const rows = grades
        .map((grade) => {
          const members = inScope.filter((s) => (s.grade || '—') === grade)
          let completed = 0
          let total = 0
          for (const s of members) {
            const stats = studentTrainingStats(s, scoped)
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
      return { division: label, rows }
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

// `convertedPrice` is the price already converted to the team's preferred
// currency (what the table actually shows) - `price` stays the product's
// own raw stored value in both formulas, for consistency with the to-buy
// formula's `price`.
export function computeTotalPrice(product, productTypes, convertedPrice, toBuy) {
  const formula = productType(product, productTypes)?.totalPriceFormula
  if (!formula) return { value: convertedPrice !== null && toBuy !== null ? convertedPrice * toBuy : null, error: null }
  return evaluateFormula(formula, formulaScope(product, { tobuy: toBuy ?? NaN, convertedprice: convertedPrice ?? NaN }))
}

// A logged purchase (see logPurchase in actions.js) snapshots the product's
// name/category/price/currency onto its own doc rather than pointing at the
// product live - a purchase is a historical fact ("this is what we paid on
// this date"), so it shouldn't silently change if the product is later
// renamed, recategorized, repriced, or deleted outright.
export const DEFAULT_PURCHASE = { productId: '', productName: '', category: '', quantity: 0, unitPrice: 0, currency: 'NIS', date: '', dismissed: false }

// Every logged purchase's cost, in the team's preferred currency, bucketed
// by the category it was bought under (an empty/missing one groups as '' -
// callers label that "Uncategorized"). Dismissed purchases still count -
// dismissing only hides a row from Orders' Bought table (see
// dismissPurchase in actions.js), it doesn't undo the money already spent.
export function spentByCategory(purchases, rates, preferred) {
  const totals = {}
  for (const p of purchases) {
    const converted = convertPrice(p.unitPrice, p.currency, preferred, rates) ?? 0
    const key = p.category || ''
    totals[key] = (totals[key] || 0) + converted * (p.quantity || 0)
  }
  return totals
}

export function totalSpent(purchases, rates, preferred) {
  return Object.values(spentByCategory(purchases, rates, preferred)).reduce((a, b) => a + b, 0)
}

// Everything still left to buy across the whole catalogue, added up in the
// team's preferred currency - the same per-product to-buy math Orders and
// Inventory already show (computeToBuy/computeTotalPrice), just totalled.
// An individual product's broken formula (total.value === null) is left out
// of the sum rather than poisoning it - Orders/Inventory already surface
// that error on the product's own row.
export function totalToBuyCost(products, productTypes, rates, preferred) {
  return products.reduce((sum, p) => {
    const converted = convertPrice(p.price, p.currency, preferred, rates)
    const toBuy = computeToBuy(p, productTypes)
    const total = computeTotalPrice(p, productTypes, converted, toBuy.value)
    return sum + (total.value || 0)
  }, 0)
}

export function totalBudget(categoryBudgets) {
  return Object.values(categoryBudgets || {}).reduce((sum, b) => sum + (Number(b) || 0), 0)
}

// The dashboard's "budget remaining" pie: every budgeted category gets an
// equal-sized wedge of the circle regardless of how big its own budget is
// (so a small category fully spent looks just as significant as a large
// one), sized down by however much of ITS OWN budget is left - the rest of
// each wedge (the spent-away part) isn't drawn per-category at all, it's
// folded into one shared grey slice that grows toward the whole pie as
// categories get spent through, however many of them there are. A category
// spent past 100% of its budget (allowed - budgets aren't hard limits)
// contributes 0 remaining and its full wedge to grey, never negative.
//
// `percent` is that wedge's actual size in the shared pie (out of 100
// across every category); `remainingPercent` is the same category's own
// remaining fraction out of its OWN budget (out of 100 on its own) - the
// number worth showing next to the wedge, since "22%" of a pie carved into
// N equal wedges reads as a fraction of the whole team's budget, not of
// that one category's, and callers that want the wedge's own two-slice
// remaining/spent split (see PieChart) can build it directly from
// `remainingPercent` without the cross-category weighting.
export function budgetRemainingSlices(categoryBudgets, spending) {
  const entries = Object.entries(categoryBudgets || {}).filter(([, budget]) => budget > 0)
  if (entries.length === 0) return { slices: [], spentPercent: 0 }
  const weight = 100 / entries.length
  let spentPercent = 0
  const slices = entries.map(([category, budget]) => {
    const spent = spending[category] || 0
    const spentFraction = Math.min(1, Math.max(0, spent / budget))
    const percent = weight * (1 - spentFraction)
    spentPercent += weight * spentFraction
    return { category, percent, remainingPercent: (1 - spentFraction) * 100, budget, spent }
  })
  return { slices, spentPercent }
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

// A "system" is what a student is building (e.g. "Shooting mechanism") -
// see MySystems.jsx (student) and Systems.jsx (admin) - and `needs` is the
// list of { productId, quantity } it claims from the shared inventory.
export const DEFAULT_SYSTEM = { studentId: '', name: '', needs: [] }

// Sums each product's claimed quantity across every system except
// `excludeSystemId` (the one currently being created/edited, so its own
// existing claim doesn't count against itself) - the basis for how much of
// a product a system can still claim. Deliberately global across every
// student's systems, not just the current student's own - two students
// both wanting the same gears have to split one shared pool, not two.
export function usedQuantitiesByProduct(systems, excludeSystemId) {
  const used = {}
  for (const system of systems) {
    if (system.id === excludeSystemId) continue
    for (const need of system.needs || []) {
      used[need.productId] = (used[need.productId] || 0) + (Number(need.quantity) || 0)
    }
  }
  return used
}

// Whether a product's category is one an admin has flagged as consumable
// (see the "Consumable" checkbox in Settings' Product categories editor,
// and consumableInventoryDeltas below) - a product that's actually used up
// once claimed by a system (glue, zip ties, sheet stock), rather than
// merely reserved while it's still physically in the bin (a motor, a
// sensor).
export function isConsumableProduct(product, consumableCategories = []) {
  return consumableCategories.includes(product.category)
}

// How much of a product is still free to claim. For a reusable (non-
// consumable) product that's what's in stock minus what every OTHER system
// has already claimed (see usedQuantitiesByProduct above) - a logical
// reservation, since the stock itself isn't touched until something is
// actually built. For a consumable product, claiming it already decrements
// the real stock (see consumableInventoryDeltas) the moment a system is
// saved, so the count itself is already the true remaining amount - adding
// usedQuantities on top would double-subtract everyone else's claims.
// Never floored at 0 for the reusable case - a system is allowed to claim
// more of a product than is actually free (NeedsTable then offers to
// auto-request an order for the shortfall), so "available" has to be able
// to show the resulting deficit rather than hiding it behind a 0.
export function availableForProduct(product, usedQuantities, consumableCategories = []) {
  if (isConsumableProduct(product, consumableCategories)) return product.countInInventory || 0
  const used = usedQuantities[product.id] || 0
  return (product.countInInventory || 0) - used
}

// Every need in a system that claims more of a product than's actually
// available (see availableForProduct above) - the basis for the "request an
// order for the difference?" prompt in Systems.jsx/MySystems.jsx. Computed
// once at submit time (not per-field on blur) so the prompt is tied to the
// Add/Save button itself and can't be skipped by pressing Enter, which
// submits the form before a blur handler on the field you were just typing
// in ever runs.
export function overallocatedNeeds(needs, products, usedQuantities, consumableCategories = []) {
  return needs
    .map((n) => {
      const product = products.find((p) => p.id === n.productId)
      if (!product) return null
      const max = availableForProduct(product, usedQuantities, consumableCategories)
      if (n.quantity <= max) return null
      return { product, quantity: n.quantity, max, shortfall: n.quantity - max }
    })
    .filter(Boolean)
}

// The real-stock adjustment a system's needs imply for consumable-category
// products only (see isConsumableProduct above) - reusable products are
// untouched, since claiming one is a logical reservation, not a physical
// consumption. A positive delta means MORE was just claimed (stock should
// go DOWN by that much); negative means less was claimed, or the system
// was deleted outright (`newNeeds` = []), so that much comes back. Callers
// apply it as `countInInventory: increment(-delta)` alongside the system
// write itself, in the same batch, so stock and the system's own needs can
// never end up out of sync with each other.
export function consumableInventoryDeltas(oldNeeds, newNeeds, products, consumableCategories = []) {
  const oldMap = Object.fromEntries((oldNeeds || []).map((n) => [n.productId, n.quantity]))
  const newMap = Object.fromEntries((newNeeds || []).map((n) => [n.productId, n.quantity]))
  const deltas = []
  for (const productId of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
    const product = products.find((p) => p.id === productId)
    if (!product || !isConsumableProduct(product, consumableCategories)) continue
    const delta = (newMap[productId] || 0) - (oldMap[productId] || 0)
    if (delta !== 0) deltas.push({ productId, delta })
  }
  return deltas
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

// The same active/autoInactive normalization useStudents (firestore-hooks)
// applies to every student in one collection-wide pass, but for just one -
// used by the student-facing My Profile page, which only ever needs its
// own status and already has its own attendance records fetched for the
// history table, so there's no need to pull every student's attendance the
// way the admin hook does. `structure` is { divisions,
// subdivisionsByDivision, minAttendancePercent }.
export function normalizeStudentForView(raw, structure, attendanceRecords) {
  const base = normalizeStudent(raw)
  const student = { ...base, ...(remapStudentDivisions(base, structure) || {}) }
  const minPercent = structure.minAttendancePercent || 0
  const percent = minPercent > 0 ? summarizeAttendance(attendanceRecords).percent : null
  const autoInactive = percent !== null && percent < minPercent
  return { ...student, attendancePercent: percent, autoInactive, active: student.status !== 'inactive' && !autoInactive }
}

// Falls back to a week when a team has no streakResetDays of its own yet
// (older teams, and the student-side settings mirror before it's re-synced -
// see PRODUCT_SETTINGS_FIELDS in actions.js).
export const DEFAULT_STREAK_RESET_DAYS = 7

// How long a team's system-log entries (see logChange in actions.js) stick
// around before purgeOldLogEntries clears them - a team's own
// logRetentionDays setting overrides this.
export const DEFAULT_LOG_RETENTION_DAYS = 30

// Three streak "kinds" share this exact shape on the student doc, each
// under its own field prefix - trainingStreak/trainingStreakFrozen/
// trainingStreakUpdatedAt for 'training', communityStreak/... for
// 'community'. Attendance is deliberately NOT one of these (see
// attendanceStreak below) - it isn't a stored counter at all.
export const STREAK_KINDS = [
  { id: 'training', label: 'Training' },
  { id: 'community', label: 'Community' },
  { id: 'attendance', label: 'Attendance' },
]

// Which field on the student doc holds a kind's contribution list. Kept
// irregular for 'training' (`streakContributions`, no prefix) rather than
// renamed to `trainingStreakContributions` - that field predates community/
// attendance streaks existing at all, and renaming it would orphan every
// student's existing history.
export function streakContributionsField(kind) {
  return kind === 'training' ? 'streakContributions' : `${kind}StreakContributions`
}

// Training/community streak: incremented once per completed training or
// logged community-hours entry (see setTrainingCompletion/CommunityHours'
// own submit handler) and shown as 0 once `resetDays` have passed since the
// last one (an admin-configurable team setting - see Settings.jsx) -
// computed here at render time from the stored count + timestamp rather
// than reset by a scheduled job, since the free Firestore plan has no Cloud
// Functions to run one. An admin-frozen streak (`{kind}StreakFrozen`)
// ignores the gap entirely, and an admin can also just overwrite the stored
// count directly (see updateStudentStreak).
export function effectiveStreak(student, resetDays = DEFAULT_STREAK_RESET_DAYS, kind = 'training') {
  const streak = student[`${kind}Streak`] || 0
  if (streak <= 0) return 0
  if (student[`${kind}StreakFrozen`]) return streak
  const last = student[`${kind}StreakUpdatedAt`]
  if (!last) return streak
  const days = (Date.now() - new Date(last).getTime()) / 86400000
  return days <= resetDays ? streak : 0
}

// Hours left before an active streak resets to 0 - null when there's
// nothing to count down (no streak yet, or a frozen one that never
// resets). Used to show "resets in ..." under the streak badge.
export function streakResetHours(student, resetDays = DEFAULT_STREAK_RESET_DAYS, kind = 'training') {
  if (student[`${kind}StreakFrozen`]) return null
  if (effectiveStreak(student, resetDays, kind) <= 0) return null
  const elapsedHours = (Date.now() - new Date(student[`${kind}StreakUpdatedAt`]).getTime()) / 3600000
  return Math.max(0, resetDays * 24 - elapsedHours)
}

// Each entry in a contributions array (see streakContributionsField above)
// is either:
//   { id, type: 'training', trainingId, trainingName, at }  - one completed
//     training that added 1 to the streak (see setTrainingCompletion in
//     actions.js), or the community equivalent { type: 'log', hours,
//     communityType, at } (see CommunityHours.jsx)
//   { id, type: 'manual', value, by, byEmail, at }  - an admin directly
//     setting the streak to `value` (see updateStudentStreak), which
//     collapses the list down to just this one entry - later real
//     completions build back up from `value`, not from wherever the
//     organic streak had been before the override.
// Kept in parallel with the plain `{kind}Streak` number specifically so a
// later removal (a training deleted, or unchecked for this student) can
// find exactly which entry to take back out - see streakAfterRemoving.
export const DEFAULT_STREAK_CONTRIBUTIONS = []

export function findStreakContribution(contributions, predicate) {
  return (contributions || []).find(predicate) || null
}

// The streak count/contribution list implied once `target` is taken back
// out - recomputed from what's left rather than just decremented by one, so
// it comes out right regardless of whether `target` was the most recent
// contribution or one from the middle of the chain. A manual entry (there's
// at most one, always first) seeds the count; every other entry after it
// adds 1. `lastAt` is the new most-recent entry's timestamp (or null once
// the list is empty), for the caller to keep `{kind}StreakUpdatedAt` - and
// so the reset countdown - honest.
export function streakAfterRemoving(contributions, target) {
  const remaining = (contributions || []).filter((c) => c.id !== target.id)
  const streak = remaining.reduce((n, c) => (c.type === 'manual' ? c.value : n + 1), 0)
  const last = remaining[remaining.length - 1] || null
  return { streak, contributions: remaining, lastAt: last?.at ?? null }
}

// The attendance streak isn't a stored counter at all - unlike training/
// community, there's no discrete "completion" event to persist and later
// revert, just the plain fact of each session's recorded status. So it's
// computed fresh every time, straight off the same attendance records
// summarizeAttendance already uses: walk backward from the most recent
// session THIS student actually has a recorded status for, counting until
// (and not including) the first "absent". Sessions the student was never
// marked for at all are skipped rather than treated as a break - there's
// nothing to break with no recorded status. "excused" is skipped the same
// way - being excused shouldn't build the streak (nothing was actually
// attended) but shouldn't break it either, the way an unrelated absence
// would.
export function attendanceStreak(records, sessionById) {
  const sorted = records
    .map((r) => ({ status: r.status, date: sessionById[r.sessionId]?.date || '' }))
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  let streak = 0
  for (const r of sorted) {
    if (r.status === 'absent') break
    if (r.status === 'excused') continue
    streak += 1
  }
  return streak
}

// One ranked board for any streak kind - training/community read the
// student's own stored counter (see effectiveStreak), attendance is
// computed live from `attendanceRecordsByStudent` (see attendanceStreak
// above, and the `sessionById` map it needs for each record's date).
export function streakBoard(students, kind, resetDays, attendanceRecordsByStudent = {}, sessionById = {}) {
  return students
    .map((s) => ({
      student: s,
      streak:
        kind === 'attendance'
          ? attendanceStreak(attendanceRecordsByStudent[s.id] || [], sessionById)
          : effectiveStreak(s, resetDays, kind),
    }))
    .sort((a, b) => b.streak - a.streak)
}

// Which visual tier a streak falls into (see StreakBadge) - ramps up fast
// since even a handful of completed trainings in a row is a real feat, and
// 10 (about the practical ceiling given how often trainings actually come
// up) gets the showiest treatment there is.
export function streakTier(streak) {
  if (streak >= 10) return 'legend'
  if (streak >= 7) return 'inferno'
  if (streak >= 5) return 'blaze'
  if (streak >= 2) return 'flame'
  if (streak >= 1) return 'spark'
  return 'none'
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
