import he from '../locales/he'

// Two languages: English (the text written in the code, so it needs no
// dictionary) and Hebrew (src/locales/he.js, keyed by the English text).
// Text with no Hebrew entry yet simply shows in English, so pages can be
// translated one at a time. Variables go in {braces}: t('Hi {name}', { name }).
//
// The current language is a plain module variable, set by LangProvider
// (context/LangContext.jsx) before anything renders - which is what lets
// helper code outside React (messages built in lib/) call t() too. Changing
// the language remounts the page below the provider, so nothing keeps old text.
export const LANGS = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'he', label: 'עברית', dir: 'rtl' },
]

const DICTIONARIES = { he }
const STORAGE_KEY = 'attendx.lang'
let current = 'en'

export const isLang = (id) => LANGS.some((l) => l.id === id)
export const getLang = () => current
export function setLang(id) {
  current = isLang(id) ? id : 'en'
  return current
}
export const langDir = (id = current) => LANGS.find((l) => l.id === id)?.dir || 'ltr'

// The language a person chose on this device (English until they choose).
export function savedLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return isLang(saved) ? saved : 'en'
  } catch {
    return 'en'
  }
}
export function saveLang(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // storage unavailable - the choice just won't be remembered
  }
}

export function t(text, vars) {
  const translated = DICTIONARIES[current]?.[text] ?? text
  if (!vars) return translated
  return translated.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}

// For toLocaleDateString / Intl: the browser locale that matches the language.
export const dateLocale = () => (current === 'he' ? 'he-IL' : 'en')

// Hebrew is only offered on the student pages for now; every other page
// (the admin side) always stays English and left to right, whatever language
// was chosen. Add a path here when its page has been translated.
const TRANSLATED_PATHS = ['/student-login', '/log-hours', '/request-order', '/my-systems', '/my-tasks', '/help', '/my-profile', '/streaks']
export const isTranslatedPath = (pathname) => TRANSLATED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
