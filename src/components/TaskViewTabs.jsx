import { t } from '../lib/i18n'

// The Tasks page views: the three people reach for daily as buttons, the
// rest tucked behind one "More views" menu so the toolbar stays calm.
// `isLead` is false for a student without task-lead rights, who has no Stats
// or Workload.
const MAIN = [
  ['board', 'Board'],
  ['list', 'List'],
  ['calendar', 'Calendar'],
  ['week', 'This week'],
]

export default function TaskViewTabs({ view, onChange, isLead = true }) {
  const more = [
    ['timeline', 'Timeline'],
    ['projects', 'Projects'],
    ...(isLead ? [['workload', 'Workload'], ['stats', 'Stats']] : []),
  ]
  const moreActive = more.some(([id]) => id === view)
  return (
    <div className="task-views">
      {MAIN.map(([id, name]) => (
        <button key={id} type="button" className={view === id ? '' : 'secondary'} onClick={() => onChange(id)}>
          {t(name)}
        </button>
      ))}
      <select
        className={moreActive ? 'task-more-views task-more-active' : 'task-more-views'}
        value={moreActive ? view : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label={t('More views')}
      >
        <option value="" disabled>
          {t('More views…')}
        </option>
        {more.map(([id, name]) => (
          <option key={id} value={id}>
            {t(name)}
          </option>
        ))}
      </select>
    </div>
  )
}
