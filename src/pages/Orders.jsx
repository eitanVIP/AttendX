import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import ProductForm from '../components/ProductForm'
import ProductFilters from '../components/ProductFilters'
import ProductTable from '../components/ProductTable'
import StickyTableScroll from '../components/StickyTableScroll'
import { usePurchases, useOrderRequests, useProducts } from '../lib/firestore-hooks'
import {
  DEFAULT_PRODUCT,
  NO_PRODUCT_TYPES,
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
  dismissPurchase,
  logPurchase,
  mergeOrderRequestIntoProduct,
  revertPurchase,
  updateProduct,
} from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'
import { downloadCSV } from '../lib/csv'

export default function Orders() {
  const { team } = useAuth()
  const { data: products, loading } = useProducts(team?.id)
  const { data: requests } = useOrderRequests(team?.id)
  const { data: purchases } = usePurchases(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(DEFAULT_PRODUCT)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showBoughtForm, setShowBoughtForm] = useState(false)
  const [boughtProductId, setBoughtProductId] = useState('')
  const [boughtQuantity, setBoughtQuantity] = useState('1')

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
  // Manually logged (see the "+ Log a purchase" button below), not derived
  // from to-buy hitting 0 - an admin picks the product and quantity actually
  // bought, which is what makes each entry countable toward the dashboard's
  // budget spend regardless of what to-buy does afterward.
  const visiblePurchases = useMemo(
    () =>
      purchases
        .filter((p) => !p.dismissed)
        .filter((p) => !categoryFilter || p.category === categoryFilter),
    [purchases, categoryFilter]
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
      rememberForm('orders', payload, ['name', 'sku', 'link'])
      addProduct(team.id, payload)
    }
    setShowForm(false)
  }

  async function handleDelete(product) {
    if (!confirm('Remove this product? It disappears from both Inventory and Orders.')) return
    await deleteProduct(team.id, product)
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
        await mergeOrderRequestIntoProduct(team.id, request, dup)
        return
      }
    }
    await acceptOrderRequest(team.id, request)
  }

  async function handleDecline(request) {
    if (!confirm('Decline this request? It will be removed.')) return
    await declineOrderRequest(team.id, request)
  }

  function openBoughtForm() {
    setBoughtProductId('')
    setBoughtQuantity('1')
    setShowBoughtForm(true)
  }

  function handleLogPurchase(e) {
    e.preventDefault()
    const product = products.find((p) => p.id === boughtProductId)
    const quantity = Math.max(0, Math.round(Number(boughtQuantity) || 0))
    if (!product || quantity <= 0) return
    logPurchase(team.id, product, quantity)
    setShowBoughtForm(false)
  }

  async function handleDismissPurchase(purchase) {
    await dismissPurchase(team.id, purchase)
  }

  async function handleRevertPurchase(purchase) {
    if (!confirm(`Revert this purchase? ${purchase.quantity} × ${purchase.productName} will come back out of stock.`)) return
    await revertPurchase(team.id, purchase)
  }

  // `filtered` is what's currently on screen in the main table, so exporting
  // it covers that with the same columns ProductTable shows here.
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
        <button type="button" className="secondary" onClick={openBoughtForm}>
          + Log a purchase
        </button>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        Logged by hand - each one restocks the product and counts toward its category's spend on the
        dashboard. Dismiss just hides a row here; revert undoes it entirely.
      </p>
      <StickyTableScroll>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Category</th>
              <th>Quantity</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visiblePurchases.map((p) => {
              const converted = convertPrice(p.unitPrice, p.currency, preferred, rates)
              const cost = converted !== null ? converted * p.quantity : null
              return (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>{p.productName}</td>
                  <td className="muted">{p.category || 'Uncategorized'}</td>
                  <td>{p.quantity}</td>
                  <td>{cost !== null ? `${cost.toFixed(2)} ${preferred}` : '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="link-btn" onClick={() => handleDismissPurchase(p)}>
                        Dismiss
                      </button>
                      <button className="link-btn danger" onClick={() => handleRevertPurchase(p)}>
                        Revert
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {visiblePurchases.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StickyTableScroll>

      <FormPanel open={showBoughtForm} onClose={() => setShowBoughtForm(false)} onSubmit={handleLogPurchase}>
        <h2>Log a purchase</h2>
        <div className="form-grid">
          <label className="span-2">
            Product
            <select value={boughtProductId} onChange={(e) => setBoughtProductId(e.target.value)} required>
              <option value="" disabled>
                Choose…
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity bought
            <input
              type="number"
              min="1"
              step="1"
              value={boughtQuantity}
              onChange={(e) => setBoughtQuantity(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowBoughtForm(false)}>
            Cancel
          </button>
          <button type="submit">Log purchase</button>
        </div>
      </FormPanel>

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
