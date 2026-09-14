import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import FormPanel from '../components/FormPanel'
import StickyTableScroll from '../components/StickyTableScroll'
import NeedsTable from '../components/NeedsTable'
import { useProducts, useStudents, useSystems } from '../lib/firestore-hooks'
import { DEFAULT_SYSTEM, boughtFlagChanges, usedQuantitiesByProduct } from '../lib/calc'
import { addSystem, deleteSystem, updateProduct, updateSystem } from '../lib/actions'

export default function Systems() {
  const { team } = useAuth()
  const { data: students } = useStudents(team)
  const { data: products } = useProducts(team?.id)
  const { data: systems, loading } = useSystems(team?.id)
  const productTypes = team?.productTypes || []
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(DEFAULT_SYSTEM)

  const categories = team?.categories || []
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
    setEditingId(null)
    setForm(DEFAULT_SYSTEM)
    setShowForm(true)
  }

  function startEdit(system) {
    setEditingId(system.id)
    setForm({ studentId: system.studentId, name: system.name, needs: system.needs || [] })
    setShowForm(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const payload = { name: form.name.trim(), studentId: form.studentId, needs: form.needs }
    if (editingId) {
      updateSystem(team.id, editingId, payload)
    } else {
      addSystem(team.id, payload)
    }
    setShowForm(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this system?')) return
    await deleteSystem(team.id, id)
  }

  // Unlike the student side (MySystems), an admin already has full write
  // access to products - so "request an order" here just bumps the real
  // wantedCount directly, the same field Orders' to-buy math reads, rather
  // than going through orderRequests for someone else to review.
  async function handleRequestOrder(product, shortfall) {
    const updated = { ...product, wantedCount: (product.wantedCount || 0) + shortfall }
    await updateProduct(team.id, product.id, {
      wantedCount: updated.wantedCount,
      ...boughtFlagChanges(product, updated, productTypes),
    })
  }

  if (loading) return <div className="page-loading">Loading systems…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>Systems</h1>
        <button onClick={startNew}>+ Add system</button>
      </div>
      <p className="muted">
        What each student is building and the inventory it claims - "Available" already excludes every
        other system's own claim on the same item. A system can still claim more than what's available;
        you'll be offered to bump the product's wanted count for the difference.
      </p>

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
          onChange={(needs) => setForm({ ...form, needs })}
          onRequestOrder={handleRequestOrder}
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
                    <button className="link-btn danger" onClick={() => handleDelete(system.id)}>
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
