import { useMemo, useState } from 'react'
import DataTable from './DataTable'
import ProductFilters from './ProductFilters'
import { availableForProduct, productMatchesSearch } from '../lib/calc'
import { t } from '../lib/i18n'

// The "how much of each product does this system need" editor shared by
// the student (MySystems) and admin (Systems) pages - one row per product,
// with "Available" already excluding every OTHER system's claim on it (see
// usedQuantitiesByProduct in calc.js). Setting a row to 0 removes it from
// `needs` entirely rather than storing a zero entry.
//
// A quantity is no longer capped at what's available - a system can claim
// more than there is (Available then shows negative, see
// availableForProduct in calc.js). Whether that's actually a problem is
// entirely up to the caller's own submit handler (see
// overallocatedNeeds in calc.js, used by Systems.jsx/MySystems.jsx) - this
// component itself no longer prompts about it. It used to, on blur, but a
// prompt tied to leaving the field is trivially skipped by pressing Enter
// (which submits the form before blur ever fires), so that check moved to
// the Add/Save button itself instead.
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

  function setQuantity(productId, rawValue) {
    const qty = Math.max(0, Math.round(Number(rawValue) || 0))
    const rest = needs.filter((n) => n.productId !== productId)
    onChange(qty > 0 ? [...rest, { productId, quantity: qty }] : rest)
  }

  const columns = [
    { key: 'name', header: t('Name'), sticky: 'left', cell: (p) => p.name },
    { key: 'category', header: t('Category'), cellClassName: 'muted', cell: (p) => p.category },
    { key: 'available', header: t('Available'), cell: (p) => availableForProduct(p, usedQuantities) },
    {
      key: 'needed',
      header: t('Needed'),
      cell: (p) => (
        <input
          type="number"
          min="0"
          value={neededMap[p.id] || ''}
          placeholder="0"
          onChange={(e) => setQuantity(p.id, e.target.value)}
          style={{ width: 80 }}
        />
      ),
    },
  ]

  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ marginBottom: 6 }}>{t('Inventory needed')}</label>
      <ProductFilters
        products={products}
        categories={categories}
        categoryFilter={categoryFilter}
        onCategoryFilter={setCategoryFilter}
        search={search}
        onSearch={setSearch}
      />
      {/* stickyTop 0, not the page's own --sticky-top: this table lives
          inside a FormPanel modal (its own scroll container, not the
          page), which has no admin header to duck under. */}
      <DataTable cards
        columns={columns}
        rows={visible}
        stickyTop={0}
        emptyMessage={t('No products match.')}
        style={{ marginTop: 10 }}
      />
    </div>
  )
}
