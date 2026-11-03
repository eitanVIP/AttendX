import { useMemo, useState } from 'react'

const textOf = (section, topic) =>
  [section.title, topic.heading, ...(topic.body || []), ...(topic.steps || []), ...(topic.tips || []), topic.keywords || ''].join(' ').toLowerCase()

// A searchable guide: a box that filters topics, chips that jump to a
// section, and each topic as a disclosure (all open while searching).
export default function GuideView({ title, intro, sections }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const visible = useMemo(
    () =>
      sections
        .map((s) => ({ ...s, topics: s.topics.filter((t) => !query || query.split(/\s+/).every((word) => textOf(s, t).includes(word))) }))
        .filter((s) => s.topics.length > 0),
    [sections, query]
  )

  function jump(id) {
    const el = document.getElementById(`guide-${id}`)
    if (el) el.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <p className="muted">{intro}</p>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the guide (try: approve, optional, spool...)"
        aria-label="Search the guide"
        style={{ width: '100%', maxWidth: 480, marginBottom: 10 }}
      />

      {!query && (
        <div className="filter-row" style={{ marginBottom: 14 }}>
          {sections.map((s) => (
            <button key={s.id} type="button" className="chip" onClick={() => jump(s.id)}>
              {s.title}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && <p className="muted">Nothing matches "{q}". Try a different word.</p>}

      {visible.map((s) => (
        <section key={s.id} id={`guide-${s.id}`} style={{ marginBottom: 22, scrollMarginTop: 'calc(var(--sticky-top, 60px) + 8px)' }}>
          <h2 style={{ marginBottom: 2 }}>{s.title}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{s.intro}</p>
          {s.topics.map((t) => (
            <details key={`${t.heading}-${query ? 'q' : 'n'}`} className="card" open={!!query} style={{ padding: '8px 12px', marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t.heading}</summary>
              <div style={{ marginTop: 8, lineHeight: 1.5 }}>
                {(t.body || []).map((p, i) => (
                  <p key={i} style={{ margin: '0 0 8px' }}>
                    {p}
                  </p>
                ))}
                {t.steps && (
                  <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
                    {t.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                )}
                {t.tips &&
                  t.tips.map((tip, i) => (
                    <p key={i} className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>
                      Tip: {tip}
                    </p>
                  ))}
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}
