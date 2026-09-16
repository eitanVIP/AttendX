import { useState } from 'react'
import StickyTableScroll from './StickyTableScroll'
import FormPanel from './FormPanel'
import { NO_PRODUCT_TYPES, computeToBuy, computeTotalPrice, hasCustomData } from '../lib/calc'
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
  showToBuy,
  showTotal,
  showRequestedBy,
  emptyMessage = 'No products yet.',
}) {
  const [viewingNotes, setViewingNotes] = useState(null)
  const [viewingData, setViewingData] = useState(null)

  // Existing teams predate preferredCurrency/currencyRates entirely (their
  // team doc has neither field), so this needs the same fallback Settings'
  // CurrenciesSection uses - without it every price here silently falls
  // back to its raw stored currency instead of ever converting.
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const productTypes = team?.productTypes || NO_PRODUCT_TYPES

  // A product's type can replace either of these with its own formula,
  // looked up live from productTypes every render (see computeToBuy/
  // computeTotalPrice in calc.js) - falls back to the plain math for every
  // regular product.
  const rowValues = (p) => {
    const converted = convertPrice(p.price, p.currency, preferred, rates)
    const toBuy = computeToBuy(p, productTypes)
    const total = computeTotalPrice(p, productTypes, converted, toBuy.value)
    return { converted, toBuy, total }
  }
  const grandTotal = showTotal ? products.reduce((sum, p) => sum + (rowValues(p).total.value || 0), 0) : 0
  // 5 always-shown columns (Name, SKU, Category, Price, Supplier) + whichever
  // of Currency/In stock/Wanted/To buy/Total/Requested by apply + Info + the
  // trailing actions column. Total, when shown, always ends up right before
  // Requested by/Info/Actions regardless of which of the others are on - see
  // trailingAfterTotal below, which relies on that.
  const colCount =
    5 +
    (showCurrency ? 1 : 0) +
    (showInStock ? 1 : 0) +
    (showWanted ? 1 : 0) +
    (showToBuy ? 1 : 0) +
    (showTotal ? 1 : 0) +
    (showRequestedBy ? 1 : 0) +
    1 +
    1
  // Columns after Total's own value cell, for the footer's trailing colSpan.
  const trailingAfterTotal = 2 + (showRequestedBy ? 1 : 0)

  return (
    <>
      <StickyTableScroll>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Price</th>
              {showCurrency && <th>Currency</th>}
              <th>Supplier</th>
              {showInStock && <th>In stock</th>}
              {showWanted && <th>Wanted</th>}
              {showToBuy && <th>To buy</th>}
              {showTotal && <th>Total</th>}
              {showRequestedBy && <th>Requested by</th>}
              <th>Info</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const { converted, toBuy, total } = rowValues(p)
              const priceLabel =
                converted !== null ? `${converted.toFixed(2)} ${preferred}` : p.price ? `${p.price} ${p.currency}` : '—'
              return (
                <tr key={p.id}>
                  <td>
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noreferrer">
                        {p.name}
                      </a>
                    ) : (
                      p.name
                    )}
                  </td>
                  <td>{p.sku}</td>
                  <td>{p.category}</td>
                  <td title={converted !== null ? `Stored as ${p.price} ${p.currency}` : undefined}>{priceLabel}</td>
                  {showCurrency && <td>{p.currency}</td>}
                  <td>{p.supplier}</td>
                  {showInStock && <td>{p.countInInventory}</td>}
                  {showWanted && <td>{p.wantedCount}</td>}
                  {showToBuy && (
                    <td title={toBuy.error || undefined}>{toBuy.value !== null ? toBuy.value : '—'}</td>
                  )}
                  {showTotal && (
                    <td title={total.error || undefined}>
                      {total.value !== null ? `${total.value.toFixed(2)} ${preferred}` : '—'}
                    </td>
                  )}
                  {showRequestedBy && <td>{p.requestedBy}</td>}
                  <td>
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
                  </td>
                  <td>
                    <div className="row-actions">
                      {onAccept ? (
                        <>
                          <button className="link-btn" onClick={() => onAccept(p)}>
                            Accept
                          </button>
                          <button className="link-btn danger" onClick={() => onDecline(p.id)}>
                            Decline
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="link-btn" onClick={() => onEdit(p)}>
                            Edit
                          </button>
                          <button className="link-btn danger" onClick={() => onDelete(p.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty-cell">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
          {showTotal && products.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={colCount - 1 - trailingAfterTotal}>
                  <strong>Total</strong>
                </td>
                <td>
                  <strong>
                    {grandTotal.toFixed(2)} {preferred}
                  </strong>
                </td>
                <td colSpan={trailingAfterTotal}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </StickyTableScroll>

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
        <table className="data-table" style={{ margin: 0, minWidth: 0 }}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(viewingData?.customData || {})
              .filter(([field]) => field !== 'type')
              .map(([field, value]) => (
                <tr key={field}>
                  <td>{field}</td>
                  <td>{value}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="form-actions">
          <button type="submit">Close</button>
        </div>
      </FormPanel>
    </>
  )
}
