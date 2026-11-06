import { useMemo, useState } from 'react'
import { GUIDE_TEXT } from '../lib/guide'

const textOf = (section, topic) =>
  [section.title, topic.heading, ...(topic.body || []), ...(topic.steps || []), ...(topic.tips || []), topic.keywords || ''].join(' ').toLowerCase()

// A searchable guide: a box that filters topics, chips that jump to a
// section, and each topic as a disclosure (all open while searching).
// `sections` is the guide in the chosen `lang` ('he' reads right to left).
export default function GuideView({ intro, sections, lang, onLang }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const text = GUIDE_TEXT[lang]

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
        <h1>{text.title}</h1>
        <div className="filter-row" style={{ margin: 0 }}>
          <button type="button" className={lang === 'he' ? 'chip active' : 'chip'} onClick={() => onLang('he')}>
            עברית
          </button>
          <button type="button" className={lang === 'en' ? 'chip active' : 'chip'} onClick={() => onLang('en')}>
            English
          </button>
        </div>
      </div>

      <div dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang}>
        <p className="muted">{intro}</p>

        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={text.search}
          aria-label={text.search}
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

        {visible.length === 0 && <p className="muted">{text.none(q)}</p>}

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
                    <ol style={{ margin: '0 0 8px', paddingInlineStart: 20 }}>
                      {t.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  )}
                  {(t.images || []).map((img) => (
                    <figure key={img.src} style={{ margin: '0 0 12px' }}>
                      <img
                        src={`${import.meta.env.BASE_URL}${img.src}`}
                        alt={img.alt}
                        loading="lazy"
                        dir="ltr"
                        style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                      />
                      {img.caption && (
                        <figcaption className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          {img.caption}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                  {t.tips &&
                    t.tips.map((tip, i) => (
                      <p key={i} className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>
                        {text.tip} {tip}
                      </p>
                    ))}
                </div>
              </details>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
