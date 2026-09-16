import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { communityDb } from '../firebase'
import { useStudentAuth } from '../context/StudentAuthContext'
import { DEFAULT_SYSTEM, usedQuantitiesByProduct } from '../lib/calc'
import FormPanel from '../components/FormPanel'
import NeedsTable from '../components/NeedsTable'

// A StudentLayout tab - sign-in (including which student this is) already
// happened at /student-login (see StudentAuthContext). Products and every
// student's systems are both live-listened (not one-time fetches like
// CommunityHours/RequestOrder use) because "how much of this product is
// still available" depends on what everyone else's systems claim, and that
// can change while this page is open.
export default function MySystems() {
  const { verified, studentId, student } = useStudentAuth()
  const [products, setProducts] = useState([])
  const [systems, setSystems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(DEFAULT_SYSTEM)

  useEffect(() => {
    document.title = 'AttendX | My Systems'
  }, [])

  useEffect(() => {
    const unsubProducts = onSnapshot(collection(communityDb, 'teams', verified.teamId, 'products'), (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    const unsubSystems = onSnapshot(collection(communityDb, 'teams', verified.teamId, 'systems'), (snap) => {
      setSystems(snap.docs.map((d) => ({ needs: [], id: d.id, ...d.data() })))
      setLoading(false)
    })
    return () => {
      unsubProducts()
      unsubSystems()
    }
  }, [verified.teamId])

  const mySystems = useMemo(() => systems.filter((s) => s.studentId === studentId), [systems, studentId])
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

  async function handleSubmit(e) {
    e.preventDefault()
    const payload = { studentId, name: form.name.trim(), needs: form.needs }
    if (editingId) {
      await updateDoc(doc(communityDb, 'teams', verified.teamId, 'systems', editingId), payload)
    } else {
      await addDoc(collection(communityDb, 'teams', verified.teamId, 'systems'), payload)
    }
    setShowForm(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this system?')) return
    await deleteDoc(doc(communityDb, 'teams', verified.teamId, 'systems', id))
  }

  // Students can't write to products directly (see firestore.rules), so
  // "request an order" here means the same thing the Request Order tab
  // does: drop a doc in orderRequests for an admin to review. Since the
  // product already exists, an admin accepting it will hit the existing
  // duplicate-name prompt on Orders and fold the shortfall into its real
  // wantedCount instead of creating a second product.
  async function handleRequestOrder(product, shortfall) {
    const { id: _id, ...rest } = product
    await addDoc(collection(communityDb, 'teams', verified.teamId, 'orderRequests'), {
      ...rest,
      countInInventory: 0,
      wantedCount: shortfall,
      requestedBy: student?.fullName || '',
      requestedAt: new Date().toISOString().slice(0, 10),
    })
  }

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Systems</h1>
        <button onClick={startNew}>+ New system</button>
      </div>
      <p className="muted">
        Track what inventory each of your systems needs - "Available" already accounts for what your
        other systems, and everyone else's, have already claimed. You can still claim more than what's
        available; you'll be offered to automatically request an order for the difference.
      </p>

      <FormPanel open={showForm} onClose={() => setShowForm(false)} onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit system' : 'New system'}</h2>
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Shooting mechanism"
            required
          />
        </label>
        <NeedsTable
          products={products}
          categories={verified.categories}
          needs={form.needs}
          usedQuantities={usedQuantities}
          onChange={(needs) => setForm({ ...form, needs })}
          onRequestOrder={handleRequestOrder}
        />
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit">{editingId ? 'Save' : 'Create'}</button>
        </div>
      </FormPanel>

      {mySystems.length === 0 && <p className="muted">No systems yet.</p>}
      {mySystems.map((system) => (
        <SystemCard
          key={system.id}
          system={system}
          products={products}
          onEdit={() => startEdit(system)}
          onDelete={() => handleDelete(system.id)}
        />
      ))}
    </div>
  )
}

function SystemCard({ system, products, onEdit, onDelete }) {
  const rows = (system.needs || []).map((n) => ({ ...n, product: products.find((p) => p.id === n.productId) }))
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0 }}>{system.name}</h3>
        <div className="row-actions">
          <button type="button" className="link-btn" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="link-btn danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No inventory needs added yet.</p>
      ) : (
        <ul className="checklist">
          {rows.map((r) => (
            <li key={r.productId}>
              {r.product?.name || 'Unknown product'} × {r.quantity}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
