// A plain conic-gradient pie chart plus its legend - `slices` is
// [{ label, percent, color, displayPercent? }], with `percent` values that
// should sum to <=100 (that's what actually sizes the wedge). Anything left
// over renders as a plain border-coloured gap rather than a slice of its
// own; callers that need every last percent accounted for (see
// budgetRemainingSlices in calc.js) already include their own "the rest"
// slice instead of relying on that gap. `displayPercent`, when given, is
// shown in the legend INSTEAD of `percent` - for a chart like "budget
// remaining" where each wedge is scaled down to fit alongside the others
// (so its own true size means little on its own), letting the label still
// read as that category's own remaining percent out of its own 100.
export default function PieChart({ slices, size = 160 }) {
  const shown = slices.filter((s) => s.percent > 0)
  const { stops, cumulative } = shown.reduce(
    (acc, s) => {
      const end = acc.cumulative + s.percent
      acc.stops.push(`${s.color} ${acc.cumulative}% ${end}%`)
      acc.cumulative = end
      return acc
    },
    { stops: [], cumulative: 0 }
  )
  if (cumulative < 100) stops.push(`var(--border) ${cumulative}% 100%`)
  const background = stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--border)'

  return (
    <div className="pie-chart-row">
      <div className="pie-chart" style={{ width: size, height: size, background }} />
      <ul className="pie-chart-legend">
        {shown.map((s) => (
          <li key={s.label}>
            <span className="pie-chart-swatch" style={{ background: s.color }} />
            {s.label} <span className="muted">{(s.displayPercent ?? s.percent).toFixed(0)}%</span>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No data yet.</li>}
      </ul>
    </div>
  )
}
