import { Fragment, createContext, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isTranslatedPath, langDir, saveLang, savedLang, setLang as setModuleLang } from '../lib/i18n'

const LangContext = createContext({ lang: 'en', chosen: 'en', setLang: () => {} })
export const useLang = () => useContext(LangContext)

// Holds the language someone chose (remembered on this device), works out
// the language of the page being shown (the chosen one on translated pages,
// English everywhere else), tells the browser its language and reading
// direction, and remounts what is below it when that changes so every piece
// of text is rebuilt in the new language.
export function LangProvider({ children }) {
  const [chosen, setChosen] = useState(savedLang)
  const { pathname } = useLocation()
  const lang = isTranslatedPath(pathname) ? chosen : 'en'
  // Set during render, before the children render, so text built by helper
  // code outside React (messages in lib/) uses the same language. Setting the
  // same value again is harmless.
  setModuleLang(lang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = langDir(lang)
  }, [lang])

  function setLang(next) {
    saveLang(next)
    setChosen(next)
  }

  return (
    <LangContext.Provider value={{ lang, chosen, setLang }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  )
}
