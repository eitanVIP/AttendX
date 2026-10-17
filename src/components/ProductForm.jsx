import FormPanel from './FormPanel'
import { NO_SUPPLIERS, supplierMultiplier } from '../lib/calc'
import { isReservedFieldName } from '../lib/formula'

// Shared by Inventory and Orders. Both counts are always shown on either
// page - the product is the same doc either way (see DEFAULT_PRODUCT in
// calc.js), so Inventory can set how many are wanted and Orders can set how
// many are already in stock without switching pages.
export default function ProductForm({
  open,
  onClose,
  onSubmit,
  form,
  setForm,
  editing,
  categories,
  subcategories = {},
  suppliers = NO_SUPPLIERS,
  currencyCodes,
  productTypes,
}) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const multiplier = supplierMultiplier(form.supplier, suppliers)

  // Subcategories belong to one category each, so switching category drops
  // the old pick rather than leaving a subcategory the new category doesn't
  // have. The dropdown only appears when the chosen category has any.
  const categorySubs = subcategories[form.category] || []
  function setCategory(e) {
    setForm({ ...form, category: e.target.value, subcategory: '' })
  }

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
          <select value={form.category} onChange={setCategory} required>
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
        {categorySubs.length > 0 && (
          <label>
            Subcategory (optional)
            <select value={form.subcategory || ''} onChange={set('subcategory')}>
              <option value="">None</option>
              {categorySubs.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Price
          {/* step="any": "0.01" made the browser reject submission past 2 decimals - rounding is display-only (ProductTable). */}
          <input type="number" min="0" step="any" value={form.price} onChange={set('price')} required />
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
          <select value={form.supplier || ''} onChange={set('supplier')}>
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {Number(s.multiplier) > 0 && Number(s.multiplier) !== 1 ? ` (×${Number(s.multiplier)})` : ''}
              </option>
            ))}
            {/* A product saved before suppliers became a list (or with a since-removed one) keeps its old name selectable. */}
            {form.supplier && !suppliers.some((s) => s.name === form.supplier) && (
              <option value={form.supplier}>{form.supplier} (not in list)</option>
            )}
          </select>
          {multiplier !== 1 && (
            <span className="muted" style={{ fontSize: 12 }}>
              Price above is the listed one - ×{multiplier} is added automatically.
            </span>
          )}
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
        <label>
          Count in inventory
          <input type="number" min="0" step="any" value={form.countInInventory} onChange={set('countInInventory')} />
        </label>
        <label>
          Wanted count
          <input type="number" min="0" step="any" value={form.wantedCount} onChange={set('wantedCount')} />
        </label>
        <label className="span-2 checkbox-field">
          <input
            type="checkbox"
            checked={!!form.consumable}
            onChange={(e) => setForm({ ...form, consumable: e.target.checked })}
          />
          Consumable - claiming it on a system actually uses it up (glue, zip ties, sheet stock), lowering
          this count in inventory. Leave off for reusable parts (motors, sensors), which stay in stock and
          are only reserved against.
        </label>
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
