import { useState } from 'react'
import { addDays, daysBetween, divisionColor, sortTasks, statusOf, waitingOn } from '../lib/tasks'
import { todayISO } from '../lib/calc'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// A task covers startDate..dueDate (either alone is a single day).
function taskRange(task) {
  const start = task.startDate || task.dueDate
  const end = task.dueDate || task.startDate
  return start ? [start, end < start ? start : end] : null
}

// A month grid: every task shows on each day it spans, coloured by division.
// With `onSchedule` (admins and task leads) a task can be dragged onto a day -
// an undated one gets that day, a dated one moves keeping its length - and
// the handle on its last day stretches it over more days. Dropping on the
// "No date" strip clears the dates again.
export default function TaskCalendar({ tasks, allTasks = tasks, statuses, students, divisions, weekStartsOn = 0, onOpen, onSchedule }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [overDay, setOverDay] = useState(null)
  const today = todayISO()
  const lead = (cursor.getDay() - weekStartsOn + 7) % 7
  const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - lead)
  const monthDays = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const weeks = Math.ceil((lead + monthDays) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))
  const sorted = sortTasks(tasks)
  const undated = sorted.filter((t) => !taskRange(t))
  const move = (delta) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))

  // What was picked up: { id, kind: 'move' | 'stretch', grab } where `grab` is
  // the day of the chip it was held by (so a move keeps its offset).
  function startDrag(e, task, kind, grab) {
    e.stopPropagation()
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: task.id, kind, grab }))
    e.dataTransfer.effectAllowed = 'move'
  }

  function dropOnDay(e, day) {
    e.preventDefault()
    setOverDay(null)
    let payload
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain'))
    } catch {
      return
    }
    const task = tasks.find((t) => t.id === payload.id)
    if (!task || !onSchedule) return
    const range = taskRange(task)
    if (!range) return onSchedule(task, day, day)
    if (payload.kind === 'stretch') return onSchedule(task, range[0], day < range[0] ? range[0] : day)
    if (payload.kind === 'stretchStart') return onSchedule(task, day > range[1] ? range[1] : day, range[1])
    const shift = daysBetween(payload.grab, day)
    onSchedule(task, addDays(range[0], shift), addDays(range[1], shift))
  }

  const chip = (t, day) => {
    const range = taskRange(t)
    const done = statusOf(t, statuses).done
    const first = day === range[0]
    const last = day === range[1]
    const waiting = waitingOn(t, allTasks, statuses).length > 0
    const assignee = students.find((s) => s.id === t.assigneeId)
    const color = divisionColor(t.division, divisions)
    return (
      <div
        key={t.id}
        draggable={!!onSchedule}
        onDragStart={onSchedule ? (e) => startDrag(e, t, 'move', day) : undefined}
        title={`${t.title}${assignee ? ` - ${assignee.fullName}` : ''}${t.division ? ` (${t.division})` : ''}`}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          marginBottom: 2,
          borderLeft: `3px solid ${color}`,
          borderRadius: 3,
          background: `color-mix(in srgb, ${color} 22%, transparent)`,
          cursor: onSchedule ? 'grab' : 'default',
        }}
      >
        {onSchedule && first && (
          <span
            draggable
            onDragStart={(e) => startDrag(e, t, 'stretchStart', day)}
            title="Drag to an earlier day to start this task sooner"
            style={{ width: 6, cursor: 'ew-resize', background: color, opacity: 0.6 }}
          />
        )}
        <button
          type="button"
          onClick={onOpen ? () => onOpen(t) : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            fontSize: 11,
            lineHeight: 1.3,
            padding: '1px 4px',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-h)',
            textDecoration: done ? 'line-through' : 'none',
            cursor: 'inherit',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {waiting && '🔒 '}
          {first ? t.title : `↳ ${t.title}`}
        </button>
        {onSchedule && last && (
          <span
            draggable
            onDragStart={(e) => startDrag(e, t, 'stretch', day)}
            title="Drag to another day to stretch or shrink this task"
            style={{ width: 8, cursor: 'ew-resize', background: color, opacity: 0.6, borderRadius: '0 3px 3px 0' }}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button type="button" className="secondary" onClick={() => move(-1)} aria-label="Previous month">
          ‹
        </button>
        <strong style={{ minWidth: 140, textAlign: 'center' }}>
          {cursor.toLocaleString('en', { month: 'long', year: 'numeric' })}
        </strong>
        <button type="button" className="secondary" onClick={() => move(1)} aria-label="Next month">
          ›
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const d = new Date()
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
          }}
        >
          Today
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2, overflowX: 'auto' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="muted" style={{ fontSize: 12, textAlign: 'center', padding: 2 }}>
            {WEEKDAYS[(weekStartsOn + i) % 7]}
          </div>
        ))}
        {days.map((d) => {
          const day = iso(d)
          const inMonth = d.getMonth() === cursor.getMonth()
          const dayTasks = sorted.filter((t) => {
            const r = taskRange(t)
            return r && day >= r[0] && day <= r[1]
          })
          return (
            <div
              key={day}
              onDragOver={onSchedule ? (e) => { e.preventDefault(); setOverDay(day) } : undefined}
              onDragLeave={onSchedule ? () => setOverDay(null) : undefined}
              onDrop={onSchedule ? (e) => dropOnDay(e, day) : undefined}
              style={{
                minHeight: 72,
                padding: 3,
                borderRadius: 6,
                background: overDay === day ? 'var(--accent-soft)' : inMonth ? 'var(--accent-faint)' : 'transparent',
                outline: day === today ? '2px solid var(--accent)' : 'none',
                opacity: inMonth ? 1 : 0.5,
              }}
            >
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                {d.getDate()}
              </div>
              {dayTasks.map((t) => chip(t, day))}
            </div>
          )
        })}
      </div>
      <div
        onDragOver={onSchedule ? (e) => { e.preventDefault(); setOverDay('none') } : undefined}
        onDragLeave={onSchedule ? () => setOverDay(null) : undefined}
        onDrop={
          onSchedule
            ? (e) => {
                e.preventDefault()
                setOverDay(null)
                try {
                  const task = tasks.find((t) => t.id === JSON.parse(e.dataTransfer.getData('text/plain')).id)
                  if (task && taskRange(task)) onSchedule(task, '', '')
                } catch {
                  // not one of ours
                }
              }
            : undefined
        }
        style={{ marginTop: 12, padding: 8, borderRadius: 8, background: overDay === 'none' ? 'var(--accent-soft)' : 'transparent' }}
      >
        <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
          No date ({undated.length}){onSchedule && ' - drag onto a day to schedule, drag a scheduled task here to clear its dates'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {undated.map((t) => (
            <span
              key={t.id}
              draggable={!!onSchedule}
              onDragStart={onSchedule ? (e) => startDrag(e, t, 'move', '') : undefined}
              style={{ cursor: onSchedule ? 'grab' : 'default' }}
            >
              <button
                type="button"
                className="secondary"
                disabled={!onOpen}
                onClick={onOpen ? () => onOpen(t) : undefined}
                style={{ fontSize: 12, padding: '2px 8px', borderLeft: `3px solid ${divisionColor(t.division, divisions)}`, cursor: 'inherit' }}
              >
                {t.title}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
