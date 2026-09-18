import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import StickyTableScroll from '../components/StickyTableScroll'
import { usePurchases } from '../lib/firestore-hooks'
import { todayISO, totalSpent } from '../lib/calc'
import { convertPrice, DEFAULT_CURRENCY_RATES } from '../lib/currency'
import { logFakePurchase, revertPurchase } from '../lib/actions'

const emptyForm = { productName: '', category: '', quantity: '1', unitPrice: '', currency: 'NIS', date: '' }

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

  const categories = team?.categories || []
  const rates = team?.currencyRates || DEFAULT_CURRENCY_RATES
  const preferred = team?.preferredCurrency || 'NIS'
  const currencyCodes = Object.keys(rates)

  const total = useMemo(() => totalSpent(purchases, rates, preferred), [purchases, rates, preferred])

  function openForm() {
    setForm({ ...emptyForm, currency: preferred, date: todayISO() })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    logFakePurchase(team.id, {
      productName: form.productName.trim(),
      category: form.category,
      quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
      unitPrice: Number(form.unitPrice) || 0,
      currency: form.currency,
      date: form.date || todayISO(),
    })
    setShowForm(false)
  }

  async function handleRemove(purchase) {
    const message = purchase.productId
      ? `Remove this purchase? ${purchase.quantity} × ${purchase.productName} will come back out of stock.`
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
        <button onClick={openForm}>+ Add a manual expense</button>
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
        <h2>Add a manual expense</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          For money spent on something that isn't a real product and doesn't need to become one - it
          won't touch Inventory or Orders, it only adds to the total paid here and on the dashboard.
        </p>
        <div className="form-grid">
          <label className="span-2">
            What for
            <input
              value={form.productName}
              onChange={(e) => setForm({ ...form, productName: e.target.value })}
              placeholder="e.g. Competition registration fee"
              required
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
          <label>
            Unit price
            <input
              type="number"
              min="0"
              step="0.01"
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

      <StickyTableScroll>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Category</th>
              <th>Quantity</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => {
              const converted = convertPrice(p.unitPrice, p.currency, preferred, rates)
              const cost = converted !== null ? converted * p.quantity : null
              return (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>
                    {p.productName}
                    {!p.productId && <span className="muted"> (manual)</span>}
                  </td>
                  <td className="muted">{p.category || 'Uncategorized'}</td>
                  <td>{p.quantity}</td>
                  <td>{cost !== null ? `${cost.toFixed(2)} ${preferred}` : '—'}</td>
                  <td>
                    <button className="link-btn danger" onClick={() => handleRemove(p)}>
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
            {purchases.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  Nothing logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StickyTableScroll>
    </div>
  )
}
