import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import ProductForm from '../components/ProductForm'
import ProductFilters from '../components/ProductFilters'
import ProductTable from '../components/ProductTable'
import DataTable from '../components/DataTable'
import { usePurchases, useOrderRequests, useProducts } from '../lib/firestore-hooks'
import {
  DEFAULT_PRODUCT,
  NO_PRODUCT_TYPES,
  NO_SUBCATEGORIES,
  NO_SUPPLIERS,
  computeToBuy,
  canonicalSupplier,
  computeTotalPrice,
  effectivePrice,
  findDuplicateProduct,
  formatDate,
  formatMeters,
  formatPurchasedQuantity,
  orderRangeStatus,
  supplierOrderRange,
  orderRangeText,
  totalSpent,
  productMatchesSearch,
  parseSpools,
  planSpools,
  supplierMultiplier,
  purchasedUnits,
  unitsPerPurchase,
} from '../lib/calc'
import { convertPrice, DEFAULT_CURRENCY_RATES } from '../lib/currency'
import {
  acceptOrderRequest,
  addProduct,
  declineOrderRequest,
  deleteProduct,
  dismissPurchase,
  logCart,
  mergeOrderRequestIntoProduct,
  revertPurchase,
  updateProduct,
} from '../lib/actions'
import { rememberForm, withLastValues } from '../lib/formMemory'
import { downloadCSV } from '../lib/csv'
import { matchInvoiceLines, readInvoiceFile } from '../lib/invoiceImport'

// Label for products with no supplier in the export panel's supplier list.
const NO_SUPPLIER_LABEL = '(no supplier)'

export default function Orders() {
  const { team } = useAuth()
  const { data: products, loading } = useProducts(team?.id)
  const { data: requests } = useOrderRequests(team?.id)
  const { data: purchases } = usePurchases(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(DEFAULT_PRODUCT)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [subcategoryFilter, setSubcategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showBoughtForm, setShowBoughtForm] = useState(false)
  const [boughtSearch, setBoughtSearch] = useState('')
  const [boughtAllCategories, setBoughtAllCategories] = useState(false)
  // The purchase cart: [{ productId, quantity (text), spool }] - spool is set
  // for a line that comes from a planned spool, which carries its own price.
  const [cart, setCart] = useState([])
  const [cartPaid, setCartPaid] = useState('')
  // An imported order file: what was read, and the lines no product was found for.
  const [importStatus, setImportStatus] = useState(null)
  const [importUnmatched, setImportUnmatched] = useState([])
  // Empty selection = no restriction, so the export panel opens on "everything".
  const [showExport, setShowExport] = useState(false)
  const [exportCategories, setExportCategories] = useState([])
  const [exportSuppliers, setExportSuppliers] = useState([])

  const categories = team?.categories || []
  const subcategories = team?.subcategories || NO_SUBCATEGORIES
  const suppliers = team?.suppliers || NO_SUPPLIERS
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
        .filter((p) => !subcategoryFilter || p.subcategory === subcategoryFilter)
        .filter((p) => productMatchesSearch(p, search, { rates, preferred })),
    [products, categoryFilter, subcategoryFilter, search, rates, preferred]
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
        .filter((p) => !categoryFilter || p.category === categoryFilter)
        .filter((p) => !subcategoryFilter || p.subcategory === subcategoryFilter),
    [purchases, categoryFilter, subcategoryFilter]
  )
  // Money spent on the rows the Bought table is showing right now (same
  // category filter; discounts count as negative), plus everything ever
  // logged - dismissed rows included, as on the Bought items page.
  const visibleSpent = useMemo(() => totalSpent(visiblePurchases, rates, preferred), [visiblePurchases, rates, preferred])
  const allSpent = useMemo(() => totalSpent(purchases, rates, preferred), [purchases, rates, preferred])

  const filteredRequests = useMemo(
    () =>
      requests
        .filter((p) => !categoryFilter || p.category === categoryFilter)
        .filter((p) => !subcategoryFilter || p.subcategory === subcategoryFilter)
        .filter((p) => productMatchesSearch(p, search, { rates, preferred })),
    [requests, categoryFilter, subcategoryFilter, search, rates, preferred]
  )

  // A subcategory pick only means anything inside the category it belongs to.
  function handleCategoryFilter(category) {
    setCategoryFilter(category)
    setSubcategoryFilter('')
  }

  function startNew() {
    setEditingId(null)
    setForm(withLastValues('orders', DEFAULT_PRODUCT))
    setShowForm(true)
  }

  function startEdit(product) {
    setEditingId(product.id)
    // lentOut is owned by the Borrowing page (see loanInventoryDeltas) - left
    // out of the form so saving an edit can't write back a stale copy.
    const { id: _id, lentOut: _lentOut, ...fields } = product
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
    setCart([])
    setCartPaid('')
    setImportStatus(null)
    setImportUnmatched([])
    setBoughtSearch('')
    setBoughtAllCategories(false)
    setShowBoughtForm(true)
  }

  // Adding a product already in the cart just replaces that line.
  function addCartLines(lines) {
    const ids = new Set(lines.map((l) => l.productId))
    setCart((current) => [...current.filter((l) => !ids.has(l.productId)), ...lines])
  }

  // Picking a product adds it with what Orders says is still to buy (in
  // packs, for a pack-sized product type) as the quantity, since that's
  // usually exactly what was just bought.
  function selectBoughtProduct(id) {
    const product = products.find((p) => p.id === id)
    if (!product) return
    const toBuy = computeToBuy(product, productTypes).value
    addCartLines([{ productId: id, quantity: toBuy > 0 ? String(toBuy) : '1', spool: null }])
  }

  // An order confirmation or invoice (CSV) fills the cart: lines that
  // match a product are added, the rest wait below for a product to be picked,
  // and the order total becomes "actually paid" so the difference from the
  // listed prices shows up as the cart discrepancy.
  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportStatus({ text: 'Reading…' })
    try {
      const result = await readInvoiceFile(file)
      if (result.error || result.lines.length === 0) {
        setImportStatus({ error: result.error || 'No item lines were found in that file.' })
        return
      }
      const matches = matchInvoiceLines(result.lines, products)
      const byProduct = new Map()
      for (const m of matches.filter((x) => x.product)) {
        byProduct.set(m.product.id, (byProduct.get(m.product.id) || 0) + m.line.quantity)
      }
      addCartLines([...byProduct].map(([productId, quantity]) => ({ productId, quantity: String(quantity), spool: null })))
      setImportUnmatched(matches.filter((x) => !x.product).map((x, i) => ({ key: i, line: x.line })))
      let paidText = ''
      if (result.paid !== null && result.paid !== undefined) {
        const inPreferred =
          result.currency && result.currency !== preferred
            ? convertPrice(result.paid, result.currency, preferred, rates) ?? result.paid
            : result.paid
        setCartPaid(String(Math.round(inPreferred * 100) / 100))
        paidText = ` Order total ${result.paid} ${result.currency || preferred} is filled in as what you paid.`
      }
      setImportStatus({
        text: `Read ${result.lines.length} line${result.lines.length === 1 ? '' : 's'}: ${byProduct.size} matched to products${
          matches.some((x) => !x.product) ? `, ${matches.filter((x) => !x.product).length} need a product` : ''
        }.${paidText} Check the quantities before logging.`,
      })
    } catch {
      setImportStatus({ error: 'Could not read that file.' })
    }
  }

  function assignUnmatched(item, productId) {
    if (productId) addCartLines([{ productId, quantity: String(item.line.quantity), spool: null }])
    setImportUnmatched((rows) => rows.filter((r) => r.key !== item.key))
  }

  // Everything still to buy from one supplier, with a product's planned
  // spools standing in for the product itself.
  function addSupplierToCart(supplierKey) {
    const lines = exportLines
      .filter((l) => l.supplierKey === supplierKey && l.toBuy > 0 && !spoolMemberIds.has(l.product.id))
      .map((l) => ({ productId: l.product.id, quantity: String(l.toBuy), spool: null }))
    for (const sp of spoolPlans) {
      if (sp.plan && canonicalSupplier(sp.product.supplier, suppliers).toLowerCase() === supplierKey) {
        lines.push(...spoolCartLines(sp))
      }
    }
    addCartLines(lines)
  }

  // A planned set of spools as a cart line: the meters, at what the spools cost.
  function spoolCartLines(sp) {
    const length = Math.round(sp.plan.meters * 100) / 100
    return [
      {
        productId: sp.product.id,
        quantity: String(length),
        spool: { unitPrice: sp.plan.cost / length, currency: sp.product.currency || 'NIS', supplier: sp.product.supplier || '' },
      },
    ]
  }

  function addSpoolToCart(sp) {
    if (!showBoughtForm) openBoughtForm()
    addCartLines(spoolCartLines(sp))
  }

  const cartLines = cart
    .map((l) => {
      const product = products.find((p) => p.id === l.productId)
      if (!product) return null
      const quantity = Number(l.quantity) || 0
      const unitsPer = l.spool ? 1 : unitsPerPurchase(product, productTypes)
      const listed = l.spool ? l.spool.unitPrice : effectivePrice(product, suppliers)
      const unitPrice = Number.isFinite(listed) ? listed : 0
      const currency = l.spool ? l.spool.currency : product.currency || 'NIS'
      const supplier = l.spool ? l.spool.supplier : product.supplier || ''
      const cost = (convertPrice(unitPrice, currency, preferred, rates) ?? 0) * quantity
      return { key: l.productId, product, quantity, raw: l.quantity, unitsPer, unitPrice, currency, supplier, cost, spool: !!l.spool }
    })
    .filter(Boolean)
  const cartTotal = cartLines.reduce((sum, l) => sum + l.cost, 0)
  const cartPaidNumber = cartPaid.trim() === '' ? null : Number(cartPaid)
  const cartDiscrepancy = cartPaidNumber !== null && Number.isFinite(cartPaidNumber) ? cartPaidNumber - cartTotal : 0
  // Spools are bought by the meter; everything else by whole units or packs.
  // What was actually paid can't be negative (a blank field means "as listed").
  const cartPaidValid = cartPaidNumber === null || (Number.isFinite(cartPaidNumber) && cartPaidNumber >= 0)
  const cartValid =
    cartLines.length > 0 && cartPaidValid && cartLines.every((l) => l.quantity > 0 && (l.spool || Number.isInteger(l.quantity)))

  function setCartQuantity(productId, quantity) {
    setCart(cart.map((l) => (l.productId === productId ? { ...l, quantity } : l)))
  }

  function handleLogCart(e) {
    e.preventDefault()
    if (!cartValid) return
    const same = (values) => (new Set(values).size === 1 ? values[0] : '')
    const discrepancy =
      Math.abs(cartDiscrepancy) > 0.005
        ? {
            amount: cartDiscrepancy,
            currency: preferred,
            category: same(cartLines.map((l) => l.product.category || '')),
            supplier: same(cartLines.map((l) => l.supplier)),
          }
        : null
    logCart(team.id, cartLines, discrepancy)
    setShowBoughtForm(false)
  }

  // The product list in "Log a purchase": narrowed to whatever category/
  // subcategory filter Orders already has on (unless "all categories" is
  // ticked) and to the form's own search box, with what still needs buying
  // listed first.
  const boughtOptions = useMemo(() => {
    const pool = products
      .filter((p) => boughtAllCategories || !categoryFilter || p.category === categoryFilter)
      .filter((p) => boughtAllCategories || !subcategoryFilter || p.subcategory === subcategoryFilter)
      .filter((p) => productMatchesSearch(p, boughtSearch, { rates, preferred }))
    const needed = pool.filter((p) => computeToBuy(p, productTypes).value > 0)
    const rest = pool.filter((p) => !(computeToBuy(p, productTypes).value > 0))
    return { needed, rest }
  }, [products, productTypes, categoryFilter, subcategoryFilter, boughtAllCategories, boughtSearch, rates, preferred])

  async function handleDismissPurchase(purchase) {
    await dismissPurchase(team.id, purchase)
  }

  async function handleRevertPurchase(purchase) {
    if (!confirm(`Revert this purchase? ${purchasedUnits(purchase)} × ${purchase.productName} will come back out of stock.`)) return
    await revertPurchase(team.id, purchase)
  }

  // Everything the main table lists (to buy isn't 0), with the numbers the
  // export needs - deliberately not narrowed by the on-screen filters, so the
  // export panel's own choices are the only thing deciding what is in the file.
  // Suppliers are matched case-insensitively ("Scope" and "scope" are one
  // supplier) and shown under the spelling from Settings when there is one.
  const exportLines = useMemo(
    () =>
      products
        .filter((p) => computeToBuy(p, productTypes).value !== 0)
        .map((p) => {
          const price = effectivePrice(p, suppliers)
          const converted = convertPrice(price, p.currency, preferred, rates)
          const toBuy = computeToBuy(p, productTypes)
          const total = computeTotalPrice(p, productTypes, converted, toBuy.value)
          const supplier = canonicalSupplier(p.supplier, suppliers)
          return {
            product: p,
            price: converted !== null ? converted.toFixed(2) : price,
            toBuy: toBuy.value !== null ? toBuy.value : '',
            total: total.value !== null ? total.value : null,
            supplier,
            supplierKey: supplier.toLowerCase(),
            missingPrice: !(Number(price) > 0),
          }
        }),
    [products, productTypes, suppliers, rates, preferred]
  )

  const exportSupplierOptions = useMemo(() => {
    const byKey = new Map()
    for (const line of exportLines) if (!byKey.has(line.supplierKey)) byKey.set(line.supplierKey, line.supplier)
    return [...byKey]
      .map(([key, label]) => ({ key, label: label || NO_SUPPLIER_LABEL }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [exportLines])

  const exportSelection = useMemo(
    () =>
      exportLines.filter(
        (l) =>
          (exportCategories.length === 0 || exportCategories.includes(l.product.category)) &&
          (exportSuppliers.length === 0 || exportSuppliers.includes(l.supplierKey))
      ),
    [exportLines, exportCategories, exportSuppliers]
  )
  const exportStats = {
    count: exportSelection.length,
    total: exportSelection.reduce((sum, l) => sum + (l.total || 0), 0),
    missingPrice: exportSelection.filter((l) => l.missingPrice).length,
    missingSupplier: exportSelection.filter((l) => !l.supplierKey).length,
  }

  // Products with spool sizes (see the product form): the cheapest spools that
  // cover what still needs buying. A spool can't be split between shipments,
  // so one dearer than the supplier's per-shipment maximum is skipped.
  const spoolPlans = useMemo(
    () =>
      products.flatMap((product) => {
        const spools = parseSpools(product.spools)
        if (!spools.length) return []
        const need = Math.max(0, Number(computeToBuy(product, productTypes).value) || 0)
        if (need <= 0) return []
        const multiplier = supplierMultiplier(product.supplier, suppliers)
        const priced = spools.map((sp) => ({ ...sp, price: sp.price * multiplier }))
        const range = supplierOrderRange(canonicalSupplier(product.supplier, suppliers), suppliers)
        const maxPrice = range?.max ? convertPrice(range.max, range.currency, preferred, rates) : null
        const priceOf = (sp) => convertPrice(sp.price, product.currency, preferred, rates) ?? sp.price
        const tooDear = maxPrice ? priced.filter((sp) => priceOf(sp) > maxPrice + 0.005) : []
        const plan = planSpools(need, priced.filter((sp) => !tooDear.includes(sp)))
        const cost = plan ? (convertPrice(plan.cost, product.currency, preferred, rates) ?? plan.cost) : 0
        return [{ key: product.id, product, members: [product], need, plan, cost, tooDear, maxPrice }]
      }),
    [products, productTypes, suppliers, preferred, rates]
  )
  const spoolMemberIds = new Set(spoolPlans.filter((sp) => sp.plan).flatMap((sp) => sp.members.map((m) => m.id)))

  // Where each ranged supplier's order stands, for the notes under the page
  // toolbar (everything still to buy) and in the export panel (just what is
  // picked). Items only - shipping isn't part of the range. `extras` are
  // [{ supplier, total }] added on top of the lines (the planned spools).
  // When a single shipment is short of its minimum, `hint` names the cheapest
  // spool that would lift it into range.
  function rangeNotes(lines, extras = []) {
    const totals = new Map()
    for (const l of lines) totals.set(l.supplier, (totals.get(l.supplier) || 0) + (l.total || 0))
    for (const e of extras) totals.set(e.supplier, (totals.get(e.supplier) || 0) + e.total)
    return [...totals]
      .map(([supplier, total]) => {
        const status = orderRangeStatus(supplier, total, suppliers, rates, preferred)
        if (!status) return null
        let hint = ''
        if (status.state === 'below' && status.orders === 1) {
          let cheapest = null
          for (const p of products) {
            if (canonicalSupplier(p.supplier, suppliers).toLowerCase() !== supplier.toLowerCase()) continue
            for (const sp of parseSpools(p.spools)) {
              const listed = sp.price * supplierMultiplier(p.supplier, suppliers)
              const price = convertPrice(listed, p.currency, preferred, rates) ?? listed
              const after = total + price
              if (after < status.min || (status.max && after > status.max)) continue
              if (!cheapest || price < cheapest.price) cheapest = { p, sp, price, after }
            }
          }
          if (cheapest) {
            hint = ` Adding one ${formatMeters(cheapest.sp.meters)} spool of ${cheapest.p.name} (${Math.round(cheapest.price)} ${preferred}, extra stock) would bring it to ${Math.round(cheapest.after)} ${preferred}.`
          }
        }
        return { supplier, status, text: orderRangeText(status, total, preferred) + hint }
      })
      .filter(Boolean)
  }
  const pageRangeNotes = rangeNotes(
    exportLines.filter((l) => !spoolMemberIds.has(l.product.id)),
    spoolPlans
      .filter((sp) => sp.plan)
      .map((sp) => ({ supplier: canonicalSupplier(sp.product.supplier, suppliers), total: sp.cost }))
  )
  const exportRangeNotes = rangeNotes(exportSelection)

  function openExport() {
    setExportCategories(categoryFilter ? [categoryFilter] : [])
    setExportSuppliers([])
    setShowExport(true)
  }

  function toggleIn(list, setList, value) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function downloadLines(lines, fileParts) {
    const headers = ['Name', 'SKU', 'Category', 'Price', 'Supplier', 'To buy', 'Total']
    const rows = lines.map((l) => [
      l.product.name,
      l.product.sku,
      l.product.category,
      l.price,
      l.supplier,
      l.toBuy,
      l.total !== null ? l.total.toFixed(2) : '',
    ])
    const name = ['orders', ...fileParts].join('-').replace(/[\\/:*?"<>|\s]+/g, '-')
    downloadCSV(`${name}.csv`, headers, rows)
  }

  const optionLabel = (key) => exportSupplierOptions.find((o) => o.key === key)?.label ?? key

  function handleExport(e) {
    e.preventDefault()
    if (exportSelection.length === 0) return
    downloadLines(exportSelection, [...exportCategories, ...exportSuppliers.map(optionLabel)])
    setShowExport(false)
  }

  // One file per supplier, spaced out a little so the browser doesn't treat the
  // burst of downloads as spam and block all but the first.
  function handleExportPerSupplier() {
    const groups = new Map()
    for (const line of exportSelection) {
      if (!groups.has(line.supplierKey)) groups.set(line.supplierKey, [])
      groups.get(line.supplierKey).push(line)
    }
    ;[...groups].forEach(([key, lines], i) => {
      setTimeout(() => downloadLines(lines, [key ? optionLabel(key) : 'no-supplier']), i * 400)
    })
    setShowExport(false)
  }

  if (loading) return <div className="page-loading">Loading orders…</div>

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-header">
          <h1>Orders</h1>
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={openExport}>
              Export CSV
            </button>
            <button onClick={startNew}>+ Add product</button>
          </div>
        </div>

        {pageRangeNotes.map((n) => (
          <p
            key={n.supplier}
            className={n.status.state === 'in' ? 'muted' : ''}
            style={{ margin: '0 0 6px', color: n.status.state === 'in' ? undefined : 'var(--danger)' }}
          >
            <strong>{n.supplier}</strong>: {n.text}
          </p>
        ))}

        <ProductFilters
          products={products}
          categories={categories}
          categoryFilter={categoryFilter}
          onCategoryFilter={handleCategoryFilter}
          subcategories={subcategories}
          subcategoryFilter={subcategoryFilter}
          onSubcategoryFilter={setSubcategoryFilter}
          search={search}
          onSearch={setSearch}
        />
      </div>

      {spoolPlans.length > 0 && (
        <details open className="card" style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer' }}>
            <strong>Spools to buy</strong>
            <span className="muted">
              {' '}
              · {spoolPlans.length} product{spoolPlans.length === 1 ? '' : 's'} ·{' '}
              {Math.round(spoolPlans.reduce((sum, sp) => sum + sp.cost, 0))} {preferred}
            </span>
          </summary>
          {spoolPlans.map((sp) => (
            <div key={sp.key} style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong>{sp.product.name}</strong>
                {sp.plan ? (
                  <>
                    <span>{sp.plan.counts.map((c) => `${c.count} × ${formatMeters(c.meters)}`).join(' + ')}</span>
                    <span className="muted">
                      {formatMeters(sp.plan.meters)} for need of {formatMeters(sp.need)} · {Math.round(sp.cost)} {preferred}
                    </span>
                    <button type="button" className="secondary" style={{ fontSize: 13, padding: '3px 10px', marginLeft: 'auto' }} onClick={() => addSpoolToCart(sp)}>
                      Add to cart
                    </button>
                  </>
                ) : (
                  <span className="muted">no spool fits the {Math.round(sp.maxPrice)} {preferred} shipment maximum</span>
                )}
              </div>
              {sp.plan && sp.tooDear.length > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  skipped over the {Math.round(sp.maxPrice)} {preferred} maximum: {sp.tooDear.map((x) => formatMeters(x.meters)).join(', ')}
                </div>
              )}
            </div>
          ))}
        </details>
      )}

      <ProductForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        editing={!!editingId}
        categories={categories}
        subcategories={subcategories}
        suppliers={suppliers}
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
        showConsumable={false}
        showToBuy
        showTotal
      />

      <div className="page-header">
        <h2>Bought</h2>
        <div className="page-header-actions">
          <Link to="/orders/purchases" className="secondary">
            View all bought items
          </Link>
          <button type="button" className="secondary" onClick={openBoughtForm}>
            + Log a purchase
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        Logged by hand - each one restocks the product and counts toward its category's spend on the
        dashboard. Dismiss just hides a row here; revert undoes it entirely.
      </p>
      <p style={{ marginTop: -4 }}>
        <strong>
          Spent so far: {allSpent.toFixed(2)} {preferred}
        </strong>
        {Math.abs(allSpent - visibleSpent) > 0.005 && (
          <span className="muted">
            {' '}
            (the table total below covers only the rows shown - {categoryFilter ? 'this category, ' : ''}dismissed rows
            hidden)
          </span>
        )}
      </p>
      <DataTable
        columns={[
          { key: 'date', header: 'Date', nowrap: true, cell: (p) => formatDate(p.date), footerCell: () => <strong>Total</strong> },
          { key: 'product', header: 'Product', sticky: 'left', cell: (p) => p.productName },
          { key: 'category', header: 'Category', cellClassName: 'muted', cell: (p) => p.category || 'Uncategorized' },
          { key: 'quantity', header: 'Quantity', cell: (p) => formatPurchasedQuantity(p) },
          {
            key: 'cost',
            header: 'Cost',
            cell: (p) => {
              const converted = convertPrice(p.unitPrice, p.currency, preferred, rates)
              const cost = converted !== null ? converted * p.quantity : null
              return cost !== null ? `${cost.toFixed(2)} ${preferred}` : '—'
            },
            footerCell: () => (
              <strong>
                {visibleSpent.toFixed(2)} {preferred}
              </strong>
            ),
          },
          {
            key: 'actions',
            header: '',
            sticky: 'right',
            cell: (p) => (
              <div className="row-actions">
                <button className="link-btn" onClick={() => handleDismissPurchase(p)}>
                  Dismiss
                </button>
                <button className="link-btn danger" onClick={() => handleRevertPurchase(p)}>
                  Revert
                </button>
              </div>
            ),
          },
        ]}
        rows={visiblePurchases}
        footer
      />

      <FormPanel open={showExport} onClose={() => setShowExport(false)} onSubmit={handleExport}>
        <h2>Export CSV</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Products that still need buying. Pick categories and/or suppliers to narrow the file; leave a group empty
          to include all of it.
        </p>
        <div className="form-grid">
          <div className="span-2">
            <strong>Categories</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`chip ${exportCategories.includes(c) ? 'active' : ''}`}
                  onClick={() => toggleIn(exportCategories, setExportCategories, c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="span-2">
            <strong>Suppliers</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {exportSupplierOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`chip ${exportSuppliers.includes(o.key) ? 'active' : ''}`}
                  onClick={() => toggleIn(exportSuppliers, setExportSuppliers, o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <p className="span-2" style={{ margin: 0 }}>
            <strong>{exportStats.count}</strong> item{exportStats.count === 1 ? '' : 's'}, total{' '}
            <strong>{exportStats.total.toFixed(2)}</strong> {preferred}
          </p>
          {exportRangeNotes.map((n) => (
            <p
              key={n.supplier}
              className="span-2"
              style={{ margin: 0, color: n.status.state === 'in' ? undefined : 'var(--danger)' }}
            >
              <strong>{n.supplier}</strong>: {n.text}
            </p>
          ))}
          {(exportStats.missingPrice > 0 || exportStats.missingSupplier > 0) && (
            <p className="muted span-2" style={{ margin: 0 }}>
              Needs attention: {exportStats.missingPrice} without a price (blank Total, not in the total above),{' '}
              {exportStats.missingSupplier} without a supplier.
            </p>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowExport(false)}>
            Cancel
          </button>
          <button type="button" className="secondary" disabled={exportStats.count === 0} onClick={handleExportPerSupplier}>
            One file per supplier
          </button>
          <button type="submit" disabled={exportStats.count === 0}>
            Export
          </button>
        </div>
      </FormPanel>

      <FormPanel open={showBoughtForm} onClose={() => setShowBoughtForm(false)} onSubmit={handleLogCart}>
        <h2>Log a purchase</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Everything bought in one order. Add the items, check the quantities, and enter what you really paid to
          log any difference as one discrepancy.
        </p>
        <div className="form-grid">
          {exportSupplierOptions.length > 0 && (
            <div className="span-2">
              <span className="muted" style={{ fontSize: 13 }}>Add everything still to buy from</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {exportSupplierOptions.map((o) => (
                  <button key={o.key} type="button" className="chip" onClick={() => addSupplierToCart(o.key)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="span-2">
            <label className="secondary" style={{ display: 'inline-block', cursor: 'pointer', padding: '6px 12px' }}>
              Import from an order CSV
              <input type="file" accept=".csv,text/csv" onChange={handleImportFile} style={{ display: 'none' }} />
            </label>
            {importStatus && (
              <p className="muted" style={{ margin: '6px 0 0', color: importStatus.error ? 'var(--danger)' : undefined }}>
                {importStatus.error || importStatus.text}
              </p>
            )}
            {importUnmatched.map((item) => (
              <div key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  {item.line.name || item.line.sku} <span className="muted">× {item.line.quantity}</span>
                </span>
                <select value="" onChange={(e) => assignUnmatched(item, e.target.value)} aria-label="Product for this line" style={{ width: 200 }}>
                  <option value="">Pick a product…</option>
                  {[...products]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                </select>
                <button type="button" className="link-btn danger" onClick={() => assignUnmatched(item, '')} aria-label="Skip this line">
                  Skip
                </button>
              </div>
            ))}
          </div>
          <label className="span-2">
            Add a product
            <input
              type="search"
              value={boughtSearch}
              onChange={(e) => setBoughtSearch(e.target.value)}
              placeholder="Search by name, SKU, supplier…"
            />
          </label>
          {categoryFilter && (
            <label className="span-2 checkbox-field">
              <input
                type="checkbox"
                checked={boughtAllCategories}
                onChange={(e) => setBoughtAllCategories(e.target.checked)}
              />
              Show all categories (now showing only {subcategoryFilter || categoryFilter})
            </label>
          )}
          <select className="span-2" value="" onChange={(e) => selectBoughtProduct(e.target.value)} aria-label="Product to add">
            <option value="" disabled>
              {boughtOptions.needed.length + boughtOptions.rest.length === 0 ? 'No matching products' : 'Choose a product to add…'}
            </option>
            {boughtOptions.needed.length > 0 && (
              <optgroup label="Still to buy">
                {boughtOptions.needed.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({computeToBuy(p, productTypes).value})
                  </option>
                ))}
              </optgroup>
            )}
            {boughtOptions.rest.length > 0 && (
              <optgroup label="Everything else">
                {boughtOptions.rest.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="span-2" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cartLines.length === 0 && <span className="muted">Nothing in the cart yet.</span>}
            {cartLines.map((l) => (
              <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {l.product.name}
                  {l.unitsPer > 1 && (
                    <span className="muted"> · packs of {l.unitsPer} (+{l.quantity * l.unitsPer} to stock)</span>
                  )}
                  {l.spool && <span className="muted"> · meters</span>}
                </span>
                <input
                  type="number"
                  min="0"
                  step={l.spool ? 'any' : '1'}
                  value={l.raw}
                  onChange={(e) => setCartQuantity(l.key, e.target.value)}
                  aria-label={`Quantity of ${l.product.name}`}
                  style={{ width: 80 }}
                />
                <span style={{ width: 84, textAlign: 'right' }}>{l.cost.toFixed(2)}</span>
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={() => setCart(cart.filter((x) => x.productId !== l.key))}
                  aria-label={`Remove ${l.product.name}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {cartLines.length > 0 && (
            <>
              <p className="span-2" style={{ margin: 0 }}>
                Items add up to <strong>{cartTotal.toFixed(2)}</strong> {preferred}
              </p>
              <label>
                Actually paid ({preferred}, optional)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cartPaid}
                  onChange={(e) => setCartPaid(e.target.value)}
                  placeholder={cartTotal.toFixed(2)}
                />
              </label>
              {Math.abs(cartDiscrepancy) > 0.005 && (
                <p className="muted span-2" style={{ margin: 0 }}>
                  Logged as one extra line, "Cart discrepancy": {cartDiscrepancy > 0 ? '+' : ''}
                  {cartDiscrepancy.toFixed(2)} {preferred}.
                </p>
              )}
            </>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowBoughtForm(false)}>
            Cancel
          </button>
          <button type="submit" disabled={!cartValid}>
            Log {cartLines.length > 1 ? `cart (${cartLines.length} items)` : 'purchase'}
          </button>
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
        showConsumable={false}
        showToBuy
        showTotal
        showRequestedBy
        emptyMessage="No pending requests."
      />
    </div>
  )
}
