import { DEFAULT_PRODUCT, canonicalSupplier, purchasedUnits } from './calc'
import { convertPrice } from './currency'

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
// - Import CSV expects the same file back, in any column order. Subcategory
// is the one column a file may leave out entirely (files exported before
// subcategories existed don't have it), in which case every row just has
// no subcategory.
export const PRODUCT_IMPORT_HEADERS = ['Name', 'SKU', 'Category', 'Subcategory', 'Price', 'Currency', 'Supplier', 'Link', 'In stock', 'Wanted']
const OPTIONAL_IMPORT_HEADERS = ['Subcategory']

// Parses and fully validates a product-import CSV before anything is
// written anywhere: `categories`/`currencyCodes` are the team's own valid
// values (a product can't reference a category or currency that doesn't
// exist any more than the regular add-product form would let it). Returns
// either `{ products, errors: [] }` ready for importProducts, or
// `{ products: null, errors }` listing every problem found - never a
// partial result, so the caller can't accidentally import half a bad file.
export function parseProductImport(text, { categories, subcategories = {}, currencyCodes }) {
  const rows = parseCSV(text)
  if (rows.length === 0) {
    return { products: null, errors: ['The file is empty.'] }
  }

  const header = rows[0].map((h) => h.trim())
  const missing = PRODUCT_IMPORT_HEADERS.filter((h) => !header.includes(h) && !OPTIONAL_IMPORT_HEADERS.includes(h))
  const extra = header.filter((h) => !PRODUCT_IMPORT_HEADERS.includes(h))
  if (missing.length > 0 || extra.length > 0) {
    const errors = []
    if (missing.length > 0) errors.push(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`)
    if (extra.length > 0) errors.push(`Unexpected column${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`)
    errors.push(
      `Expected exactly these columns (any order, ${OPTIONAL_IMPORT_HEADERS.join(', ')} optional), same as Export CSV: ${PRODUCT_IMPORT_HEADERS.join(', ')}.`
    )
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
    const get = (name) => (colIndex[name] === -1 ? '' : (cells[colIndex[name]] ?? '').trim())

    const name = get('Name')
    const category = get('Category')
    const subcategory = get('Subcategory')
    const currency = get('Currency')
    const priceRaw = get('Price')
    const stockRaw = get('In stock')
    const wantedRaw = get('Wanted')

    const rowErrors = []
    if (!name) rowErrors.push('Name is required')
    if (!category) rowErrors.push('Category is required')
    else if (!categories.includes(category)) rowErrors.push(`category "${category}" doesn't exist - add it in Settings first`)
    else if (subcategory && !(subcategories[category] || []).includes(subcategory)) {
      rowErrors.push(`subcategory "${subcategory}" doesn't exist under "${category}" - add it in Settings first`)
    }
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
      subcategory,
      price,
      currency,
      supplier: get('Supplier'),
      link: get('Link'),
      countInInventory: stock,
      wantedCount: wanted,
    })
  })

  return errors.length > 0 ? { products: null, errors } : { products, errors: [] }
}

// What Orders' "Export CSV" in the Bought section writes: every purchase ever
// logged (dismissed ones too - dismissing only hides a row on Orders), one line
// each, in the order given. Quantity counts packs (what was bought); Units
// added is what actually went into stock (packs x pack size). Dates stay ISO
// (YYYY-MM-DD) so a spreadsheet sorts them. Cost is in the currency it was
// paid in, and again converted to the team's preferred one.
export function purchaseExportHeaders(preferred) {
  return ['Date', 'Item', 'Type', 'Category', 'Supplier', 'Quantity', 'Pack size', 'Units added', 'Unit price', 'Currency', 'Cost', `Cost (${preferred})`, 'Dismissed']
}

function purchaseType(p) {
  if (p.productId) return 'Product'
  if (p.discount) return 'Discount'
  if (p.shipping) return 'Shipping'
  return 'Manual expense'
}

const round2 = (n) => Math.round(n * 100) / 100

export function purchaseExportRows(purchases, rates, preferred) {
  return purchases.map((p) => {
    const quantity = p.quantity || 0
    const unitPrice = p.unitPrice || 0
    const converted = unitPrice === 0 ? 0 : convertPrice(unitPrice, p.currency, preferred, rates)
    const isProduct = purchaseType(p) === 'Product'
    return [
      p.date || '',
      p.productName || '',
      purchaseType(p),
      p.category || '',
      p.supplier || '',
      quantity,
      isProduct ? p.unitsPerPurchase || 1 : '',
      isProduct ? round2(purchasedUnits(p)) : '',
      unitPrice,
      p.currency || '',
      round2(unitPrice * quantity),
      converted === null ? '' : round2(converted * quantity),
      p.dismissed ? 'Yes' : 'No',
    ]
  })
}

// Which supplier a purchase belongs to for the export's supplier filter:
// the list's own spelling, lower-cased ('' for none), so "saad" and "Saad"
// are one supplier.
export function purchaseSupplierKey(p, suppliers) {
  return canonicalSupplier(p.supplier, suppliers).toLowerCase()
}

// The suppliers that appear on at least one purchase, as { key, label } sorted
// by label ('' = bought with no supplier recorded).
export function purchaseSupplierOptions(purchases, suppliers) {
  const byKey = new Map()
  for (const p of purchases) {
    const key = purchaseSupplierKey(p, suppliers)
    if (!byKey.has(key)) byKey.set(key, canonicalSupplier(p.supplier, suppliers))
  }
  return [...byKey].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label))
}

// Keeps only the purchases from the chosen supplier keys; no keys = all of them.
export function filterPurchasesBySupplier(purchases, keys, suppliers) {
  if (keys.length === 0) return purchases
  return purchases.filter((p) => keys.includes(purchaseSupplierKey(p, suppliers)))
}
