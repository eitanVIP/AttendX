import { streakTier } from '../lib/calc'

const TIER_ICON = {
  none: null,
  spark: '🔥',
  flame: '🔥',
  blaze: '🔥',
  inferno: '🔥',
  legend: '👑',
}

// A student's training streak (see effectiveStreak in calc.js), styled more
// dramatically the longer it runs - see streakTier for the cutoffs and
// index.css for the actual escalating look. The legend tier (10+, a real
// feat given how rarely trainings come up) gets a couple of extra twinkling
// sparkles alongside the crown - purely decorative spans, positioned by CSS.
export default function StreakBadge({ streak, frozen }) {
  const tier = streakTier(streak)
  return (
    <span className={`streak-badge streak-${tier}`}>
      {tier === 'legend' && (
        <>
          <span className="streak-sparkle streak-sparkle-1" aria-hidden="true">✨</span>
          <span className="streak-sparkle streak-sparkle-2" aria-hidden="true">✨</span>
        </>
      )}
      {TIER_ICON[tier] && <span className="streak-icon">{TIER_ICON[tier]}</span>}
      <span className="streak-count">{streak}</span>
      {frozen && (
        <span className="streak-frozen" title="Frozen - won't reset">
          ❄️
        </span>
      )}
    </span>
  )
}
