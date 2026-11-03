import { useEffect } from 'react'
import GuideView from '../components/GuideView'
import { GUIDE_TEXT, STUDENT_GUIDE, useGuideLang } from '../lib/guide'
import { STUDENT_GUIDE_HE } from '../lib/guide.he'

// The student guide (a StudentLayout tab), in Hebrew or English.
export default function Help() {
  const [lang, setLang] = useGuideLang()
  useEffect(() => {
    document.title = `AttendX | ${GUIDE_TEXT[lang].title}`
  }, [lang])
  return <GuideView intro={GUIDE_TEXT[lang].studentIntro} sections={lang === 'he' ? STUDENT_GUIDE_HE : STUDENT_GUIDE} lang={lang} onLang={setLang} />
}
