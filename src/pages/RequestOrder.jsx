import { useEffect, useState } from 'react'
import { addDoc, collection } from 'firebase/firestore'
import { communityDb } from '../firebase'
import { DEFAULT_PRODUCT } from '../lib/calc'
import { useStudentAuth } from '../context/StudentAuthContext'
import ProductForm from '../components/ProductForm'

// A StudentLayout tab - sign-in (including which student this is) already
// happened at /student-login (see StudentAuthContext), so `verified`/
// `student` already have everything this needs (students, categories,
// product types, currencies). Submitting doesn't create a product directly
// - it drops a request in teams/{teamId}/orderRequests for an admin to
// accept or decline from the Orders page.
export default function RequestOrder() {
  const { verified, student } = useStudentAuth()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(DEFAULT_PRODUCT)
  const [error, setError] = useState('')
  const [justSubmitted, setJustSubmitted] = useState(false)

  useEffect(() => {
    document.title = 'AttendX | Request Order'
  }, [])

  function startNew() {
    setForm(DEFAULT_PRODUCT)
    setJustSubmitted(false)
    setError('')
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      const payload = {
        ...form,
        price: Number(form.price) || 0,
        countInInventory: 0,
        wantedCount: Number(form.wantedCount) || 0,
        requestedBy: student?.fullName || '',
        requestedAt: new Date().toISOString().slice(0, 10),
      }
      await addDoc(collection(communityDb, 'teams', verified.teamId, 'orderRequests'), payload)
      setShowForm(false)
      setJustSubmitted(true)
    } catch {
      setError('Something went wrong submitting that - please try again.')
    }
  }

  return (
    <div className="page">
      <h1>Request a product</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
        {justSubmitted && <p className="muted">Requested! An admin will review it. You can request another below.</p>}
        {error && <p className="form-error">{error}</p>}
        <button type="button" onClick={startNew}>
          + Request product
        </button>
      </div>

      <ProductForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmit}
        form={form}
        setForm={setForm}
        editing={false}
        countField="wantedCount"
        countLabel="Wanted count"
        categories={verified.categories}
        currencyCodes={verified.currencyCodes}
        productTypes={verified.productTypes}
      />
    </div>
  )
}
