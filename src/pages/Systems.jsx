import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import StickyTableScroll from '../components/StickyTableScroll'
import NeedsTable from '../components/NeedsTable'
import { useProducts, useStudents, useSystems } from '../lib/firestore-hooks'
import {
  DEFAULT_SYSTEM,
  availableForProduct,
  consumableInventoryDeltas,
  overallocatedNeeds,
  usedQuantitiesByProduct,
} from '../lib/calc'
import { addSystem, deleteSystem, updateProduct, updateSystem } from '../lib/actions'
import { downloadCSV } from '../lib/csv'

export default function Systems() {
  const { team } = useAuth()
  const { data: students } = useStudents(team)
  const { data: products } = useProducts(team?.id)
  const { data: systems, loading } = useSystems(team?.id)
  const [showForm, setShowForm] = useState(false)
  const [editingSystem, setEditingSystem] = useState(null)
  const [form, setForm] = useState(DEFAULT_SYSTEM)

  const categories = team?.categories || []
  const consumableCategories = team?.consumableCategories || []
  const editingId = editingSystem?.id ?? null
  const studentName = (id) => students.find((s) => s.id === id)?.fullName || 'Unknown student'

  const sortedSystems = useMemo(
    () =>
      [...systems].sort(
        (a, b) => studentName(a.studentId).localeCompare(studentName(b.studentId)) || a.name.localeCompare(b.name)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [systems, students]
  )

  // Excludes the system currently open for editing so its own existing
  // claim doesn't count against itself - see usedQuantitiesByProduct.
  const usedQuantities = useMemo(() => usedQuantitiesByProduct(systems, editingId), [systems, editingId])

  function startNew() {
    setEditingSystem(null)
    setForm(DEFAULT_SYSTEM)
    setShowForm(true)
  }

  function startEdit(system) {
    setEditingSystem(system)
    setForm({ studentId: system.studentId, name: system.name, needs: system.needs || [] })
    setShowForm(true)
  }

  // Unlike the student side (MySystems), an admin already has full write
  // access to products - so "request an order" here just bumps the real
  // wantedCount directly, the same field Orders' to-buy math reads, rather
  // than going through orderRequests for someone else to review.
  async function handleRequestOrder(product, shortfall) {
    await updateProduct(team.id, product.id, { wantedCount: (product.wantedCount || 0) + shortfall })
  }

  // Checked here, at the Add/Save button, rather than per-field on blur -
  // see the comment in NeedsTable.jsx for why that was skippable by
  // pressing Enter. Confirming a product's shortfall bumps its wanted count
  // for the difference; declining just skips that request - the need itself
  // stays exactly what was entered (a system can still claim more than
  // what's available, same as before this prompt existed at all), so
  // declining doesn't silently shrink what the system actually needs.
  async function handleSubmit(e) {
    e.preventDefault()
    for (const { product, max, shortfall } of overallocatedNeeds(form.needs, products, usedQuantities, consumableCategories)) {
      const ok = confirm(
        `Only ${max} ${product.name} available - this needs ${shortfall} more than that. Automatically request an order for the difference?`
      )
      if (ok) await handleRequestOrder(product, shortfall)
    }
    const payload = { name: form.name.trim(), studentId: form.studentId, needs: form.needs }
    const inventoryDeltas = consumableInventoryDeltas(editingSystem?.needs, form.needs, products, consumableCategories)
    if (editingId) {
      updateSystem(team.id, editingId, payload, inventoryDeltas)
    } else {
      addSystem(team.id, payload, inventoryDeltas)
    }
    setShowForm(false)
  }

  async function handleDelete(system) {
    if (!confirm('Delete this system?')) return
    const inventoryDeltas = consumableInventoryDeltas(system.needs, [], products, consumableCategories)
    await deleteSystem(team.id, system, inventoryDeltas)
  }

  // Product, category, quantity, and what was available at export time
  // (excluding this system's own claim, same as editing it does) - the same
  // columns NeedsTable itself shows.
  function handleExportSystem(system) {
    const used = usedQuantitiesByProduct(systems, system.id)
    const headers = ['Product', 'Category', 'Quantity', 'Available']
    const rows = (system.needs || []).map((n) => {
      const product = products.find((p) => p.id === n.productId)
      const available = product ? availableForProduct(product, used, consumableCategories) : ''
      return [product?.name || 'Unknown product', product?.category || '', n.quantity, available]
    })
    downloadCSV(`${system.name || 'system'}.csv`, headers, rows)
  }

  if (loading) return <div className="page-loading">Loading systems…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>Systems</h1>
        <button onClick={startNew}>+ Add system</button>
      </div>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit system' : 'New system'}</h2>
        <div className="form-grid">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Student
            <select
              value={form.studentId}
              onChange={(e) => setForm({ ...form, studentId: e.target.value })}
              required
            >
              <option value="" disabled>
                Choose…
              </option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <NeedsTable
          products={products}
          categories={categories}
          needs={form.needs}
          usedQuantities={usedQuantities}
          consumableCategories={consumableCategories}
          onChange={(needs) => setForm({ ...form, needs })}
        />
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingId ? 'Save' : 'Add'}</button>
        </div>
      </FormPanel>

      <StickyTableScroll>
        <table className="data-table">
          <thead>
            <tr>
              <th>System</th>
              <th>Student</th>
              <th>Needs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedSystems.map((system) => (
              <tr key={system.id}>
                <td>{system.name}</td>
                <td>{studentName(system.studentId)}</td>
                <td className="muted">
                  {(system.needs || [])
                    .map((n) => `${products.find((p) => p.id === n.productId)?.name || 'Unknown'} ×${n.quantity}`)
                    .join(', ') || '—'}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="link-btn" onClick={() => startEdit(system)}>
                      Edit
                    </button>
                    <button className="link-btn" onClick={() => handleExportSystem(system)}>
                      Export CSV
                    </button>
                    <button className="link-btn danger" onClick={() => handleDelete(system)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sortedSystems.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No systems yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StickyTableScroll>
    </div>
  )
}
