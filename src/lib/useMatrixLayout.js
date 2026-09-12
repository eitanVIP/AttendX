import { useLayoutEffect } from 'react'

// Auto table layout sizes every column to its own content, which leaves
// the per-student columns ragged and gives the frozen right-hand columns no
// way to know how far in to sit. This measures the table once per change
// (and on resize) and sets two CSS variables the matrix styles read:
//
//   --student-col  every student column gets the widest one's width; if
//                  the table would then still be narrower than its
//                  container, the slack is shared out so it fills exactly
//   --actions-col  the actions column's real width (unrounded - the
//                  progress column pins itself against it, and any
//                  rounding would open a hairline seam between the two)
//
// `key` should change whenever the columns might (student names, etc.).
export function useMatrixLayout(tableRef, key) {
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const container = table.parentElement

    function layout() {
      table.style.removeProperty('--student-col')
      table.style.removeProperty('--actions-col')
      const actionsTh = table.querySelector('thead .matrix-actions-col')
      if (actionsTh) table.style.setProperty('--actions-col', `${actionsTh.getBoundingClientRect().width}px`)
      const studentThs = [...table.querySelectorAll('thead .matrix-student-col')]
      if (studentThs.length === 0) return
      const widest = Math.ceil(Math.max(...studentThs.map((th) => th.getBoundingClientRect().width)))
      table.style.setProperty('--student-col', `${widest}px`)
      const slack = container.clientWidth - table.getBoundingClientRect().width
      if (slack > 0) table.style.setProperty('--student-col', `${widest + slack / studentThs.length}px`)
    }

    layout()
    const observer = new ResizeObserver(layout)
    observer.observe(container)
    return () => observer.disconnect()
  }, [tableRef, key])
}
