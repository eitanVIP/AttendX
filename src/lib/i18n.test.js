import { afterEach, describe, expect, it } from 'vitest'
import he from '../locales/he'
import { dateLocale, getLang, isLang, isTranslatedPath, langDir, setLang, t } from './i18n'

afterEach(() => setLang('en'))

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('t', () => {
  it('returns the English text as written', () => {
    expect(t('Log out')).toBe('Log out')
  })

  it('fills in variables', () => {
    expect(t('Hi {name}, you have {n} tasks', { name: 'Noa', n: 3 })).toBe('Hi Noa, you have 3 tasks')
  })

  it('leaves an unknown variable visible instead of printing undefined', () => {
    expect(t('Hi {name}', {})).toBe('Hi {name}')
  })

  it('shows English for text that has no Hebrew yet', () => {
    setLang('he')
    expect(t('Some text nobody translated')).toBe('Some text nobody translated')
  })

  it('translates and fills variables in Hebrew', () => {
    setLang('he')
    const key = Object.keys(he).find((k) => k.includes('{'))
    if (!key) return // no dictionary entry uses a variable yet
    const vars = Object.fromEntries(placeholders(key).map((p) => [p, `<${p}>`]))
    const out = t(key, vars)
    for (const p of placeholders(key)) expect(out).toContain(`<${p}>`)
  })
})

describe('language settings', () => {
  it('knows the languages and their direction', () => {
    expect(isLang('he')).toBe(true)
    expect(isLang('fr')).toBe(false)
    expect(langDir('he')).toBe('rtl')
    expect(langDir('en')).toBe('ltr')
  })

  it('falls back to English for an unknown language', () => {
    expect(setLang('fr')).toBe('en')
    expect(getLang()).toBe('en')
  })

  it('picks the date locale from the language', () => {
    expect(dateLocale()).toBe('en')
    setLang('he')
    expect(dateLocale()).toBe('he-IL')
  })
})

describe('which pages are translated', () => {
  it('covers the student pages only', () => {
    for (const path of ['/student-login', '/log-hours', '/my-tasks', '/my-profile', '/streaks', '/help']) expect(isTranslatedPath(path), path).toBe(true)
    for (const path of ['/', '/login', '/tasks', '/students', '/students/abc', '/settings', '/guide', '/orders/purchases']) expect(isTranslatedPath(path), path).toBe(false)
  })

  it('does not match a path that merely starts with the same letters', () => {
    expect(isTranslatedPath('/helpdesk')).toBe(false)
  })
})

describe('Hebrew dictionary', () => {
  it('has a non-empty translation for every entry', () => {
    for (const [key, value] of Object.entries(he)) expect(value.trim(), key).not.toBe('')
  })

  it('keeps the same {variables} as the English text', () => {
    for (const [key, value] of Object.entries(he)) expect(placeholders(value), key).toEqual(placeholders(key))
  })
})
