import { useEffect, useRef, useState } from 'react'
import { statusOf } from '../lib/tasks'

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777']
const PIECES = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 97) % 100,
  delay: ((i * 53) % 40) / 100,
  duration: 1.4 + ((i * 29) % 12) / 10,
  color: COLORS[i % COLORS.length],
  spin: (i % 2 ? 1 : -1) * (360 + ((i * 41) % 360)),
}))

// A short burst of confetti and a "task done" note whenever a task in `tasks`
// goes from unfinished to finished (live, so an assignee sees it when their
// request is approved). Mount it only once the tasks have loaded - the first
// list it sees is taken as the starting point and never celebrated.
export default function CompletionCelebration({ tasks, statuses }) {
  const doneBefore = useRef(null)
  const [shown, setShown] = useState(null)

  useEffect(() => {
    const now = new Map(tasks.map((t) => [t.id, !!statusOf(t, statuses).done]))
    const before = doneBefore.current
    doneBefore.current = now
    if (!before) return
    const finished = tasks.find((t) => now.get(t.id) && before.get(t.id) === false)
    if (!finished) return
    setShown({ key: Date.now(), title: finished.title })
    const timer = setTimeout(() => setShown(null), 2800)
    return () => clearTimeout(timer)
  }, [tasks, statuses])

  if (!shown) return null
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return (
    <div className="celebration" key={shown.key} aria-live="polite">
      {!calm &&
        PIECES.map((p, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, '--spin': `${p.spin}deg` }}
          />
        ))}
      <div className="celebration-note">🎉 Task done: {shown.title}</div>
    </div>
  )
}
