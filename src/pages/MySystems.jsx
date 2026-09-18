import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, increment, onSnapshot, writeBatch } from 'firebase/firestore'
import { communityDb } from '../firebase'
import { useStudentAuth } from '../context/StudentAuthContext'
import { DEFAULT_SYSTEM, consumableInventoryDeltas, overallocatedNeeds, usedQuantitiesByProduct } from '../lib/calc'
import { logStudentChange } from '../lib/communityLog'
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
  const [editingSystem, setEditingSystem] = useState(null)
  const [form, setForm] = useState(DEFAULT_SYSTEM)
  const editingId = editingSystem?.id ?? null

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
    setEditingSystem(null)
    setForm(DEFAULT_SYSTEM)
    setShowForm(true)
  }

  function startEdit(system) {
    setEditingSystem(system)
    setForm({ studentId: system.studentId, name: system.name, needs: system.needs || [] })
    setShowForm(true)
  }

  // Applies every consumable-category product's real stock change (see
  // consumableInventoryDeltas in calc.js) in the same batch as the system
  // write itself, so a claim on a consumable and that product's actual
  // stock can never end up out of sync - students can only write
  // `countInInventory` on a product (see firestore.rules), never anything
  // else about it.
  async function commitSystemWrite(systemRef, payload, isNew, inventoryDeltas) {
    const batch = writeBatch(communityDb)
    if (isNew) batch.set(systemRef, payload)
    else batch.update(systemRef, payload)
    for (const { productId, delta } of inventoryDeltas) {
      batch.update(doc(communityDb, 'teams', verified.teamId, 'products', productId), {
        countInInventory: increment(-delta),
      })
    }
    await batch.commit()
  }

  // Checked here, at the Create/Save button, rather than per-field on blur
  // - see the comment in NeedsTable.jsx for why that was skippable by
  // pressing Enter. Confirming a product's shortfall requests an order for
  // the difference; declining just skips that request - the need itself
  // stays exactly what was entered.
  async function handleSubmit(e) {
    e.preventDefault()
    for (const { product, max, shortfall } of overallocatedNeeds(
      form.needs,
      products,
      usedQuantities,
      verified.consumableCategories
    )) {
      const ok = confirm(
        `Only ${max} ${product.name} available - this needs ${shortfall} more than that. Automatically request an order for the difference?`
      )
      if (ok) await handleRequestOrder(product, shortfall)
    }
    const payload = { studentId, name: form.name.trim(), needs: form.needs }
    const inventoryDeltas = consumableInventoryDeltas(editingSystem?.needs, form.needs, products, verified.consumableCategories)
    if (editingId) {
      await commitSystemWrite(doc(communityDb, 'teams', verified.teamId, 'systems', editingId), payload, false, inventoryDeltas)
      await logStudentChange(verified.teamId, 'system', 'update', `Updated system "${payload.name}"`, student?.fullName)
    } else {
      await commitSystemWrite(doc(collection(communityDb, 'teams', verified.teamId, 'systems')), payload, true, inventoryDeltas)
      await logStudentChange(verified.teamId, 'system', 'create', `Created system "${payload.name}"`, student?.fullName)
    }
    setShowForm(false)
  }

  async function handleDelete(system) {
    if (!confirm('Delete this system?')) return
    const inventoryDeltas = consumableInventoryDeltas(system.needs, [], products, verified.consumableCategories)
    const batch = writeBatch(communityDb)
    batch.delete(doc(communityDb, 'teams', verified.teamId, 'systems', system.id))
    for (const { productId, delta } of inventoryDeltas) {
      batch.update(doc(communityDb, 'teams', verified.teamId, 'products', productId), { countInInventory: increment(-delta) })
    }
    await batch.commit()
    await logStudentChange(verified.teamId, 'system', 'delete', `Deleted system "${system.name}"`, student?.fullName)
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
    await logStudentChange(
      verified.teamId,
      'orderRequest',
      'create',
      `Requested order for "${product.name}" ×${shortfall}`,
      student?.fullName
    )
  }

  if (loading) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Systems</h1>
        <button onClick={startNew}>+ New system</button>
      </div>

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
          consumableCategories={verified.consumableCategories}
          onChange={(needs) => setForm({ ...form, needs })}
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
          onDelete={() => handleDelete(system)}
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
