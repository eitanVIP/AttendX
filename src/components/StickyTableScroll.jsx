import { useEffect, useRef, useState } from 'react'

// Drop-in replacement for <div className="table-scroll"><table>...</table>
// </div> that also keeps the table's header row visible while its body
// scrolls past underneath, until the table itself scrolls out of view.
//
// Plain CSS position: sticky can't do this: overflow-x: auto on the
// scroll wrapper (needed so a wide table scrolls horizontally instead of
// the whole page) makes that wrapper - not the page - the containing
// block for any sticky element inside it, and the wrapper itself never
// scrolls vertically (it's exactly as tall as its content), so a sticky
// <thead> would just scroll away with everything else. There's no CSS
// value that avoids this while keeping overflow-x scrollable - it's a
// property of the box, not a per-axis setting.
//
// Instead, while the real header has scrolled above the sticky line but
// the table hasn't scrolled fully past it yet, a floating clone of the
// header stands in for it: a fixed-position copy of the <table> with its
// body stripped out, horizontally offset to track the real header's
// current scroll position. The real header's own <th> content is always
// plain text (checked across every table in the app), so cloning its
// outerHTML can't strand any interactive element's state.
export default function StickyTableScroll({ children, className = '', style }) {
  const scrollRef = useRef(null)
  const cloneWrapRef = useRef(null)
  const [clone, setClone] = useState(null) // { html, left, width } | null
  const rafRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function update() {
      rafRef.current = null
      const table = el.querySelector('table')
      const thead = table?.querySelector('thead')
      if (!table || !thead) {
        setClone(null)
        return
      }
      const stickyTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')) || 0
      const tableRect = table.getBoundingClientRect()
      const theadHeight = thead.getBoundingClientRect().height
      const shouldPin = tableRect.top < stickyTop && tableRect.bottom > stickyTop + theadHeight
      if (!shouldPin) {
        setClone(null)
        return
      }
      const headOnly = table.cloneNode(true)
      headOnly.querySelector('tbody')?.remove()
      // Column widths come from the body's content, which the clone
      // doesn't have - left alone, its columns would shrink to fit the
      // header text (the empty actions column to nothing), sliding out of
      // line with the real rows and leaving gaps they show through. So
      // each cloned header cell is pinned to its real counterpart's
      // current width and the clone laid out as a fixed table of the real
      // table's width.
      const realThs = thead.querySelectorAll('th')
      headOnly.querySelectorAll('th').forEach((th, i) => {
        const width = `${realThs[i].getBoundingClientRect().width}px`
        th.style.width = width
        th.style.minWidth = width
        th.style.maxWidth = width
      })
      headOnly.style.width = `${tableRect.width}px`
      headOnly.style.tableLayout = 'fixed'
      const scrollRect = el.getBoundingClientRect()
      const next = { html: headOnly.outerHTML, left: scrollRect.left, width: scrollRect.width }
      // Scroll fires constantly; only re-render the clone when something
      // about it actually changed.
      setClone((prev) =>
        prev && prev.html === next.html && prev.left === next.left && prev.width === next.width ? prev : next
      )
    }

    function schedule() {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Catches everything a plain scroll/resize listener wouldn't: rows
    // added/removed, and matrix tables' own column-width recalculation
    // (useMatrixLayout), both of which can change the table's height/width
    // without the window itself doing either. The table is observed as
    // well as the wrapper because a wider table just overflows the wrapper
    // without changing the wrapper's own size.
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(el)
    const table = el.querySelector('table')
    if (table) resizeObserver.observe(table)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      resizeObserver.disconnect()
    }
  }, [])

  // Keeps the clone's own horizontal offset in sync whenever it
  // (re)appears, matching whatever the real wrapper was already
  // scrolled to (e.g. re-pinning after scrolling back up).
  useEffect(() => {
    if (cloneWrapRef.current && scrollRef.current) {
      cloneWrapRef.current.scrollLeft = scrollRef.current.scrollLeft
    }
  }, [clone])

  return (
    <>
      <div
        className={`table-scroll ${className}`}
        style={style}
        ref={scrollRef}
        onScroll={(e) => {
          if (cloneWrapRef.current) cloneWrapRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
      >
        {children}
      </div>
      {clone && (
        <div
          ref={cloneWrapRef}
          className="sticky-thead-clone"
          style={{ left: clone.left, width: clone.width }}
          aria-hidden="true"
          // Safe: thead content across this app's tables is always plain
          // text/labels, never inputs - see the comment above.
          dangerouslySetInnerHTML={{ __html: clone.html }}
        />
      )}
    </>
  )
}
