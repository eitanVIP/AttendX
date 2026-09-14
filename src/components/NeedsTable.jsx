import { useMemo, useState } from 'react'
import StickyTableScroll from './StickyTableScroll'
import ProductFilters from './ProductFilters'
import { availableForProduct, productMatchesSearch } from '../lib/calc'

// The "how much of each product does this system need" editor shared by
// the student (MySystems) and admin (Systems) pages - one row per product,
// with "Available" already excluding every OTHER system's claim on it (see
// usedQuantitiesByProduct in calc.js). Setting a row to 0 removes it from
// `needs` entirely rather than storing a zero entry.
//
// A quantity is no longer capped at what's available - a system can claim
// more than there is (Available then shows negative, see
// availableForProduct in calc.js). Leaving a field whose value exceeds
// Available offers, via `onRequestOrder(product, shortfall)`, to
// automatically request an order for the difference - MySystems submits an
// orderRequest for an admin to review, Systems (admin) bumps the product's
// wantedCount directly, same split as the rest of each page.
export default function NeedsTable({ products, categories, needs, usedQuantities, onChange, onRequestOrder }) {
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')

  const neededMap = useMemo(() => Object.fromEntries(needs.map((n) => [n.productId, n.quantity])), [needs])

  const visible = useMemo(
    () =>
      products
        .filter((p) => !categoryFilter || p.category === categoryFilter)
        .filter((p) => productMatchesSearch(p, search)),
    [products, categoryFilter, search]
  )

  function setQuantity(productId, rawValue) {
    const qty = Math.max(0, Math.round(Number(rawValue) || 0))
    const rest = needs.filter((n) => n.productId !== productId)
    onChange(qty > 0 ? [...rest, { productId, quantity: qty }] : rest)
  }

  // Runs on blur rather than every keystroke, so a confirm() dialog doesn't
  // interrupt someone still typing a multi-digit quantity. Confirming keeps
  // the over-allocated value and fires onRequestOrder; cancelling clamps the
  // field back down to what's actually available instead (0 if Available
  // itself is negative - setQuantity already floors there).
  function handleBlur(product) {
    const max = availableForProduct(product, usedQuantities)
    const qty = neededMap[product.id] || 0
    if (qty <= 0 || qty <= max) return
    const shortfall = qty - max
    const ok =
      onRequestOrder &&
      confirm(
        `Only ${max} ${product.name} available - this needs ${shortfall} more than that. Automatically request an order for the difference?`
      )
    if (ok) {
      onRequestOrder(product, shortfall)
    } else {
      setQuantity(product.id, max)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ marginBottom: 6 }}>Inventory needed</label>
      <ProductFilters
        products={products}
        categories={categories}
        categoryFilter={categoryFilter}
        onCategoryFilter={setCategoryFilter}
        search={search}
        onSearch={setSearch}
      />
      <StickyTableScroll style={{ marginTop: 10 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Available</th>
              <th>Needed</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const max = availableForProduct(p, usedQuantities)
              const value = neededMap[p.id] || 0
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted">{p.category}</td>
                  <td>{max}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={value || ''}
                      placeholder="0"
                      onChange={(e) => setQuantity(p.id, e.target.value)}
                      onBlur={() => handleBlur(p)}
                      style={{ width: 80 }}
                    />
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No products match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StickyTableScroll>
    </div>
  )
}
