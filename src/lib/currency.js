// Rates are stored as "units of this currency per 1 USD" - USD is always
// the implicit base (and always 1), so converting between any two known
// currencies is just going through USD in the middle. NIS is the common
// name for the shekel; ISO 4217 (and every rate API) calls it ILS.
const CURRENCY_API_ALIASES = { NIS: 'ILS' }

// NIS's rate is only a starting point (as of September 2026) for teams that
// haven't hit "Refresh rates" in Settings yet - it drifts like any exchange
// rate, and isn't kept in sync with reality on its own.
export const DEFAULT_CURRENCY_RATES = { USD: 1, NIS: 3.7 }

export function convertPrice(amount, fromCode, toCode, rates) {
  const fromRate = rates?.[fromCode]
  const toRate = rates?.[toCode]
  if (!amount || !fromRate || !toRate) return null
  return (amount / fromRate) * toRate
}

// Frankfurter (frankfurter.dev) is a free, keyless, CORS-enabled
// exchange-rate API - good enough for a default an admin can add or
// refresh, not for anything that needs to be accurate to the minute.
// api.frankfurter.app (the old domain/version) now 301-redirects here, and
// the redirect response itself carries no CORS header, which the browser
// treats as a network failure before this URL is ever reached - hence
// calling the new domain directly instead of following that redirect.
export async function fetchUsdRate(code) {
  const apiCode = CURRENCY_API_ALIASES[code] || code
  if (apiCode === 'USD') return 1
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=USD&to=${encodeURIComponent(apiCode)}`)
  if (!res.ok) throw new Error('Rate lookup failed')
  const data = await res.json()
  const rate = data.rates?.[apiCode]
  if (!rate) throw new Error(`Unknown currency code "${code}"`)
  return rate
}
