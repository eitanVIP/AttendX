import { useEffect } from 'react'
import GuideView from '../components/GuideView'
import { ADMIN_GUIDE, GUIDE_TEXT, useGuideLang } from '../lib/guide'
import { ADMIN_GUIDE_HE } from '../lib/guide.he'

// The admin guide (a top-bar tab), in Hebrew or English.
export default function Guide() {
  const [lang, setLang] = useGuideLang()
  useEffect(() => {
    document.title = `AttendX | ${GUIDE_TEXT[lang].title}`
  }, [lang])
  return <GuideView intro={GUIDE_TEXT[lang].adminIntro} sections={lang === 'he' ? ADMIN_GUIDE_HE : ADMIN_GUIDE} lang={lang} onLang={setLang} />
}
