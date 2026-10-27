import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import DataTable from '../components/DataTable'
import TeamNumberInput from '../components/TeamNumberInput'
import { useEvents, useLoans, useProducts, useStudents, useSystems } from '../lib/firestore-hooks'
import {
  DEFAULT_LOAN,
  availableForProduct,
  formatDate,
  isLoanOpen,
  isLoanOverdue,
  loanInventoryDeltas,
  loanStockEffectFor,
  todayISO,
  usedQuantitiesByProduct,
} from '../lib/calc'
import { addLoan, deleteLoan, updateLoan } from '../lib/actions'
import { downloadCSV } from '../lib/csv'

const CONTACT_ROLES = ['Student', 'Captain', 'Mentor']

// Parts going to and coming from other FRC teams during build season and
// competitions. Admin only (no student-side tab, and firestore.rules gives
// student access nothing under loans). Lending one of our own products
// holds it the same way a system's claim does - see loanInventoryDeltas in
// calc.js - while borrowed parts never enter inventory at all.
export default function Borrowing() {
  const { team } = useAuth()
  const { data: loans, loading } = useLoans(team?.id)
  const { data: products } = useProducts(team?.id)
  const { data: systems } = useSystems(team?.id)
  const { data: students } = useStudents(team)
  const { data: events } = useEvents(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [editingLoan, setEditingLoan] = useState(null)
  const [form, setForm] = useState(DEFAULT_LOAN)
  const [search, setSearch] = useState('')

  const today = todayISO()
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const studentName = (id) => students.find((s) => s.id === id)?.fullName || ''
  const usedQuantities = useMemo(() => usedQuantitiesByProduct(systems), [systems])

  const theyOweUs = loans.filter((l) => l.direction === 'lent' && isLoanOpen(l))
  const weOweThem = loans.filter((l) => l.direction === 'borrowed' && isLoanOpen(l))
  const overdueCount = loans.filter((l) => isLoanOverdue(l, today)).length
  const history = useMemo(() => {
    const q = search.trim().toLowerCase()
    return loans
      .filter((l) => !isLoanOpen(l))
      .filter(
        (l) =>
          !q ||
          [l.itemName, l.teamNumber, l.teamName, l.contactName, l.event, l.notes].some((v) =>
            String(v || '').toLowerCase().includes(q)
          )
      )
      .sort((a, b) => (b.returnedOn || '').localeCompare(a.returnedOn || ''))
  }, [loans, search])

  // How many of a product are free to lend right now. While editing an
  // open loan of that same product, its own hold is added back so it
  // doesn't count against itself (same idea as Systems' excludeSystemId).
  function availableToLend(productId) {
    const product = productById.get(productId)
    if (!product) return null
    let available = availableForProduct(product, usedQuantities)
    if (editingLoan && isLoanOpen(editingLoan) && editingLoan.productId === productId && editingLoan.stockEffect) {
      available += Number(editingLoan.quantity) || 0
    }
    return available
  }

  function startNew(direction) {
    setEditingLoan(null)
    setForm({ ...DEFAULT_LOAN, direction, lentOn: today })
    setShowForm(true)
  }

  function startEdit(loan) {
    setEditingLoan(loan)
    const { id: _id, ...fields } = loan
    setForm({ ...DEFAULT_LOAN, ...fields })
    setShowForm(true)
  }

  function buildPayload() {
    const product = form.direction === 'lent' && form.productId ? productById.get(form.productId) : null
    const sameProduct = editingLoan && editingLoan.productId === form.productId && editingLoan.stockEffect
    return {
      ...form,
      productId: product ? product.id : '',
      itemName: product ? product.name : form.itemName.trim(),
      quantity: Number(form.quantity) || 1,
      teamName: form.teamName.trim(),
      contactName: form.contactName.trim(),
      contactRole: form.contactRole.trim(),
      contactPhone: form.contactPhone.trim(),
      event: form.event.trim(),
      notes: form.notes.trim(),
      lentOn: form.lentOn || today,
      stockEffect: product ? (sameProduct ? editingLoan.stockEffect : loanStockEffectFor(product)) : '',
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const payload = buildPayload()
    if (payload.productId && isLoanOpen(payload)) {
      const available = availableToLend(payload.productId)
      if (available !== null && payload.quantity > available) {
        const ok = confirm(
          `Only ${Math.max(available, 0)} ${payload.itemName} available - lending ${payload.quantity} puts you ${payload.quantity - available} short. Lend anyway?`
        )
        if (!ok) return
      }
    }
    const inventoryDeltas = loanInventoryDeltas(editingLoan, payload, products)
    if (editingLoan) {
      updateLoan(team.id, editingLoan.id, payload, inventoryDeltas)
    } else {
      addLoan(team.id, payload, inventoryDeltas)
    }
    setShowForm(false)
  }

  async function handleReturned(loan) {
    const updated = { ...loan, returnedOn: today }
    const { id: _id, ...fields } = updated
    const label = loan.direction === 'lent' ? `Got back ${loan.quantity}× "${loan.itemName}" from` : `Returned ${loan.quantity}× "${loan.itemName}" to`
    await updateLoan(team.id, loan.id, fields, loanInventoryDeltas(loan, updated, products), `${label} team ${loan.teamNumber}`)
  }

  async function handleReopen(loan) {
    const updated = { ...loan, returnedOn: '' }
    const { id: _id, ...fields } = updated
    await updateLoan(team.id, loan.id, fields, loanInventoryDeltas(loan, updated, products), `Marked ${loan.quantity}× "${loan.itemName}" as not returned yet`)
  }

  async function handleDelete(loan) {
    const warning = isLoanOpen(loan) && loan.stockEffect ? ' Its stock goes back into Inventory.' : ''
    if (!confirm(`Delete this loan?${warning}`)) return
    await deleteLoan(team.id, loan, loanInventoryDeltas(loan, null, products))
  }

  function handleExport() {
    const headers = [
      'Direction',
      'Item',
      'Quantity',
      'Team number',
      'Team name',
      'Contact',
      'Contact role',
      'Contact phone',
      'Handled by',
      'Event',
      'Out on',
      'Due',
      'Returned on',
      'Notes',
    ]
    const rows = loans.map((l) => [
      l.direction === 'lent' ? 'Lent' : 'Borrowed',
      l.itemName,
      l.quantity,
      l.teamNumber,
      l.teamName,
      l.contactName,
      l.contactRole,
      l.contactPhone,
      studentName(l.studentId),
      l.event,
      l.lentOn,
      l.dueDate,
      l.returnedOn,
      l.notes,
    ])
    downloadCSV('borrowing.csv', headers, rows)
  }

  const teamCell = (l) => (
    <span>
      <strong>{l.teamNumber}</strong>
      {l.teamName && <span className="muted"> {l.teamName}</span>}
    </span>
  )

  const contactCell = (l) =>
    l.contactName || l.contactPhone ? (
      <span>
        {l.contactName}
        {l.contactRole && <span className="muted"> ({l.contactRole})</span>}
        {l.contactPhone && (
          <>
            {l.contactName && <br />}
            <a href={`tel:${l.contactPhone.replace(/[^\d+]/g, '')}`}>{l.contactPhone}</a>
          </>
        )}
      </span>
    ) : (
      '—'
    )

  const dueCell = (l) =>
    !l.dueDate ? (
      '—'
    ) : isLoanOverdue(l, today) ? (
      <span className="badge badge-danger">Overdue · {formatDate(l.dueDate)}</span>
    ) : (
      formatDate(l.dueDate)
    )

  const openColumns = [
    { key: 'item', header: 'Item', sticky: 'left', minWidth: 160, cell: (l) => l.itemName },
    { key: 'qty', header: 'Qty', align: 'center', cell: (l) => l.quantity },
    { key: 'team', header: 'Team', nowrap: true, cell: teamCell },
    { key: 'contact', header: 'Contact', cell: contactCell },
    { key: 'out', header: 'Out since', nowrap: true, cell: (l) => formatDate(l.lentOn) },
    { key: 'due', header: 'Due back', nowrap: true, cell: dueCell },
    { key: 'event', header: 'Event', cell: (l) => l.event || '—' },
    { key: 'student', header: 'Handled by', cell: (l) => studentName(l.studentId) || '—' },
    {
      key: 'notes',
      header: 'Notes',
      spread: true,
      cellClassName: 'muted',
      cell: (l) => l.notes || '',
    },
    {
      key: 'actions',
      header: '',
      sticky: 'right',
      nowrap: true,
      cell: (l) => (
        <div className="row-actions">
          <button className="link-btn" onClick={() => handleReturned(l)}>
            Returned
          </button>
          <button className="link-btn" onClick={() => startEdit(l)}>
            Edit
          </button>
          <button className="link-btn danger" onClick={() => handleDelete(l)}>
            Delete
          </button>
        </div>
      ),
    },
  ]

  const historyColumns = [
    { key: 'item', header: 'Item', sticky: 'left', minWidth: 160, cell: (l) => l.itemName },
    { key: 'direction', header: '', nowrap: true, cell: (l) => (l.direction === 'lent' ? 'Lent to' : 'Borrowed from') },
    { key: 'qty', header: 'Qty', align: 'center', cell: (l) => l.quantity },
    { key: 'team', header: 'Team', nowrap: true, cell: teamCell },
    { key: 'out', header: 'Out on', nowrap: true, cell: (l) => formatDate(l.lentOn) },
    { key: 'returned', header: 'Returned', nowrap: true, cell: (l) => formatDate(l.returnedOn) },
    { key: 'event', header: 'Event', cell: (l) => l.event || '—' },
    { key: 'notes', header: 'Notes', spread: true, cellClassName: 'muted', cell: (l) => l.notes || '' },
    {
      key: 'actions',
      header: '',
      sticky: 'right',
      nowrap: true,
      cell: (l) => (
        <div className="row-actions">
          <button className="link-btn" onClick={() => handleReopen(l)}>
            Not returned
          </button>
          <button className="link-btn" onClick={() => startEdit(l)}>
            Edit
          </button>
          <button className="link-btn danger" onClick={() => handleDelete(l)}>
            Delete
          </button>
        </div>
      ),
    },
  ]

  if (loading) return <div className="page-loading">Loading loans…</div>

  const lending = form.direction === 'lent'
  const fromInventory = lending && form.productId
  const formAvailable = fromInventory ? availableToLend(form.productId) : null

  return (
    <div className="page">
      <div className="page-header">
        <h1>Borrowing</h1>
        <div className="page-header-actions">
          <button type="button" className="secondary" onClick={handleExport}>
            Export CSV
          </button>
          <button type="button" className="secondary" onClick={() => startNew('borrowed')}>
            + We borrowed
          </button>
          <button onClick={() => startNew('lent')}>+ We lent</button>
        </div>
      </div>

      <div className="stat-cards">
        <div className="card stat-card">
          <span className="stat-label">They owe us</span>
          <span className="stat-value">{theyOweUs.length}</span>
          <span className="muted">open loans to other teams</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">We owe them</span>
          <span className="stat-value">{weOweThem.length}</span>
          <span className="muted">borrowed, not returned yet</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Overdue</span>
          <span className="stat-value" style={overdueCount ? { color: 'var(--danger)' } : undefined}>
            {overdueCount}
          </span>
          <span className="muted">past their due date</span>
        </div>
      </div>

      <h2>They owe us</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Our parts out with other teams.
      </p>
      <DataTable columns={openColumns} rows={theyOweUs} emptyMessage="Nothing lent out right now." />

      <h2 style={{ marginTop: 32 }}>We owe them</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Other teams' parts we still have to give back.
      </p>
      <DataTable columns={openColumns} rows={weOweThem} emptyMessage="Nothing borrowed right now." />

      <div className="page-header" style={{ marginTop: 32 }}>
        <h2 style={{ margin: 0 }}>History</h2>
        <input
          type="search"
          placeholder="Search item, team, contact, event…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>
      <DataTable columns={historyColumns} rows={history} emptyMessage="No returned loans yet." />

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingLoan ? 'Edit loan' : lending ? 'Lend to another team' : 'Borrow from another team'}</h2>
        <div className="form-grid">
          <label className="span-2">
            Direction
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} required>
              <option value="lent">We lent it to another team</option>
              <option value="borrowed">We borrowed it from another team</option>
            </select>
          </label>

          {lending && (
            <label className="span-2">
              From our inventory
              <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">Not in inventory - type a name below</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({availableToLend(p.id)} available)
                  </option>
                ))}
              </select>
            </label>
          )}

          {!fromInventory && (
            <label className="span-2">
              Item
              <input
                value={form.itemName}
                onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                placeholder="e.g. Kraken X60"
                required
              />
            </label>
          )}

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
            {formAvailable !== null && (
              <span className="muted">
                {formAvailable} available
                {productById.get(form.productId)?.consumable ? ' (consumable - comes off stock)' : ''}
              </span>
            )}
          </label>
          <label>
            Team number
            <TeamNumberInput value={form.teamNumber} onChange={(teamNumber) => setForm({ ...form, teamNumber })} />
          </label>

          <label>
            Team name <span className="muted">(optional)</span>
            <input value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })} />
          </label>
          <label>
            Event <span className="muted">(optional)</span>
            <input list="borrowing-events" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} />
            <datalist id="borrowing-events">
              {events.map((ev) => (
                <option key={ev.id} value={ev.name} />
              ))}
            </datalist>
          </label>

          <label>
            Contact name <span className="muted">(optional)</span>
            <input
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              placeholder="Who to call about it"
            />
          </label>
          <label>
            Contact role <span className="muted">(optional)</span>
            <input
              list="borrowing-contact-roles"
              value={form.contactRole}
              onChange={(e) => setForm({ ...form, contactRole: e.target.value })}
              placeholder="Student, Captain, Mentor…"
            />
            <datalist id="borrowing-contact-roles">
              {CONTACT_ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <label>
            Contact phone <span className="muted">(optional)</span>
            <input
              type="tel"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            />
          </label>
          <label>
            Handled by <span className="muted">(optional)</span>
            <select value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
              <option value="">—</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>

          <label>
            {lending ? 'Lent on' : 'Borrowed on'}
            <input type="date" value={form.lentOn} onChange={(e) => setForm({ ...form, lentOn: e.target.value })} />
          </label>
          <label>
            Due back <span className="muted">(optional)</span>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </label>

          {editingLoan && (
            <label>
              Returned on <span className="muted">(blank = still out)</span>
              <input
                type="date"
                value={form.returnedOn}
                onChange={(e) => setForm({ ...form, returnedOn: e.target.value })}
              />
            </label>
          )}

          <label className="span-2">
            Notes <span className="muted">(optional)</span>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingLoan ? 'Save' : 'Add'}</button>
        </div>
      </FormPanel>
    </div>
  )
}
