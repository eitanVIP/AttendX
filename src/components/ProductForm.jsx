import FormPanel from './FormPanel'
import { isReservedFieldName } from '../lib/formula'

// Shared by Inventory and Orders. Adding a product only asks for the one
// count relevant to whichever page you're on (`countField`/`countLabel`) -
// the other side of it defaults to 0 via DEFAULT_PRODUCT in calc.js, which
// is what makes the two pages two views of the same doc instead of separate
// ones. Editing shows both counts, since by then the product already
// exists on both pages and either might need correcting.
export default function ProductForm({
  open,
  onClose,
  onSubmit,
  form,
  setForm,
  editing,
  countField,
  countLabel,
  categories,
  currencyCodes,
  productTypes,
}) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  // The selected type lives entirely in customData.type - there's no
  // separate "productType" field on the product itself (see hasCustomData
  // in calc.js). Switching types resets the other customData keys rather
  // than keeping them, since a different type's fields rarely mean the
  // same thing even when a name happens to match.
  const selectedType = productTypes.find((t) => t.name === form.customData?.type)

  // Only the type's name is stored - its formulas (if it has any) are
  // looked up live from Settings' productTypes wherever they're used (see
  // computeToBuy/computeTotalPrice in calc.js), not copied onto the
  // product, so editing a formula later changes every product of that
  // type at once instead of just new ones.
  function setProductType(name) {
    setForm({ ...form, customData: name ? { type: name } : {} })
  }

  function setCustomField(field, value) {
    setForm({ ...form, customData: { ...form.customData, [field]: value } })
  }

  return (
    <FormPanel open={open} onClose={onClose} onSubmit={onSubmit}>
      <h2>{editing ? 'Edit product' : 'New product'}</h2>
      <div className="form-grid">
        <label className="span-2">
          Name
          <input value={form.name} onChange={set('name')} required />
        </label>
        <label>
          SKU
          <input value={form.sku} onChange={set('sku')} />
        </label>
        <label>
          Category
          <select value={form.category} onChange={set('category')} required>
            <option value="" disabled>
              {categories.length ? 'Choose…' : 'Set up categories in Settings first'}
            </option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Price
          <input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required />
        </label>
        <label>
          Currency
          <select value={form.currency} onChange={set('currency')}>
            {currencyCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supplier
          <input value={form.supplier} onChange={set('supplier')} />
        </label>
        <label className="span-2">
          Link
          <input type="url" value={form.link} onChange={set('link')} placeholder="https://…" />
        </label>
        <label className="span-2">
          Notes
          <input value={form.notes} onChange={set('notes')} />
        </label>
        {productTypes.length > 0 && (
          <label className="span-2">
            Product type (optional)
            <select value={form.customData?.type || ''} onChange={(e) => setProductType(e.target.value)}>
              <option value="">None</option>
              {productTypes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedType && selectedType.fields.length > 0 && (
          <div className="span-2">
            <span className="field-label">{selectedType.name} details</span>
            <div className="form-grid" style={{ margin: '4px 0 0' }}>
              {selectedType.fields.filter((field) => !isReservedFieldName(field)).map((field) => (
                <label key={field}>
                  {field}
                  <input value={form.customData?.[field] || ''} onChange={(e) => setCustomField(field, e.target.value)} />
                </label>
              ))}
            </div>
          </div>
        )}
        {editing ? (
          <>
            <label>
              Count in inventory
              <input type="number" min="0" step="any" value={form.countInInventory} onChange={set('countInInventory')} />
            </label>
            <label>
              Wanted count
              <input type="number" min="0" step="any" value={form.wantedCount} onChange={set('wantedCount')} />
            </label>
          </>
        ) : (
          <label>
            {countLabel}
            <input type="number" min="0" step="any" value={form[countField]} onChange={set(countField)} />
          </label>
        )}
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">{editing ? 'Save' : 'Add product'}</button>
      </div>
    </FormPanel>
  )
}
