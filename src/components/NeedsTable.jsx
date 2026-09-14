import { useMemo, useState } from 'react'
import StickyTableScroll from './StickyTableScroll'
import ProductFilters from './ProductFilters'
import { availableForProduct, productMatchesSearch } from '../lib/calc'

// The "how much of each product does this system need" editor shared by
// the student (MySystems) and admin (Systems) pages - one row per product,
// with "Available" already excluding every OTHER system's claim on it (see
// usedQuantitiesByProduct in calc.js) and a quantity input capped there.
// Setting a row to 0 removes it from `needs` entirely rather than storing
// a zero entry.
export default function NeedsTable({ products, categories, needs, usedQuantities, onChange }) {
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

  function setQuantity(productId, rawValue, max) {
    const qty = Math.max(0, Math.min(Math.round(Number(rawValue) || 0), max))
    const rest = needs.filter((n) => n.productId !== productId)
    onChange(qty > 0 ? [...rest, { productId, quantity: qty }] : rest)
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
                      max={max}
                      value={value || ''}
                      placeholder="0"
                      onChange={(e) => setQuantity(p.id, e.target.value, max)}
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
