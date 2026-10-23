import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import DataTable from '../components/DataTable'
import { usePurchases } from '../lib/firestore-hooks'
import { formatDate, formatPurchasedQuantity, purchasedUnits, todayISO, totalSpent } from '../lib/calc'
import { convertPrice, DEFAULT_CURRENCY_RATES } from '../lib/currency'
import { logFakePurchase, revertPurchase } from '../lib/actions'

const emptyForm = { productName: '', category: '', quantity: '1', unitPrice: '', currency: 'NIS', date: '', supplier: '' }

// Every purchase ever logged (see logPurchase/logFakePurchase in actions.js)
// - not just what's currently visible in Orders' own Bought table, which
// hides dismissed rows and whatever the category filter excludes. Dismissed
// purchases still count toward spend (dismissing only hides a row on
// Orders), so they still show here. "Remove" is revertPurchase - it deletes
// the record and, for a real product, gives back the stock it added.
export default function PurchaseLog() {
  const { team } = useAuth()
  const { data: purchases, loading } = usePurchases(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  // The same form does three jobs: 'expense' (a manual expense), 'discount'
  // (money taken off an order - one amount, stored as a negative expense) and
  // 'shipping' (shipping paid on an order). The latter two are tied to a
  // supplier so the dashboard can total them per supplier.
  const [kind, setKind] = useState('expense')
  const isDiscount = kind === 'discount'
  const isShipping = kind === 'shipping'

  const categories = team?.categories || []
  const suppliers = team?.suppliers || []
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const currencyCodes = Object.keys(rates)

  const total = useMemo(() => totalSpent(purchases, rates, preferred), [purchases, rates, preferred])

  function openForm(nextKind) {
    setKind(nextKind)
    setForm({ ...emptyForm, currency: preferred, date: todayISO() })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const amount = Math.abs(Number(form.unitPrice) || 0)
    if (isDiscount || isShipping) {
      const label = isDiscount ? 'Discount' : 'Shipping'
      logFakePurchase(team.id, {
        productName: form.productName.trim() || (form.supplier ? `${label} from ${form.supplier}` : label),
        category: form.category,
        supplier: form.supplier,
        quantity: 1,
        unitPrice: isDiscount ? -amount : amount,
        currency: form.currency,
        date: form.date || todayISO(),
        discount: isDiscount,
        shipping: isShipping,
      })
    } else {
      logFakePurchase(team.id, {
        productName: form.productName.trim(),
        category: form.category,
        supplier: form.supplier,
        quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
        unitPrice: amount,
        currency: form.currency,
        date: form.date || todayISO(),
      })
    }
    setShowForm(false)
  }

  async function handleRemove(purchase) {
    const message = purchase.productId
      ? `Remove this purchase? ${purchasedUnits(purchase)} × ${purchase.productName} will come back out of stock.`
      : `Remove this entry? It'll come off the total paid below.`
    if (!confirm(message)) return
    await revertPurchase(team.id, purchase)
  }

  if (loading) return <div className="page-loading">Loading bought items…</div>

  return (
    <div className="page">
      <Link to="/orders" className="back-link">
        ← Orders
      </Link>
      <div className="page-header">
        <div>
          <h1>Bought items</h1>
          <p className="muted" style={{ marginTop: -12 }}>
            Every logged purchase and manual expense, including ones dismissed from Orders' Bought table
            - dismissing only hides a row there, the money still counts here and on the dashboard.
          </p>
        </div>
        <div className="page-header-actions">
          <button className="secondary" onClick={() => openForm('shipping')}>
            + Add shipping
          </button>
          <button className="secondary" onClick={() => openForm('discount')}>
            + Add a discount
          </button>
          <button onClick={() => openForm('expense')}>+ Add a manual expense</button>
        </div>
      </div>

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">Total paid</span>
          <span className="stat-value">
            {total.toFixed(2)} {preferred}
          </span>
          <span className="muted">
            {purchases.length} entr{purchases.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
      </div>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{isDiscount ? 'Add a discount' : isShipping ? 'Add shipping' : 'Add a manual expense'}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {isShipping
            ? 'Shipping paid on an order - pick the supplier it came from so the dashboard can show what each supplier really costs. It adds to the total paid here and on the dashboard.'
            : isDiscount
            ? 'For money taken off an order you already logged at full price - e.g. an order that came to 2575 but you paid 2000: enter 575. It comes off the total paid here and on the dashboard (and off the category you pick), without changing any product.'
            : "For money spent on something that isn't a real product and doesn't need to become one - it won't touch Inventory or Orders, it only adds to the total paid here and on the dashboard."}
        </p>
        <div className="form-grid">
          {(isDiscount || isShipping) && (
            <label>
              From supplier (optional)
              <select value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={isDiscount || isShipping ? undefined : 'span-2'}>
            {isDiscount || isShipping ? 'Description (optional)' : 'What for'}
            <input
              value={form.productName}
              onChange={(e) => setForm({ ...form, productName: e.target.value })}
              placeholder={
                isDiscount || isShipping
                  ? form.supplier
                    ? `${isDiscount ? 'Discount' : 'Shipping'} from ${form.supplier}`
                    : isDiscount
                      ? 'e.g. Discount on the screws order'
                      : 'e.g. Shipping on the screws order'
                  : 'e.g. Competition registration fee'
              }
              required={kind === 'expense'}
            />
          </label>
          <label>
            Category (optional)
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </label>
          {kind === 'expense' && (
            <label>
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                required
              />
            </label>
          )}
          <label>
            {isDiscount ? 'Discount amount' : isShipping ? 'Shipping cost' : 'Unit price'}
            <input
              type="number"
              min="0"
              step="any"
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
              required
            />
          </label>
          <label>
            Currency
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {currencyCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">Add</button>
        </div>
      </FormPanel>

      <DataTable
        columns={[
          { key: 'date', header: 'Date', nowrap: true, cell: (p) => formatDate(p.date) },
          {
            key: 'item',
            header: 'Item',
            sticky: 'left',
            cell: (p) => (
              <>
                {p.productName}
                {!p.productId && <span className="muted"> ({p.discount ? 'discount' : p.shipping ? 'shipping' : 'manual'})</span>}
              </>
            ),
          },
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
          },
          {
            key: 'actions',
            header: '',
            sticky: 'right',
            cell: (p) => (
              <button className="link-btn danger" onClick={() => handleRemove(p)}>
                Remove
              </button>
            ),
          },
        ]}
        rows={purchases}
        emptyMessage="Nothing logged yet."
      />
    </div>
  )
}
