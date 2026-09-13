import { DEFAULT_PRODUCT } from './calc'

// Quotes a value only when it needs it (contains a comma, quote, or
// newline) - keeps plain numbers and short text readable in the raw file.
function csvCell(value) {
  const str = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

// Triggers a browser download of `rows` (with `headers` as the first line)
// as a CSV file - no server involved, it's all client-side Blob + a
// throwaway link click. The leading BOM is what makes Excel render Hebrew
// text correctly instead of guessing the wrong encoding.
const UTF8_BOM = String.fromCharCode(0xfeff)

export function downloadCSV(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// The inverse of downloadCSV's quoting (comma-separated, "..." fields that
// may contain commas/quotes/newlines, "" as an escaped quote) - a small
// state machine rather than a split(',') because a quoted field can itself
// contain commas and newlines that must NOT break it into extra
// cells/rows. Tolerates \r\n, bare \n, and a leading BOM (what downloadCSV
// itself writes, so a re-uploaded export parses cleanly).
export function parseCSV(text) {
  const source = text.startsWith(UTF8_BOM) ? text.slice(1) : text
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (inQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') continue
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  // Drops fully blank lines (a trailing newline, a stray empty line) -
  // a real row always has at least a name in its first cell.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

// The exact columns Inventory's own "Export CSV" produces (see Inventory.jsx)
// - Import CSV expects the same file back, in any column order.
export const PRODUCT_IMPORT_HEADERS = ['Name', 'SKU', 'Category', 'Price', 'Currency', 'Supplier', 'In stock', 'Wanted']

// Parses and fully validates a product-import CSV before anything is
// written anywhere: `categories`/`currencyCodes` are the team's own valid
// values (a product can't reference a category or currency that doesn't
// exist any more than the regular add-product form would let it). Returns
// either `{ products, errors: [] }` ready for importProducts, or
// `{ products: null, errors }` listing every problem found - never a
// partial result, so the caller can't accidentally import half a bad file.
export function parseProductImport(text, { categories, currencyCodes }) {
  const rows = parseCSV(text)
  if (rows.length === 0) {
    return { products: null, errors: ['The file is empty.'] }
  }

  const header = rows[0].map((h) => h.trim())
  const missing = PRODUCT_IMPORT_HEADERS.filter((h) => !header.includes(h))
  const extra = header.filter((h) => !PRODUCT_IMPORT_HEADERS.includes(h))
  if (missing.length > 0 || extra.length > 0) {
    const errors = []
    if (missing.length > 0) errors.push(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`)
    if (extra.length > 0) errors.push(`Unexpected column${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`)
    errors.push(`Expected exactly these columns (any order), same as Export CSV: ${PRODUCT_IMPORT_HEADERS.join(', ')}.`)
    return { products: null, errors }
  }

  const dataRows = rows.slice(1)
  if (dataRows.length === 0) {
    return { products: null, errors: ['No product rows found below the header.'] }
  }

  const colIndex = Object.fromEntries(PRODUCT_IMPORT_HEADERS.map((h) => [h, header.indexOf(h)]))
  const errors = []
  const products = []

  dataRows.forEach((cells, i) => {
    const rowNum = i + 2 // 1-indexed, plus the header row itself
    const get = (name) => (cells[colIndex[name]] ?? '').trim()

    const name = get('Name')
    const category = get('Category')
    const currency = get('Currency')
    const priceRaw = get('Price')
    const stockRaw = get('In stock')
    const wantedRaw = get('Wanted')

    const rowErrors = []
    if (!name) rowErrors.push('Name is required')
    if (!category) rowErrors.push('Category is required')
    else if (!categories.includes(category)) rowErrors.push(`category "${category}" doesn't exist - add it in Settings first`)
    if (!currency) rowErrors.push('Currency is required')
    else if (!currencyCodes.includes(currency)) rowErrors.push(`currency "${currency}" doesn't exist - add it in Settings first`)

    const price = Number(priceRaw)
    if (priceRaw === '' || Number.isNaN(price) || price < 0) {
      rowErrors.push(`Price "${priceRaw}" isn't a valid non-negative number`)
    }
    const stock = stockRaw === '' ? 0 : Number(stockRaw)
    if (Number.isNaN(stock) || stock < 0) rowErrors.push(`In stock "${stockRaw}" isn't a valid non-negative number`)
    const wanted = wantedRaw === '' ? 0 : Number(wantedRaw)
    if (Number.isNaN(wanted) || wanted < 0) rowErrors.push(`Wanted "${wantedRaw}" isn't a valid non-negative number`)

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}.`)
      return
    }

    products.push({
      ...DEFAULT_PRODUCT,
      name,
      sku: get('SKU'),
      category,
      price,
      currency,
      supplier: get('Supplier'),
      countInInventory: stock,
      wantedCount: wanted,
    })
  })

  return errors.length > 0 ? { products: null, errors } : { products, errors: [] }
}
