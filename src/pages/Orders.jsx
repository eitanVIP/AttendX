import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import ProductForm from '../components/ProductForm'
import ProductFilters from '../components/ProductFilters'
import ProductTable from '../components/ProductTable'
import { useOrderRequests, useProducts } from '../lib/firestore-hooks'
import {
  DEFAULT_PRODUCT,
  NO_PRODUCT_TYPES,
  boughtFlagChanges,
  computeToBuy,
  computeTotalPrice,
  findDuplicateProduct,
  productMatchesSearch,
} from '../lib/calc'
import { convertPrice, DEFAULT_CURRENCY_RATES } from '../lib/currency'
import {
  acceptOrderRequest,
  addProduct,
  declineOrderRequest,
  deleteProduct,
  dismissAllBought,
  dismissBought,
  mergeOrderRequestIntoProduct,
  updateProduct,
} from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'
import { downloadCSV } from '../lib/csv'

export default function Orders() {
  const { team } = useAuth()
  const { data: products, loading } = useProducts(team?.id)
  const { data: requests } = useOrderRequests(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(DEFAULT_PRODUCT)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')

  const categories = team?.categories || []
  const productTypes = team?.productTypes || NO_PRODUCT_TYPES
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const currencyCodes = Object.keys(rates)

  // The bottom total on each table is "based on what's not filtered" - so
  // it's computed from these same filtered lists, not the full one. A
  // product whose to-buy formula errored (value null, not 0) stays in the
  // main table rather than Bought, so a broken formula is something an
  // admin notices instead of a product that quietly reappears as "done".
  const filtered = useMemo(
    () =>
      products
        .filter((p) => !categoryFilter || p.category === categoryFilter)
        .filter((p) => productMatchesSearch(p, search, { rates, preferred })),
    [products, categoryFilter, search, rates, preferred]
  )
  const needsBuying = useMemo(
    () => filtered.filter((p) => computeToBuy(p, productTypes).value !== 0),
    [filtered, productTypes]
  )
  // Bought isn't "everything currently at 0 to buy" - that's most of a
  // team's whole catalog forever - it's products an edit just brought down
  // to 0 (boughtFlag, set in handleSubmit/handleAccept below via
  // boughtFlagChanges) and that are in fact still at 0 right now, until
  // dismissed or needed again.
  const bought = useMemo(
    () => filtered.filter((p) => p.boughtFlag && computeToBuy(p, productTypes).value === 0),
    [filtered, productTypes]
  )
  const filteredRequests = useMemo(
    () =>
      requests
        .filter((p) => !categoryFilter || p.category === categoryFilter)
        .filter((p) => productMatchesSearch(p, search, { rates, preferred })),
    [requests, categoryFilter, search, rates, preferred]
  )

  function startNew() {
    setEditingId(null)
    setForm(withLastValues('orders', DEFAULT_PRODUCT))
    setShowForm(true)
  }

  function startEdit(product) {
    setEditingId(product.id)
    const { id: _id, ...fields } = product
    setForm(fields)
    setShowForm(true)
  }

  // Adding here only asks for how many are wanted - the product still shows
  // up on Inventory too, at 0 in stock, since it's the same doc (see
  // normalizeProduct in calc.js).
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
      const oldProduct = products.find((p) => p.id === editingId)
      const boughtChanges = oldProduct ? boughtFlagChanges(oldProduct, payload, productTypes) : {}
      updateProduct(team.id, editingId, { ...payload, ...boughtChanges })
    } else {
      // SKU and link are per-item, not something the next product likely
      // shares - only the rest of the form (category, price, currency,
      // supplier, notes) is worth remembering.
      rememberForm('orders', payload, ['name', 'sku', 'link'])
      addProduct(team.id, payload)
    }
    setShowForm(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this product? It disappears from both Inventory and Orders.')) return
    await deleteProduct(team.id, id)
  }

  // Accepting turns the request into a real product (so it shows up on both
  // Inventory and Orders, same as adding one directly - see
  // acceptOrderRequest in actions.js); declining just removes the request.
  // If a product with the same (trimmed, case-insensitive) name already
  // exists - same check as adding a product by hand - the admin decides
  // whether it's really the same product (fold the wanted count into it)
  // or a genuinely separate one.
  async function handleAccept(request) {
    const dup = findDuplicateProduct(products, request.name, null)
    if (dup) {
      const merge = confirm(
        `A product named "${dup.name}" already exists. OK adds this request's wanted count to it instead of creating a separate product. Cancel adds it as a separate product.`
      )
      if (merge) {
        const merged = { ...dup, wantedCount: (dup.wantedCount || 0) + (request.wantedCount || 0) }
        await mergeOrderRequestIntoProduct(team.id, request, dup, boughtFlagChanges(dup, merged, productTypes))
        return
      }
    }
    await acceptOrderRequest(team.id, request)
  }

  async function handleDecline(id) {
    if (!confirm('Decline this request? It will be removed.')) return
    await declineOrderRequest(team.id, id)
  }

  async function handleDismiss(id) {
    await dismissBought(team.id, id)
  }

  async function handleDismissAll() {
    await dismissAllBought(
      team.id,
      bought.map((p) => p.id)
    )
  }

  // `filtered` is the union of the two tables below (needsBuying + bought),
  // so exporting it covers everything currently visible on the page in one
  // file, with the same columns ProductTable shows here.
  function handleExport() {
    const headers = ['Name', 'SKU', 'Category', 'Price', 'Supplier', 'To buy', 'Total']
    const rows = filtered.map((p) => {
      const converted = convertPrice(p.price, p.currency, preferred, rates)
      const toBuy = computeToBuy(p, productTypes)
      const total = computeTotalPrice(p, productTypes, converted, toBuy.value)
      return [
        p.name,
        p.sku,
        p.category,
        converted !== null ? converted.toFixed(2) : p.price,
        p.supplier,
        toBuy.value !== null ? toBuy.value : '',
        total.value !== null ? total.value.toFixed(2) : '',
      ]
    })
    downloadCSV('orders.csv', headers, rows)
  }

  if (loading) return <div className="page-loading">Loading orders…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Orders</h1>
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={handleExport}>
              Export CSV
            </button>
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

      <ProductForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        editing={!!editingId}
        countField="wantedCount"
        countLabel="Wanted count"
        categories={categories}
        currencyCodes={currencyCodes}
        productTypes={productTypes}
      />

      <ProductTable
        products={needsBuying}
        team={team}
        onEdit={startEdit}
        onDelete={handleDelete}
        showCurrency={false}
        showInStock={false}
        showWanted={false}
        showToBuy
        showTotal
      />

      <div className="page-header">
        <h2>Bought</h2>
        {bought.length > 0 && (
          <button type="button" className="secondary" onClick={handleDismissAll}>
            Dismiss all
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        Products an edit just brought down to 0 left to buy - dismiss one once it's actually been bought.
      </p>
      <ProductTable
        products={bought}
        team={team}
        onEdit={startEdit}
        onDelete={handleDelete}
        onDismiss={handleDismiss}
        showCurrency={false}
        showInStock={false}
        showWanted={false}
        showToBuy
        showTotal
        emptyMessage="Nothing here yet."
      />

      <h2>Student requests</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Submitted from the request-a-product page - accept adds it to Inventory and Orders, decline removes it.
      </p>
      <ProductTable
        products={filteredRequests}
        team={team}
        onAccept={handleAccept}
        onDecline={handleDecline}
        showCurrency={false}
        showInStock={false}
        showWanted={false}
        showToBuy
        showTotal
        showRequestedBy
        emptyMessage="No pending requests."
      />
    </div>
  )
}
