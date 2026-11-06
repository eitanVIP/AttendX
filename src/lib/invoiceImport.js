// Reads an order confirmation or invoice (a CSV export) into
// { lines: [{ name, sku, quantity, total, text }], paid, currency } so the
// purchase cart can be filled in from it, then matches those lines to products.
// It is a best guess: suppliers lay these out differently, so Orders shows the
// result for review before anything is logged.

const CURRENCY_SYMBOLS = { $: 'USD', '₪': 'NIS', '€': 'EUR', '£': 'GBP' }

// "1,234.56", "1.234,56", "$5.99", "12" -> number (NaN when there isn't one).
function parseNumber(text) {
  const cleaned = String(text ?? '').replace(/[^\d.,-]/g, '')
  if (!/\d/.test(cleaned)) return NaN
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  let normalized = cleaned
  if (lastDot >= 0 && lastComma >= 0) {
    normalized = lastDot > lastComma ? cleaned.replace(/,/g, '') : cleaned.replace(/\./g, '').replace(',', '.')
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '')
  }
  return Number(normalized)
}

// The currency of the first symbol in the text, or '' when there is none.
function detectCurrency(text) {
  const symbol = String(text).match(/[$₪€£]/)
  return symbol ? CURRENCY_SYMBOLS[symbol[0]] : /\bUSD\b/.test(text) ? 'USD' : /\bNIS\b|\bILS\b/.test(text) ? 'NIS' : ''
}

const PAID_LABEL = /grand total|order total|total paid|amount paid|amount due|total for this order|invoice total|^total$|סה["״]?כ לתשלום|סה["״]?כ כולל|^סה["״]?כ$/i

function parseCsv(text) {
  const clean = text.replace(/^﻿/, '')
  const first = clean.split(/\r?\n/, 1)[0]
  const delimiter = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const endRow = () => {
    row.push(cell)
    cell = ''
    if (row.some((c) => c.trim())) rows.push(row)
    row = []
  }
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      endRow()
    } else cell += c
  }
  endRow()
  return rows
}

// Which column is which, from the header row. The order matters: "Item #"
// should be a SKU before "Item" can be a name.
const COLUMN_PATTERNS = [
  ['sku', /sku|part ?(no|num|#)|item ?(no|num|#)|asin|model|catalog|מק["״]?ט/i],
  ['quantity', /qty|quantity|ordered|units|כמות/i],
  ['total', /total|amount|extended|subtotal|סה["״]?כ|סכום/i],
  ['unit', /price|rate|each|cost|מחיר/i],
  ['name', /name|desc|title|product|item|פירוט|תיאור|שם|פריט/i],
]

function parseCsvInvoice(text) {
  const rows = parseCsv(text)
  const currency = detectCurrency(text)
  let columns = null
  let headerAt = -1
  for (let i = 0; i < Math.min(rows.length, 15) && !columns; i++) {
    const found = {}
    for (const [key, pattern] of COLUMN_PATTERNS) {
      const at = rows[i].findIndex((h, j) => pattern.test(h) && !Object.values(found).includes(j))
      if (at >= 0) found[key] = at
    }
    if (found.name !== undefined && found.quantity !== undefined) {
      columns = found
      headerAt = i
    }
  }
  if (!columns) return { lines: [], paid: null, currency, error: 'No columns for item name and quantity were found.' }

  const lines = []
  let paid = null
  for (const row of rows.slice(headerAt + 1)) {
    const name = (row[columns.name] || '').trim()
    const sku = columns.sku !== undefined ? (row[columns.sku] || '').trim() : ''
    const total = columns.total !== undefined ? parseNumber(row[columns.total]) : NaN
    const unit = columns.unit !== undefined ? parseNumber(row[columns.unit]) : NaN
    if (PAID_LABEL.test(name) || PAID_LABEL.test(sku)) {
      paid = [total, unit].find((n) => Number.isFinite(n)) ?? paid
      continue
    }
    const quantity = parseNumber(row[columns.quantity])
    if (!(quantity > 0) || (!name && !sku)) continue
    lines.push({
      name,
      sku,
      quantity,
      total: Number.isFinite(total) ? total : Number.isFinite(unit) ? unit * quantity : null,
      text: row.join(' '),
    })
  }
  return { lines, paid, currency }
}

export async function readInvoiceFile(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    return { lines: [], paid: null, currency: '', error: 'PDF files can\'t be read - export the order as a CSV instead.' }
  }
  if (/\.xlsx?$/i.test(file.name)) {
    return { lines: [], paid: null, currency: '', error: 'Excel files can\'t be read here - save it as a CSV first (File > Save As > CSV).' }
  }
  // Excel's plain "CSV" on a Hebrew Windows is windows-1255, not UTF-8.
  const bytes = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return parseCsvInvoice(utf8.includes('\uFFFD') ? new TextDecoder('windows-1255').decode(bytes) : utf8)
}

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, ' ')
    .trim()
// Single digits count (1/2 vs 1/4 is the whole difference between two screws).
const tokens = (s) => new Set(normalize(s).split(' ').filter((t) => t.length > 1 || /\d/.test(t)))
// The numbers in a name, in order: two names are only the same product when these agree.
const numbers = (s) => normalize(s).split(' ').filter((t) => /\d/.test(t)).join(' ')

// Each invoice line -> the best product, by SKU (exact, or found in the line)
// and then by how many words of the names they share. `product` is null when
// nothing is close enough, so it can be picked by hand.
export function matchInvoiceLines(lines, products) {
  return lines.map((line) => {
    const lineSku = normalize(line.sku)
    const lineText = normalize(`${line.name} ${line.sku} ${line.text}`)
    const lineTokens = tokens(`${line.name} ${line.sku}`)
    let best = null
    let bestScore = 0
    for (const p of products) {
      const sku = normalize(p.sku)
      let score = 0
      // A quote often lists just the number of a SKU (2436 for WCP-2436).
      const bareNumber = /^\d{3,}$/.test(lineSku) && sku.split(' ').includes(lineSku)
      if (bareNumber || (sku.length >= 3 && (sku === lineSku || (` ${lineText} `).includes(` ${sku} `)))) score = 1
      else if (numbers(p.name) === numbers(`${line.name}`)) {
        const productTokens = tokens(p.name)
        const shared = [...productTokens].filter((t) => lineTokens.has(t)).length
        const union = new Set([...productTokens, ...lineTokens]).size
        score = union ? shared / union : 0
      }
      if (score > bestScore) {
        best = p
        bestScore = score
      }
    }
    return { line, product: bestScore >= 0.5 ? best : null, score: bestScore }
  })
}
