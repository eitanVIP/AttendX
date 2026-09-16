import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import ProductForm from '../components/ProductForm'
import ProductFilters from '../components/ProductFilters'
import ProductTable from '../components/ProductTable'
import { useProducts } from '../lib/firestore-hooks'
import { DEFAULT_PRODUCT, NO_PRODUCT_TYPES, findDuplicateProduct, productMatchesSearch } from '../lib/calc'
import { DEFAULT_CURRENCY_RATES } from '../lib/currency'
import { addProduct, deleteProduct, importProducts, updateProduct } from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'
import { downloadCSV, parseProductImport } from '../lib/csv'

export default function Inventory() {
  const { team } = useAuth()
  const { data: products, loading } = useProducts(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(DEFAULT_PRODUCT)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [importErrors, setImportErrors] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  const categories = team?.categories || []
  const productTypes = team?.productTypes || NO_PRODUCT_TYPES
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const currencyCodes = Object.keys(rates)

  const filtered = useMemo(
    () =>
      products
        .filter((p) => !categoryFilter || p.category === categoryFilter)
        .filter((p) => productMatchesSearch(p, search, { rates, preferred })),
    [products, categoryFilter, search, rates, preferred]
  )

  function startNew() {
    setEditingId(null)
    setForm(withLastValues('inventory', DEFAULT_PRODUCT))
    setShowForm(true)
  }

  function startEdit(product) {
    setEditingId(product.id)
    const { id: _id, ...fields } = product
    setForm(fields)
    setShowForm(true)
  }

  // Adding here only asks for the count actually on the shelf - the
  // product still shows up on Orders too, at 0 wanted, since it's the same
  // doc (see normalizeProduct in calc.js).
  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      ...form,
      price: Number(form.price) || 0,
      countInInventory: Number(form.countInInventory) || 0,
      wantedCount: Number(form.wantedCount) || 0,
    }
    if (!editingId) {
      const dup = findDuplicateProduct(products, payload.name, null)
      if (dup && !confirm(`A product named "${dup.name}" already exists. Add this one anyway?`)) return
    }
    if (editingId) {
      updateProduct(team.id, editingId, payload)
    } else {
      // SKU and link are per-item, not something the next product likely
      // shares - only the rest of the form (category, price, currency,
      // supplier, notes) is worth remembering.
      rememberForm('inventory', payload, ['name', 'sku', 'link'])
      addProduct(team.id, payload)
    }
    setShowForm(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this product? It disappears from both Inventory and Orders.')) return
    await deleteProduct(team.id, id)
  }

  // Matches the columns ProductTable actually shows here (no To buy/Total on
  // Inventory) and only the currently filtered/searched rows - what's on
  // screen, not the whole collection. Price is the raw stored value paired
  // with its own Currency, not the table's converted display price - a
  // converted amount next to the ORIGINAL currency code would be a
  // contradiction (e.g. "37.00, USD" for a product actually stored as 10
  // USD), and this same file is what Import CSV reads back in, so it has to
  // round-trip losslessly.
  function handleExport() {
    const headers = ['Name', 'SKU', 'Category', 'Price', 'Currency', 'Supplier', 'In stock', 'Wanted']
    const rows = filtered.map((p) => [
      p.name,
      p.sku,
      p.category,
      p.price,
      p.currency,
      p.supplier,
      p.countInInventory,
      p.wantedCount,
    ])
    downloadCSV('inventory.csv', headers, rows)
  }

  // Validates the whole file before writing anything - if any row is wrong,
  // nothing is imported and every problem is reported at once (see
  // parseProductImport in csv.js), rather than silently skipping bad rows
  // or leaving a half-imported mess to clean up.
  async function handleImportFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setImportErrors(null)
    setImportResult(null)
    const text = await file.text()
    const { products: parsed, errors } = parseProductImport(text, { categories, currencyCodes })
    if (errors.length > 0) {
      setImportErrors(errors)
      return
    }
    await importProducts(team.id, parsed)
    setImportResult(`Imported ${parsed.length} product${parsed.length === 1 ? '' : 's'}.`)
  }

  if (loading) return <div className="page-loading">Loading inventory…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Inventory</h1>
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={handleExport}>
              Export CSV
            </button>
            <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
              Import CSV
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
            <button onClick={startNew}>+ Add product</button>
          </div>
        </div>

        <ProductFilters
          products={products}
          categories={categories}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          search={search}
          onSearch={setSearch}
        />
      </div>

      {importErrors && (
        <div className="form-error" style={{ marginBottom: 16 }}>
          <strong>
            Couldn't import that file - fix {importErrors.length === 1 ? 'this' : 'these'} and try again:
          </strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {importErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      {importResult && (
        <p className="muted" style={{ marginBottom: 16 }}>
          {importResult}
        </p>
      )}

      <ProductForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        editing={!!editingId}
        countField="countInInventory"
        countLabel="Count in inventory"
        categories={categories}
        currencyCodes={currencyCodes}
        productTypes={productTypes}
      />

      <ProductTable products={filtered} team={team} onEdit={startEdit} onDelete={handleDelete} />
    </div>
  )
}
