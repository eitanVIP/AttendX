import { useLang } from '../context/LangContext'
import { LANGS } from '../lib/i18n'

// A small English / עברית switch. The button names the OTHER language, in
// that language, so someone who can't read the current one can still find it.
export default function LangToggle({ className = 'lang-toggle' }) {
  const { lang, setLang } = useLang()
  const other = LANGS.find((l) => l.id !== lang)
  return (
    <button type="button" className={className} onClick={() => setLang(other.id)} lang={other.id} aria-label={other.label}>
      {other.label}
    </button>
  )
}
