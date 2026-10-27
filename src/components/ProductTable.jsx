import { useMemo, useState } from 'react'
import DataTable from './DataTable'
import FormPanel from './FormPanel'
import {
  NO_PRODUCT_TYPES,
  NO_SUPPLIERS,
  availableForProduct,
  computeToBuy,
  computeTotalPrice,
  effectivePrice,
  hasCustomData,
  supplierMultiplier,
} from '../lib/calc'
import { convertPrice, DEFAULT_CURRENCY_RATES } from '../lib/currency'

// Shared by Inventory and Orders, but the two show different columns:
// Inventory is about what's on the shelf (in stock, wanted), Orders is
// about what needs buying (to buy, total) and doesn't need in
// stock/wanted/currency cluttering it up - see the showX props, all
// default true so a page only has to turn off what it doesn't want. A
// row's total is priced against what's actually still needed
// (`computeToBuy`), not the full wanted count - stock already on hand
// doesn't need buying.
export default function ProductTable({
  products,
  team,
  onEdit,
  onDelete,
  onAccept,
  onDecline,
  showCurrency = true,
  showInStock = true,
  showWanted = true,
  showConsumable = true,
  showToBuy,
  showTotal,
  showRequestedBy,
  usedQuantities,
  emptyMessage = 'No products yet.',
}) {
  const [viewingNotes, setViewingNotes] = useState(null)
  const [viewingData, setViewingData] = useState(null)
  // Click a column header to sort by it: ascending, then descending, then
  // back to the order the page gave. Only reorders - nothing is hidden.
  const [sort, setSort] = useState(null) // { key, dir: 1 | -1 }

  // Existing teams predate preferredCurrency/currencyRates entirely (their
  // team doc has neither field), so this needs the same fallback Settings'
  // CurrenciesSection uses - without it every price here silently falls
  // back to its raw stored currency instead of ever converting.
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const productTypes = team?.productTypes || NO_PRODUCT_TYPES
  const suppliers = team?.suppliers || NO_SUPPLIERS

  // A product's type can replace either of these with its own formula,
  // looked up live from productTypes every render (see computeToBuy/
  // computeTotalPrice in calc.js) - falls back to the plain math for every
  // regular product. Computed once per product (not once per cell that
  // needs it) and looked up by id from the cells below.
  const rowValuesById = useMemo(() => {
    const map = new Map()
    for (const p of products) {
      const converted = convertPrice(effectivePrice(p, suppliers), p.currency, preferred, rates)
      const toBuy = computeToBuy(p, productTypes)
      const total = computeTotalPrice(p, productTypes, converted, toBuy.value)
      map.set(p.id, { converted, toBuy, total })
    }
    return map
  }, [products, productTypes, suppliers, rates, preferred])

  // What each sortable column sorts by. Text compares case-insensitively and
  // blanks always go last, whichever direction.
  const sortValues = useMemo(
    () => ({
      name: (p) => p.name,
      sku: (p) => p.sku,
      category: (p) => p.category,
      price: (p) => rowValuesById.get(p.id)?.converted ?? p.price,
      currency: (p) => p.currency,
      supplier: (p) => p.supplier,
      inStock: (p) => p.countInInventory,
      available: (p) => availableForProduct(p, usedQuantities),
      wanted: (p) => p.wantedCount,
      toBuy: (p) => rowValuesById.get(p.id)?.toBuy.value,
      total: (p) => rowValuesById.get(p.id)?.total.value,
      requestedBy: (p) => p.requestedBy,
    }),
    [rowValuesById, usedQuantities]
  )

  const sortedProducts = useMemo(() => {
    if (!sort) return products
    const get = sortValues[sort.key]
    const isBlank = (v) => v === null || v === undefined || v === ''
    return [...products].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (isBlank(va) || isBlank(vb)) return isBlank(va) - isBlank(vb)
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true })
      return cmp * sort.dir
    })
  }, [products, sort, sortValues])

  function toggleSort(key) {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: 1 }
      return current.dir === 1 ? { key, dir: -1 } : null
    })
  }

  const grandTotal = showTotal
    ? products.reduce((sum, p) => sum + (rowValuesById.get(p.id)?.total.value || 0), 0)
    : 0

  const columns = useMemo(() => {
    const cols = [
      {
        key: 'name',
        header: 'Name',
        sticky: 'left',
        // Higher than the right columns' own default priority (~500), so
        // on a narrow screen the name is the last thing to unfreeze, not
        // the first - a bare 'left' column would otherwise default to
        // exactly the right scale too and could lose to a wide Actions
        // column depending on column count.
        stickyPriority: 2000,
        // minWidth, not width: in table-layout: auto, a plain `width` is
        // only a flexible hint the browser happily shrinks back down to
        // the content's own size once the table's columns don't all fit
        // their specified widths (which is why raising it 3 times did
        // nothing - every actual name was already shorter than it).
        // minWidth is a hard floor - the table scrolls instead of shrinking
        // it, same as Price's own minWidth just below. Paired with
        // maxWidth so a long name still wraps to a couple of lines instead
        // of stretching the column (and everything after it) out further.
        minWidth: 240,
        maxWidth: 340,
        footerCell: () => (showTotal ? <strong>Total</strong> : null),
        cell: (p) =>
          p.link ? (
            <a href={p.link} target="_blank" rel="noreferrer">
              {p.name}
            </a>
          ) : (
            p.name
          ),
      },
      { key: 'sku', header: 'SKU', cell: (p) => p.sku },
      { key: 'category', header: 'Category', cell: (p) => p.category },
      {
        key: 'price',
        header: 'Price',
        minWidth: 110,
        cell: (p) => {
          const { converted } = rowValuesById.get(p.id) || {}
          const multiplier = supplierMultiplier(p.supplier, suppliers)
          const paid = effectivePrice(p, suppliers)
          const label = converted !== null ? `${converted.toFixed(2)} ${preferred}` : paid ? `${paid} ${p.currency}` : '—'
          const markup = multiplier !== 1 ? ` ×${multiplier} via ${p.supplier}` : ''
          return (
            <span title={converted !== null || markup ? `Listed at ${p.price} ${p.currency}${markup}` : undefined}>
              {label}
            </span>
          )
        },
      },
    ]
    if (showCurrency) cols.push({ key: 'currency', header: 'Currency', cell: (p) => p.currency })
    cols.push({ key: 'supplier', header: 'Supplier', cell: (p) => p.supplier })
    if (showInStock)
      cols.push({
        key: 'inStock',
        header: 'In stock',
        nowrap: true,
        cell: (p) => (
          <>
            {p.countInInventory}
            {p.lentOut > 0 && (
              <span className="badge badge-warn" style={{ marginLeft: 6 }} title="Lent to another team - see Borrowing">
                {p.lentOut} lent out
              </span>
            )}
          </>
        ),
      })
    // Stock minus what systems claim and what's lent out - only where the
    // page passes the systems' usedQuantities (Inventory).
    if (usedQuantities)
      cols.push({ key: 'available', header: 'Available', cell: (p) => availableForProduct(p, usedQuantities) })
    if (showWanted) cols.push({ key: 'wanted', header: 'Wanted', cell: (p) => p.wantedCount })
    if (showToBuy)
      cols.push({
        key: 'toBuy',
        header: 'To buy',
        cell: (p) => {
          const { toBuy } = rowValuesById.get(p.id) || {}
          return <span title={toBuy?.error || undefined}>{toBuy?.value !== null ? toBuy.value : '—'}</span>
        },
      })
    if (showTotal)
      cols.push({
        key: 'total',
        header: 'Total',
        cell: (p) => {
          const { total } = rowValuesById.get(p.id) || {}
          return (
            <span title={total?.error || undefined}>
              {total?.value !== null ? `${total.value.toFixed(2)} ${preferred}` : '—'}
            </span>
          )
        },
        footerCell: () => (
          <strong>
            {grandTotal.toFixed(2)} {preferred}
          </strong>
        ),
      })
    if (showRequestedBy) cols.push({ key: 'requestedBy', header: 'Requested by', cell: (p) => p.requestedBy })
    if (showConsumable)
      cols.push({
        key: 'consumable',
        header: 'Consumable',
        align: 'center',
        cell: (p) => (
          <input
            type="checkbox"
            checked={!!p.consumable}
            disabled
            title="Consumable - claiming it on a system lowers its real stock. Change it from Edit."
          />
        ),
      })
    cols.push({
      key: 'info',
      header: 'Info',
      cell: (p) => (
        <div className="row-actions">
          {p.notes && (
            <button type="button" className="link-btn" onClick={() => setViewingNotes(p)}>
              Notes
            </button>
          )}
          {hasCustomData(p) && (
            <button type="button" className="link-btn" onClick={() => setViewingData(p)}>
              Data
            </button>
          )}
        </div>
      ),
    })
    cols.push({
      key: 'actions',
      header: '',
      sticky: 'right',
      nowrap: true,
      cell: (p) => (
        <div className="row-actions">
          {onAccept ? (
            <>
              <button className="link-btn" onClick={() => onAccept(p)}>
                Accept
              </button>
              <button className="link-btn danger" onClick={() => onDecline(p)}>
                Decline
              </button>
            </>
          ) : (
            <>
              <button className="link-btn" onClick={() => onEdit(p)}>
                Edit
              </button>
              <button className="link-btn danger" onClick={() => onDelete(p)}>
                Delete
              </button>
            </>
          )}
        </div>
      ),
    })
    // Frozen columns keep their own width and alignment; the rest share the leftover equally, centred.
    return cols.map((c) => (c.sticky ? c : { align: 'center', ...c, spread: true })).map((col) =>
      sortValues[col.key]
        ? {
            ...col,
            header: () => (
              <button
                type="button"
                className="dt-sort-btn"
                onClick={() => toggleSort(col.key)}
                title="Sort by this column"
                aria-sort={sort?.key === col.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
              >
                {col.header}
                <span className="dt-sort-arrow">{sort?.key === col.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
              </button>
            ),
          }
        : col
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sort,
    sortValues,
    showCurrency,
    showInStock,
    showWanted,
    showConsumable,
    showToBuy,
    showTotal,
    showRequestedBy,
    usedQuantities,
    rowValuesById,
    grandTotal,
    preferred,
    onAccept,
    onDecline,
    onEdit,
    onDelete,
  ])

  return (
    <>
      <DataTable columns={columns} rows={sortedProducts} emptyMessage={emptyMessage} footer={showTotal} />

      <FormPanel
        open={!!viewingNotes}
        onClose={() => setViewingNotes(null)}
        onSubmit={(e) => {
          e.preventDefault()
          setViewingNotes(null)
        }}
      >
        <h2>{viewingNotes?.name}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{viewingNotes?.notes}</p>
        <div className="form-actions">
          <button type="submit">Close</button>
        </div>
      </FormPanel>

      <FormPanel
        open={!!viewingData}
        onClose={() => setViewingData(null)}
        onSubmit={(e) => {
          e.preventDefault()
          setViewingData(null)
        }}
      >
        <h2>
          {viewingData?.name} - {viewingData?.customData?.type}
        </h2>
        <DataTable
          stickyHeader={false}
          style={{ margin: 0 }}
          columns={[
            { key: 'field', header: 'Field', cell: ([field]) => field },
            { key: 'value', header: 'Value', cell: ([, value]) => value },
          ]}
          rows={Object.entries(viewingData?.customData || {}).filter(([field]) => field !== 'type')}
          getRowId={([field]) => field}
        />
        <div className="form-actions">
          <button type="submit">Close</button>
        </div>
      </FormPanel>
    </>
  )
}
