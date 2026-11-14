import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CURRENCY_RATES, convertPrice, fetchUsdRate } from './currency'

describe('convertPrice', () => {
  const rates = { USD: 1, NIS: 3.7, EUR: 0.9 }

  it('converts through USD', () => {
    expect(convertPrice(10, 'USD', 'NIS', rates)).toBeCloseTo(37)
    expect(convertPrice(37, 'NIS', 'USD', rates)).toBeCloseTo(10)
    expect(convertPrice(37, 'NIS', 'EUR', rates)).toBeCloseTo(9)
  })

  it('keeps an amount in its own currency unchanged', () => {
    expect(convertPrice(12.5, 'NIS', 'NIS', rates)).toBeCloseTo(12.5)
  })

  it('returns null for zero, missing amounts or unknown currencies', () => {
    expect(convertPrice(0, 'USD', 'NIS', rates)).toBeNull()
    expect(convertPrice(undefined, 'USD', 'NIS', rates)).toBeNull()
    expect(convertPrice(5, 'XXX', 'NIS', rates)).toBeNull()
    expect(convertPrice(5, 'USD', 'XXX', rates)).toBeNull()
    expect(convertPrice(5, 'USD', 'NIS', undefined)).toBeNull()
  })

  it('has USD as the base of the default rates', () => {
    expect(DEFAULT_CURRENCY_RATES.USD).toBe(1)
    expect(DEFAULT_CURRENCY_RATES.NIS).toBeGreaterThan(0)
  })
})

describe('fetchUsdRate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is 1 for USD without asking the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchUsdRate('USD')).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('asks for ILS when the team calls the shekel NIS', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: { ILS: 3.5 } }) })
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchUsdRate('NIS')).toBe(3.5)
    expect(fetchSpy.mock.calls[0][0]).toContain('to=ILS')
  })

  it('throws on a failed lookup or an unknown code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(fetchUsdRate('EUR')).rejects.toThrow('Rate lookup failed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: {} }) }))
    await expect(fetchUsdRate('ZZZ')).rejects.toThrow('Unknown currency code "ZZZ"')
  })
})
