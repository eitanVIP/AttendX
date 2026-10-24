import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './perfect-table.css'

// PerfectTable - a table with frozen header row and frozen left/right
// columns that keeps working while the *page* scrolls (not just inside a
// fixed-height box), plus expandable sub rows and per-column alignment.
//
// Props (all optional except columns/rows):
//   columns        [{ key, header, cell(row, ctx), subCell(row, ctx),
//                     align: 'left'|'center'|'right', headerAlign,
//                     sticky: 'left'|'right', stickyPriority, width, minWidth,
//                     maxWidth, nowrap, className, cellClassName }]
//   rows           the data; sub rows come from getSubRows (default row.children)
//   getRowId       (row, index, parentId) => id   (default row.id, else its path)
//   expanded / defaultExpanded / onExpandedChange   expansion state (Set of ids)
//   expanderColumn key of the column that hosts the expand arrow (default: first)
//   stickyHeader   keep the header row visible (default true)
//   stickyTop      where the header sticks in page mode (default var(--sticky-top))
//   maxHeight      switches to "box mode": the table scrolls inside this height
//   stickyBudget   max share (0-1) of the visible width frozen columns may take
//                  before the least important ones unfreeze (default 0.5)
//   stickyEdge     'none' | 'line' | 'shadow' divider at the frozen edge
//   autoScroll     clicking/tabbing to a control in a half-hidden cell scrolls
//                  it fully into view; expanding a row reveals its sub rows
//   scrollLookahead when a control within this many cells of the edge (each
//                  way, both axes) is used, the next hidden cell is scrolled
//                  into view too, so ticking along a row keeps going (default 2)
//   dense, hover, indent, rowClassName, onRowClick, emptyMessage, className, style
//   anything else (aria-label, id, ...) goes to the <table>.
//
// How the sticky header works in page mode: overflow-x: auto on the scroll
// wrapper makes IT the containing block for anything sticky inside it, so
// a sticky <thead> could never pin to the page. Instead the header row is
// rendered twice - once in the real table, once in a copy laid over it in
// the same grid cell. The copy is position: sticky against the page (native
// - no scroll listeners, no lag), mirrors the wrapper's horizontal scroll
// so its own frozen cells are real sticky cells too, and its column widths
// are pinned to the real header's measured widths. Box mode needs none of
// that: everything is plain position: sticky inside the box.

// Controls whose click / keyboard focus pulls their cell fully into view.
// <select> is deliberately absent: its popup opens on mousedown and would
// be left hanging in the wrong place if the table slid away underneath.
const REVEAL_TARGETS =
  'button, a[href], input, textarea, label, [role="button"], [role="checkbox"], [role="link"], [tabindex]:not([tabindex="-1"])'
const INTERACTIVE = `${REVEAL_TARGETS}, select`
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
const PAD = 8

const cx = (...parts) => parts.filter(Boolean).join(' ')
const cssLength = (v) => (typeof v === 'number' ? `${v}px` : v)
const alignClass = (align) => (align === 'center' || align === 'right' ? `pt-align-${align}` : null)
const defaultSubRows = (row) => row?.children
const colKey = (col, i) => col.key ?? col.id ?? String(i)

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Turns the nested rows into the flat list that's actually rendered,
// descending only into expanded rows.
function flattenRows(rows, getSubRows, getRowId, expandedSet) {
  const flat = []
  let anyChildren = false
  const walk = (list, depth, parentId) => {
    list.forEach((row, index) => {
      const id = String(getRowId ? getRowId(row, index, parentId) : (row?.id ?? `${parentId ?? 'row'}.${index}`))
      const children = getSubRows(row)
      const hasChildren = Array.isArray(children) && children.length > 0
      if (hasChildren) anyChildren = true
      const expanded = hasChildren && expandedSet.has(id)
      flat.push({ row, id, index, depth, parentId, hasChildren, expanded })
      if (expanded) walk(children, depth + 1, id)
    })
  }
  walk(rows || [], 0, null)
  return { flat, anyChildren }
}

// Decides which frozen columns stay frozen at the current width, and the
// sticky offset of each one.
function planSticky(columns, widths, clientWidth, budget) {
  const lefts = []
  const rights = []
  columns.forEach((col, i) => {
    if (col.sticky === 'left') lefts.push(i)
    else if (col.sticky === 'right') rights.push(i)
  })
  const kept = new Set([...lefts, ...rights])

  // Narrow screens: frozen columns that together take more than `budget`
  // of the visible width leave nothing to scroll, so the least important
  // ones give up their stickiness - the most important one always keeps it.
  if (widths && clientWidth > 0 && kept.size > 1) {
    const priority = (i) => {
      const col = columns[i]
      if (col.stickyPriority != null) return col.stickyPriority
      // Default: the outermost columns matter most, left before right.
      return col.sticky === 'left' ? 1000 - lefts.indexOf(i) : 500 - (rights.length - 1 - rights.indexOf(i))
    }
    const dropOrder = [...kept].sort((a, b) => priority(a) - priority(b))
    const frozenWidth = () => [...kept].reduce((sum, i) => sum + (widths[i] || 0), 0)
    while (kept.size > 1 && frozenWidth() > budget * clientWidth) kept.delete(dropOrder.shift())
  }

  const style = {}
  const cls = {}
  let offset = 0
  let n = 0
  let lastLeft = -1
  for (const i of lefts) {
    if (!kept.has(i)) continue
    // Every frozen column past the first sits 1px further in than its true
    // offset, i.e. 1px under its neighbour: sticky cells land on fractional
    // positions, and without the overlap a hairline of whatever is
    // scrolling underneath shows through the seam between them.
    style[i] = { left: n === 0 ? 0 : Math.floor(offset) - n }
    cls[i] = 'pt-sticky-l'
    offset += widths?.[i] || 0
    n += 1
    lastLeft = i
  }
  offset = 0
  n = 0
  let firstRight = -1
  for (let k = rights.length - 1; k >= 0; k--) {
    const i = rights[k]
    if (!kept.has(i)) continue
    // The outermost right column also goes 1px past the scrollport's edge
    // (the seam there is between the cell and the edge itself).
    style[i] = { right: Math.floor(offset) - 1 - n }
    cls[i] = 'pt-sticky-r'
    offset += widths?.[i] || 0
    n += 1
    firstRight = i
  }
  if (lastLeft >= 0) cls[lastLeft] += ' pt-edge-l'
  if (firstRight >= 0) cls[firstRight] += ' pt-edge-r'
  return { style, cls }
}

export default function PerfectTable({
  columns,
  rows,
  getRowId,
  getSubRows = defaultSubRows,
  expanded,
  defaultExpanded,
  onExpandedChange,
  expanderColumn,
  stickyHeader = true,
  stickyTop,
  maxHeight,
  stickyBudget = 0.5,
  stickyEdge = 'none',
  autoScroll = true,
  scrollLookahead = 2,
  dense = false,
  hover = true,
  indent = 20,
  rowClassName,
  onRowClick,
  emptyMessage = 'Nothing to show.',
  className,
  style,
  ...tableProps
}) {
  const outerRef = useRef(null)
  const scrollerRef = useRef(null)
  const cloneRef = useRef(null)
  const tableRef = useRef(null)
  const headRowRef = useRef(null)

  const box = maxHeight != null
  const hasClone = stickyHeader && !box

  // ----- expansion -----
  const controlled = expanded !== undefined
  const [ownExpanded, setOwnExpanded] = useState(() => new Set(defaultExpanded || []))
  const expandedSet = useMemo(() => (controlled ? new Set(expanded) : ownExpanded), [controlled, expanded, ownExpanded])
  // The row that was just expanded, so its sub rows can be scrolled into
  // view once they exist in the DOM. A fresh object per expansion, so
  // expanding the same row again still counts as a new request.
  const [pendingReveal, setPendingReveal] = useState(null)
  const handledRevealRef = useRef(null)
  const toggle = useCallback(
    (id) => {
      const next = new Set(expandedSet)
      if (next.has(id)) next.delete(id)
      else {
        next.add(id)
        setPendingReveal({ id })
      }
      if (!controlled) setOwnExpanded(next)
      onExpandedChange?.(next)
    },
    [expandedSet, controlled, onExpandedChange]
  )

  const { flat, anyChildren } = useMemo(
    () => flattenRows(rows, getSubRows, getRowId, expandedSet),
    [rows, getSubRows, getRowId, expandedSet]
  )

  // ----- measuring (column widths drive the frozen offsets, the budget
  // and the header clone's column widths) -----
  const [measure, setMeasure] = useState(null)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const table = tableRef.current
    const headRow = headRowRef.current
    if (!scroller || !table || !headRow) return undefined
    const ths = Array.from(headRow.children)
    const run = () => {
      const widths = ths.map((th) => th.getBoundingClientRect().width)
      const next = {
        widths,
        clientWidth: scroller.clientWidth,
        overflow: scroller.scrollWidth > scroller.clientWidth + 1,
      }
      setMeasure((prev) =>
        prev &&
        prev.clientWidth === next.clientWidth &&
        prev.overflow === next.overflow &&
        prev.widths.length === widths.length &&
        prev.widths.every((w, i) => w === widths[i])
          ? prev
          : next
      )
    }
    run()
    // The header cells are observed individually: content changes can move
    // width between columns without the table or wrapper changing size.
    const observer = new ResizeObserver(run)
    observer.observe(scroller)
    observer.observe(table)
    ths.forEach((th) => observer.observe(th))
    return () => observer.disconnect()
  }, [columns, dense, box])

  const plan = useMemo(
    () => planSticky(columns, measure?.widths, measure?.clientWidth ?? 0, stickyBudget),
    [columns, measure, stickyBudget]
  )
  // ----- horizontal scroll: mirror into/out of the clone, and track
  // whether anything is tucked under each frozen edge -----
  const [scrolled, setScrolled] = useState({ l: false, r: false })
  useEffect(() => {
    const scroller = scrollerRef.current
    const clone = cloneRef.current
    if (!scroller) return undefined
    // The clone's scroll event for a value we wrote into it must not be
    // echoed back. Scroll events arrive a frame late, so without this a
    // scrollbar drag turns into a tug of war: the clone's event for the
    // previous frame's position would push the scroller back to it while
    // the user is already further along.
    let wroteToClone = -1
    const sync = () => {
      const x = scroller.scrollLeft
      if (clone && clone.scrollLeft !== x) {
        wroteToClone = x
        clone.scrollLeft = x
      }
      const l = x > 0.5
      const r = x < scroller.scrollWidth - scroller.clientWidth - 0.5
      setScrolled((prev) => (prev.l === l && prev.r === r ? prev : { l, r }))
    }
    const syncBack = () => {
      const x = clone.scrollLeft
      if (x === wroteToClone) {
        wroteToClone = -1
        return
      }
      if (scroller.scrollLeft !== x) scroller.scrollLeft = x
    }
    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    clone?.addEventListener('scroll', syncBack, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(scroller)
    if (tableRef.current) observer.observe(tableRef.current)
    return () => {
      scroller.removeEventListener('scroll', sync)
      clone?.removeEventListener('scroll', syncBack)
      observer.disconnect()
    }
  }, [hasClone])

  // The clone is for pointer and eyes only: keyboard users and assistive
  // tech get the real header, so nothing in the copy may take focus.
  useEffect(() => {
    cloneRef.current?.querySelectorAll(FOCUSABLE).forEach((el) => {
      el.tabIndex = -1
    })
  })

  // ----- auto scroll -----
  const headerHeight = useCallback(
    () => (hasClone ? cloneRef.current : tableRef.current?.tHead)?.offsetHeight || 0,
    [hasClone]
  )
  const stickyTopPx = useCallback(() => {
    const outer = outerRef.current
    return outer ? parseFloat(getComputedStyle(outer).getPropertyValue('--pt-top')) || 0 : 0
  }, [])

  // Scrolls just enough for `rect` (viewport coordinates, something inside
  // the table) to be fully visible: out from under the frozen columns
  // horizontally and below the sticky header vertically - the page scrolls
  // in page mode, the box itself in box mode. When `rect` is bigger than
  // fits, `anchor` (the part that matters) is what must stay in view.
  // `lookahead` lists the rects of the next cells in each direction; if one
  // of them is not fully visible, the first such one is revealed as well
  // (one extra cell, never more). Targets are recomputed from live rects,
  // so calling it twice (click + focus) converges on the same spot.
  const reveal = useCallback(
    (base, { horizontal = true, vertical = true, anchor = base, cellIndex = -1, lookahead = {} } = {}) => {
      const rect = { left: base.left, right: base.right, top: base.top, bottom: base.bottom }
      const extend = (rects, hidden, apply) => {
        for (const r of rects || []) {
          if (hidden(r)) {
            apply(r)
            break
          }
        }
      }
      const scroller = scrollerRef.current
      const headRow = headRowRef.current
      if (!scroller || !headRow || !rect) return
      const sRect = scroller.getBoundingClientRect()
      const vScrollbar = scroller.offsetWidth - scroller.clientWidth
      const hScrollbar = scroller.offsetHeight - scroller.clientHeight
      const headH = stickyHeader ? headerHeight() : 0
      let dx = 0
      let dy = 0
      if (horizontal) {
        // A frozen column can only hide cells on its far side in the row
        // (a left-frozen column hides what comes after it, a right-frozen
        // one what comes before it) - a column that was unfrozen by the
        // budget and sits outside them is never under them. Geometry can't
        // tell those apart (a cell scrolled out past the edge looks the
        // same as one that naturally lives there), so this goes by order.
        let visibleLeft = sRect.left
        let visibleRight = sRect.right - vScrollbar
        headRow.querySelectorAll('.pt-sticky-l').forEach((th) => {
          const f = th.getBoundingClientRect()
          if (th.cellIndex < cellIndex && f.right > visibleLeft) visibleLeft = f.right
        })
        headRow.querySelectorAll('.pt-sticky-r').forEach((th) => {
          const f = th.getBoundingClientRect()
          if (th.cellIndex > cellIndex && f.left < visibleRight) visibleRight = f.left
        })
        visibleLeft += PAD
        visibleRight -= PAD
        extend(lookahead.after, (r) => r.right > visibleRight, (r) => (rect.right = r.right))
        extend(lookahead.before, (r) => r.left < visibleLeft, (r) => (rect.left = r.left))
        if (rect.left < visibleLeft) dx = Math.max(rect.left - visibleLeft, anchor.right - visibleRight)
        else if (rect.right > visibleRight) dx = Math.min(rect.right - visibleRight, anchor.left - visibleLeft)
      }
      if (vertical && box) {
        const top = sRect.top + headH + PAD
        const bottom = sRect.bottom - hScrollbar - PAD
        extend(lookahead.below, (r) => r.bottom > bottom, (r) => (rect.bottom = r.bottom))
        extend(lookahead.above, (r) => r.top < top, (r) => (rect.top = r.top))
        if (rect.top < top) dy = Math.max(rect.top - top, anchor.bottom - bottom)
        else if (rect.bottom > bottom) dy = Math.min(rect.bottom - bottom, anchor.top - top)
      }
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        scroller.scrollTo({ left: scroller.scrollLeft + dx, top: scroller.scrollTop + dy, behavior: 'smooth' })
      }
      if (vertical && !box) {
        const top = stickyTopPx() + headH + PAD
        const bottom = window.innerHeight - PAD
        extend(lookahead.below, (r) => r.bottom > bottom, (r) => (rect.bottom = r.bottom))
        extend(lookahead.above, (r) => r.top < top, (r) => (rect.top = r.top))
        let wy = 0
        if (rect.top < top) wy = Math.max(rect.top - top, anchor.bottom - bottom)
        else if (rect.bottom > bottom) wy = Math.min(rect.bottom - bottom, anchor.top - top)
        if (Math.abs(wy) > 0.5) window.scrollBy({ top: wy, behavior: 'smooth' })
      }
    },
    [box, stickyHeader, headerHeight, stickyTopPx]
  )

  useEffect(() => {
    const outer = outerRef.current
    if (!outer || !autoScroll) return undefined
    const revealCellOf = (target) => {
      const cell = target.closest('td, th')
      if (!cell || target.closest('[data-pt-no-scroll]')) return
      // A frozen cell is always in view sideways (it sits in the very zone
      // other cells are "hidden" under), and a header cell always in view
      // vertically.
      const isFrozen = (el) => el.classList.contains('pt-sticky-l') || el.classList.contains('pt-sticky-r')
      const anchor = cell.getBoundingClientRect()
      // Look-ahead: the next few cells each way (stopping at the frozen
      // columns, which never scroll) and the next few rows, so working along
      // a row or down a column keeps the next target in view.
      const lookahead = { before: [], after: [], above: [], below: [] }
      let prev = cell
      let next = cell
      let up = cell.parentElement
      let down = cell.parentElement
      for (let i = 0; i < scrollLookahead; i++) {
        prev = prev?.previousElementSibling
        next = next?.nextElementSibling
        up = up?.previousElementSibling
        down = down?.nextElementSibling
        if (prev && !isFrozen(prev)) lookahead.before.push(prev.getBoundingClientRect())
        if (next && !isFrozen(next)) lookahead.after.push(next.getBoundingClientRect())
        if (up) lookahead.above.push(up.getBoundingClientRect())
        if (down) lookahead.below.push(down.getBoundingClientRect())
      }
      reveal(anchor, { horizontal: !isFrozen(cell), vertical: cell.tagName !== 'TH', cellIndex: cell.cellIndex, lookahead })
    }
    const onClick = (e) => {
      const target = e.target.closest?.(REVEAL_TARGETS)
      if (target) revealCellOf(target)
    }
    // Only keyboard-driven focus: a mouse press also focuses buttons, and
    // moving the button out from under the pointer before the release
    // would swallow the click.
    const onFocus = (e) => {
      const target = e.target
      if (target.matches?.(REVEAL_TARGETS) && target.matches(':focus-visible')) revealCellOf(target)
    }
    outer.addEventListener('click', onClick)
    outer.addEventListener('focusin', onFocus)
    return () => {
      outer.removeEventListener('click', onClick)
      outer.removeEventListener('focusin', onFocus)
    }
  }, [autoScroll, scrollLookahead, reveal])

  // After a row expands, bring its sub rows into view - as far as possible
  // without pushing the row itself off the top.
  useEffect(() => {
    if (!pendingReveal || handledRevealRef.current === pendingReveal) return
    handledRevealRef.current = pendingReveal
    if (!autoScroll) return
    const parent = tableRef.current?.tBodies?.[0]?.querySelector(`tr[data-pt-id="${CSS.escape(pendingReveal.id)}"]`)
    if (!parent) return
    const depth = Number(parent.dataset.ptDepth)
    let last = parent
    for (let tr = parent.nextElementSibling; tr && Number(tr.dataset.ptDepth) > depth; tr = tr.nextElementSibling) last = tr
    if (last === parent) return
    const p = parent.getBoundingClientRect()
    const l = last.getBoundingClientRect()
    reveal({ left: p.left, right: p.right, top: p.top, bottom: l.bottom }, { horizontal: false })
  }, [pendingReveal, autoScroll, reveal])

  // ----- rendering -----
  const expanderIndex = Math.max(
    0,
    expanderColumn == null ? 0 : columns.findIndex((col, i) => colKey(col, i) === expanderColumn)
  )

  const renderHeadRow = (inClone) => (
    <tr ref={inClone ? undefined : headRowRef}>
      {columns.map((col, i) => {
        const cellStyle = inClone
          ? plan.style[i]
          : {
              ...plan.style[i],
              width: cssLength(col.width),
              minWidth: cssLength(col.minWidth),
              maxWidth: cssLength(col.maxWidth),
            }
        return (
          <th
            key={colKey(col, i)}
            scope="col"
            className={cx(plan.cls[i], alignClass(col.headerAlign ?? col.align), col.nowrap === false && 'pt-wrap', col.className)}
            style={cellStyle}
          >
            {typeof col.header === 'function' ? col.header() : col.header}
          </th>
        )
      })}
    </tr>
  )

  const renderRow = (entry) => {
    const { row, id, index, depth, parentId, hasChildren, expanded: open } = entry
    const ctx = { id, index, depth, parentId, hasChildren, expanded: open, toggle: () => toggle(id) }
    const rowCls = typeof rowClassName === 'function' ? rowClassName(row, ctx) : rowClassName
    return (
      <tr
        key={id}
        data-pt-id={id}
        data-pt-depth={depth}
        className={cx('pt-row', depth > 0 && 'pt-sub', open && 'pt-open', onRowClick && 'pt-clickable', rowCls)}
        style={depth > 0 ? { '--pt-depth': depth } : undefined}
        onClick={
          onRowClick
            ? (e) => {
                if (e.target.closest(INTERACTIVE)) return
                onRowClick(row, ctx, e)
              }
            : undefined
        }
      >
        {columns.map((col, i) => {
          let content = depth > 0 && col.subCell ? col.subCell(row, ctx) : col.cell ? col.cell(row, ctx) : row?.[col.key]
          if (i === expanderIndex && anyChildren) {
            content = (
              <div className="pt-lead">
                {hasChildren ? (
                  <button
                    type="button"
                    className="pt-expander"
                    aria-expanded={open}
                    aria-label={open ? 'Collapse row' : 'Expand row'}
                    onClick={() => toggle(id)}
                  >
                    <ChevronIcon />
                  </button>
                ) : (
                  <span className="pt-expander-space" />
                )}
                <div className="pt-lead-content">{content}</div>
              </div>
            )
          }
          const cellCls = typeof col.cellClassName === 'function' ? col.cellClassName(row, ctx) : col.cellClassName
          return (
            <td
              key={colKey(col, i)}
              className={cx(plan.cls[i], alignClass(col.align), col.nowrap && 'pt-nowrap', col.className, cellCls)}
              style={plan.style[i]}
            >
              {content}
            </td>
          )
        })}
      </tr>
    )
  }

  const cloneWidth = measure ? measure.widths.reduce((sum, w) => sum + w, 0) : undefined

  return (
    <div
      ref={outerRef}
      className={cx(
        'pt',
        box && 'pt-box',
        stickyHeader && 'pt-sticky-head',
        dense && 'pt-dense',
        hover && 'pt-hover',
        stickyEdge !== 'none' && `pt-edge-${stickyEdge}`,
        measure?.overflow && 'pt-overflow',
        scrolled.l && 'pt-scrolled-l',
        scrolled.r && 'pt-scrolled-r',
        className
      )}
      style={{
        '--pt-top': cssLength(stickyTop ?? 'var(--sticky-top, 0px)'),
        '--pt-indent': `${indent}px`,
        ...style,
      }}
    >
      {hasClone && (
        <div ref={cloneRef} className="pt-clone" aria-hidden="true">
          <table
            className="pt-table pt-table-clone"
            style={cloneWidth ? { width: cloneWidth, tableLayout: 'fixed' } : undefined}
          >
            {measure && (
              <colgroup>
                {measure.widths.map((w, i) => (
                  <col key={columns[i] ? colKey(columns[i], i) : i} style={{ width: w }} />
                ))}
              </colgroup>
            )}
            <thead>{renderHeadRow(true)}</thead>
          </table>
        </div>
      )}
      <div ref={scrollerRef} className="pt-scroller" style={box ? { maxHeight: cssLength(maxHeight) } : undefined}>
        <table ref={tableRef} className="pt-table" {...tableProps}>
          <thead>{renderHeadRow(false)}</thead>
          <tbody>
            {flat.map(renderRow)}
            {flat.length === 0 && (
              <tr className="pt-empty">
                <td colSpan={columns.length}>{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
