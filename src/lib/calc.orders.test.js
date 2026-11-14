import { describe, expect, it } from 'vitest'
import {
  availableForProduct,
  budgetRemainingSlices,
  canonicalSupplier,
  computeToBuy,
  computeTotalPrice,
  consumableInventoryDeltas,
  effectivePrice,
  findDuplicateProduct,
  formatMeters,
  formatPurchasedQuantity,
  isLoanOverdue,
  loanInventoryDeltas,
  normalizeProduct,
  oldPackPurchases,
  orderRangeStatus,
  orderRangeText,
  overallocatedNeeds,
  parseSpools,
  planSpools,
  plannedSpendByCategory,
  productMatchesSearch,
  purchasedUnits,
  spentByCategory,
  supplierBudgetRows,
  supplierMultiplier,
  supplierShipping,
  toBuyCostByCategory,
  toBuyCount,
  totalBudget,
  totalSpent,
  totalToBuyCost,
  unitsPerPurchase,
  usedQuantitiesByProduct,
} from './calc'

const rates = { USD: 1, NIS: 3.7 }

// --- to buy ----------------------------------------------------------------

describe('toBuyCount', () => {
  it('is wanted minus stock, never negative', () => {
    expect(toBuyCount({ wantedCount: 10, countInInventory: 4 })).toBe(6)
    expect(toBuyCount({ wantedCount: 3, countInInventory: 9 })).toBe(0)
    expect(toBuyCount({})).toBe(0)
  })

  it('rounds a fractional shortfall up to a whole unit', () => {
    expect(toBuyCount({ wantedCount: 5, countInInventory: 2.8 })).toBe(3)
  })
})

describe('computeToBuy', () => {
  const bolts = { name: 'Bolts', toBuyFormula: 'ceil(wanted / int(custom.PackSize))' }
  const product = (extra = {}) => ({ wantedCount: 120, countInInventory: 0, customData: { type: 'Bolts', PackSize: '50' }, ...extra })

  it('uses the plain math for a product with no type', () => {
    expect(computeToBuy({ wantedCount: 8, countInInventory: 3 }, [bolts])).toEqual({ value: 5, error: null })
  })

  it("uses the type's formula, looked up live by type name", () => {
    expect(computeToBuy(product(), [bolts]).value).toBe(3)
    expect(computeToBuy(product(), [{ ...bolts, toBuyFormula: 'wanted' }]).value).toBe(120)
  })

  it('always rounds a formula result up to a whole number', () => {
    expect(computeToBuy(product(), [{ name: 'Bolts', toBuyFormula: 'wanted / 7' }]).value).toBe(18)
  })

  it('falls back to the plain math when the type is gone or has no formula', () => {
    expect(computeToBuy(product(), []).value).toBe(120)
    expect(computeToBuy(product(), [{ name: 'Bolts' }]).value).toBe(120)
  })

  it('reports a broken formula instead of throwing', () => {
    const result = computeToBuy(product(), [{ name: 'Bolts', toBuyFormula: 'wanted +' }])
    expect(result.value).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('hides the "type" key from formulas', () => {
    const result = computeToBuy(product(), [{ name: 'Bolts', toBuyFormula: 'custom.type' }])
    expect(result.value).toBeNull()
  })
})

// --- pack sizes (bought in batches) -----------------------------------------

describe('unitsPerPurchase', () => {
  const types = [{ name: 'Bolts', packSizeField: 'Order batch' }, { name: 'Plain' }]
  const bolt = (batch) => ({ customData: { type: 'Bolts', 'Order batch': batch } })

  it('is the value of the type\'s pack size field', () => {
    expect(unitsPerPurchase(bolt('50'), types)).toBe(50)
    expect(unitsPerPurchase(bolt(100), types)).toBe(100)
    expect(unitsPerPurchase(bolt('2.5'), types)).toBe(2.5)
  })

  it('is 1 when the type has no pack size field linked', () => {
    expect(unitsPerPurchase({ customData: { type: 'Plain', 'Order batch': '50' } }, types)).toBe(1)
  })

  it('is 1 for a missing, zero, negative or non-numeric value', () => {
    expect(unitsPerPurchase({ customData: { type: 'Bolts' } }, types)).toBe(1)
    expect(unitsPerPurchase(bolt('0'), types)).toBe(1)
    expect(unitsPerPurchase(bolt('-5'), types)).toBe(1)
    expect(unitsPerPurchase(bolt('abc'), types)).toBe(1)
  })

  it('is 1 for a product with no type, or whose type was removed', () => {
    expect(unitsPerPurchase({ customData: {} }, types)).toBe(1)
    expect(unitsPerPurchase({}, types)).toBe(1)
    expect(unitsPerPurchase(bolt('50'), [])).toBe(1)
  })
})

describe('purchased quantities', () => {
  it('multiplies packs by the pack size', () => {
    expect(purchasedUnits({ quantity: 4, unitsPerPurchase: 50 })).toBe(200)
    expect(purchasedUnits({ quantity: 4 })).toBe(4)
    expect(purchasedUnits({})).toBe(0)
  })

  it('shows packs as "200 (4 × 50)" and plain purchases as just the number', () => {
    expect(formatPurchasedQuantity({ quantity: 4, unitsPerPurchase: 50 })).toBe('200 (4 × 50)')
    expect(formatPurchasedQuantity({ quantity: 4, unitsPerPurchase: 1 })).toBe('4')
    expect(formatPurchasedQuantity({ quantity: 4 })).toBe('4')
    expect(formatPurchasedQuantity({ discount: true, quantity: 1 })).toBe('—')
    expect(formatPurchasedQuantity({ shipping: true, quantity: 1 })).toBe('—')
  })
})

describe('oldPackPurchases (purchases logged before the pack size was linked)', () => {
  const types = [{ name: 'Bolts', packSizeField: 'Order batch' }]
  const products = [
    { id: 'bolt', customData: { type: 'Bolts', 'Order batch': '50' } },
    { id: 'single', customData: {} },
  ]

  it('lists a purchase with no recorded pack size for a product that now has one', () => {
    const purchase = { id: 'p1', productId: 'bolt', quantity: 4 }
    expect(oldPackPurchases([purchase], products, types)).toEqual([{ purchase, product: products[0], packSize: 50 }])
  })

  it('stops listing a purchase once its pack size is recorded (what "Already fixed" does)', () => {
    expect(oldPackPurchases([{ id: 'p1', productId: 'bolt', quantity: 4, unitsPerPurchase: 50 }], products, types)).toEqual([])
  })

  it('ignores manual expenses, single-unit products and deleted products', () => {
    const purchases = [
      { id: 'a', productId: '', quantity: 1 },
      { id: 'b', productId: 'single', quantity: 2 },
      { id: 'c', productId: 'gone', quantity: 2 },
    ]
    expect(oldPackPurchases(purchases, products, types)).toEqual([])
  })
})

describe('computeTotalPrice', () => {
  it('is price × to buy by default', () => {
    expect(computeTotalPrice({}, [], 12.5, 4)).toEqual({ value: 50, error: null })
  })

  it('is null while the price or to-buy is unknown', () => {
    expect(computeTotalPrice({}, [], null, 4).value).toBeNull()
    expect(computeTotalPrice({}, [], 5, null).value).toBeNull()
  })

  it("uses the type's total price formula with tobuy and convertedprice", () => {
    const type = { name: 'Sheet', totalPriceFormula: 'convertedprice * tobuy + 10' }
    const product = { customData: { type: 'Sheet' } }
    expect(computeTotalPrice(product, [type], 20, 3).value).toBe(70)
  })
})

// --- suppliers -------------------------------------------------------------

describe('suppliers', () => {
  const suppliers = [
    { name: 'Saad Robot', multiplier: 1.6, shipping: 30, orderMin: 100, orderMax: 500, orderCurrency: 'NIS' },
    { name: 'Plain', multiplier: 0 },
  ]

  it('matches names ignoring case and spaces', () => {
    expect(supplierMultiplier(' saad robot ', suppliers)).toBe(1.6)
    expect(canonicalSupplier('saad robot', suppliers)).toBe('Saad Robot')
    expect(canonicalSupplier('Unknown Co', suppliers)).toBe('Unknown Co')
    expect(canonicalSupplier('  ', suppliers)).toBe('')
  })

  it('has no markup for a blank, unknown or invalid supplier', () => {
    expect(supplierMultiplier('', suppliers)).toBe(1)
    expect(supplierMultiplier('Nobody', suppliers)).toBe(1)
    expect(supplierMultiplier('Plain', suppliers)).toBe(1)
    expect(supplierMultiplier('Saad Robot', undefined)).toBe(1)
  })

  it('applies the markup to the listed price', () => {
    expect(effectivePrice({ price: 10, supplier: 'Saad Robot' }, suppliers)).toBeCloseTo(16)
    expect(effectivePrice({ price: 10 }, suppliers)).toBe(10)
    expect(effectivePrice({}, suppliers)).toBe(0)
  })

  it('reads the expected shipping, 0 when none', () => {
    expect(supplierShipping('saad robot', suppliers)).toBe(30)
    expect(supplierShipping('Plain', suppliers)).toBe(0)
    expect(supplierShipping('', suppliers)).toBe(0)
  })
})

// --- money -----------------------------------------------------------------

describe('spending', () => {
  const purchases = [
    { category: 'Fasteners', unitPrice: 10, currency: 'USD', quantity: 2 },
    { category: 'Fasteners', unitPrice: 37, currency: 'NIS', quantity: 1 },
    { category: '', unitPrice: 5, currency: 'USD', quantity: 1 },
  ]

  it('adds up cost per category in the preferred currency', () => {
    const byCategory = spentByCategory(purchases, rates, 'NIS')
    expect(byCategory.Fasteners).toBeCloseTo(74 + 37)
    expect(byCategory['']).toBeCloseTo(18.5)
    expect(totalSpent(purchases, rates, 'NIS')).toBeCloseTo(74 + 37 + 18.5)
  })

  it('costs a pack purchase by packs, not by the units it added to stock', () => {
    const pack = [{ category: 'A', unitPrice: 20, currency: 'USD', quantity: 4, unitsPerPurchase: 50 }]
    expect(totalSpent(pack, rates, 'USD')).toBeCloseTo(80)
  })

  it('lets a discount (negative price) come off the total', () => {
    const withDiscount = [...purchases, { category: 'Fasteners', unitPrice: -5, currency: 'USD', quantity: 1, discount: true }]
    expect(totalSpent(withDiscount, rates, 'USD')).toBeCloseTo(totalSpent(purchases, rates, 'USD') - 5)
  })
})

describe('what is still to buy', () => {
  const suppliers = [{ name: 'Reseller', multiplier: 1.5, shipping: 20 }]
  const products = [
    { id: 'a', category: 'Fasteners', price: 10, currency: 'USD', wantedCount: 5, countInInventory: 2, supplier: 'Reseller' },
    { id: 'b', category: 'Fasteners', price: 2, currency: 'USD', wantedCount: 1, countInInventory: 5 },
    { id: 'c', category: '', price: 4, currency: 'USD', wantedCount: 3, countInInventory: 0 },
  ]

  it('prices the shortfall with the supplier markup, per category', () => {
    const byCategory = toBuyCostByCategory(products, [], suppliers, rates, 'USD')
    expect(byCategory.Fasteners).toBeCloseTo(45)
    expect(byCategory['']).toBeCloseTo(12)
    expect(totalToBuyCost(products, [], suppliers, rates, 'USD')).toBeCloseTo(57)
  })

  it('leaves a product with a broken formula out of the sum', () => {
    const types = [{ name: 'Bad', toBuyFormula: 'nonsense' }]
    const broken = { id: 'x', price: 9, currency: 'USD', wantedCount: 9, customData: { type: 'Bad' } }
    expect(totalToBuyCost([broken, products[2]], types, [], rates, 'USD')).toBeCloseTo(12)
  })

  it('combines spent and still-to-buy, biggest first, dropping empty categories', () => {
    const rows = plannedSpendByCategory({ A: 10, B: 50 }, { A: 5, C: 20, D: 0 })
    expect(rows.map((r) => r.category)).toEqual(['B', 'C', 'A'])
    expect(rows[2]).toEqual({ category: 'A', spent: 10, toBuy: 5, planned: 15 })
  })

  it('splits the dashboard per supplier, with shipping only while something is still to buy', () => {
    const purchases = [{ supplier: 'reseller', unitPrice: 10, currency: 'USD', quantity: 2 }]
    const rows = supplierBudgetRows(purchases, products, [], suppliers, rates, 'USD')
    const reseller = rows.find((r) => r.supplier === 'Reseller')
    expect(reseller.spent).toBeCloseTo(20)
    expect(reseller.toBuy).toBeCloseTo(45)
    expect(reseller.expectedShipping).toBe(20)
    expect(reseller.projected).toBeCloseTo(85)
  })
})

describe('order range per supplier', () => {
  const suppliers = [{ name: 'Amazon', orderMin: 45, orderMax: 75, orderCurrency: 'USD' }]
  const status = (total) => orderRangeStatus('Amazon', total, suppliers, rates, 'USD')

  it('is in range when one shipment fits', () => {
    expect(status(60)).toMatchObject({ state: 'in', orders: 1, gap: 0 })
  })

  it('is below the minimum for a small total', () => {
    expect(status(30)).toMatchObject({ state: 'below', orders: 1, gap: 15 })
  })

  it('splits a big total into several shipments when that fits', () => {
    expect(status(200)).toMatchObject({ state: 'in', orders: 3 })
  })

  it('says how much to trim when that is the nearest fix', () => {
    expect(status(80)).toMatchObject({ state: 'above', orders: 1, gap: 5 })
  })

  it('is null with nothing to buy, no range, or no exchange rate', () => {
    expect(status(0)).toBeNull()
    expect(orderRangeStatus('Other', 60, suppliers, rates, 'USD')).toBeNull()
    expect(orderRangeStatus('Amazon', 60, suppliers, {}, 'USD')).toBeNull()
  })

  it('describes the status in one line', () => {
    expect(orderRangeText(status(60), 60, 'USD')).toBe('Order range 45-75 USD per shipment: 60 USD, fits one shipment.')
    expect(orderRangeText(status(30), 30, 'USD')).toContain('15 below the minimum')
  })
})

describe('budget', () => {
  it('totals the category budgets, ignoring blanks', () => {
    expect(totalBudget({ A: 100, B: '50', C: '', D: 'x' })).toBe(150)
    expect(totalBudget(undefined)).toBe(0)
  })

  it('gives every budgeted category an equal wedge, shrunk by what it spent', () => {
    const { slices, spentPercent } = budgetRemainingSlices({ A: 100, B: 200, C: 0 }, { A: 50, B: 400 })
    expect(slices.map((s) => s.category)).toEqual(['A', 'B'])
    expect(slices[0]).toMatchObject({ percent: 25, remainingPercent: 50 })
    expect(slices[1]).toMatchObject({ percent: 0, remainingPercent: 0 })
    expect(spentPercent).toBe(75)
  })

  it('has nothing to draw with no budgets', () => {
    expect(budgetRemainingSlices({}, {})).toEqual({ slices: [], spentPercent: 0 })
  })
})

// --- spools ----------------------------------------------------------------

describe('spools', () => {
  it('parses "7.6 m = 54, 15.2 m = 104" and skips what is not a length and a price', () => {
    expect(parseSpools('7.6 m = 54, 15.2 m = 104')).toEqual([
      { meters: 7.6, price: 54 },
      { meters: 15.2, price: 104 },
    ])
    expect(parseSpools('10:30; 20@50\nnonsense, 0m=5')).toEqual([
      { meters: 10, price: 30 },
      { meters: 20, price: 50 },
    ])
    expect(parseSpools('')).toEqual([])
    expect(parseSpools(undefined)).toEqual([])
  })

  it('picks the cheapest spools that cover the need', () => {
    const plan = planSpools(45, [
      { meters: 10, price: 50 },
      { meters: 50, price: 150 },
    ])
    expect(plan.counts).toEqual([{ meters: 50, price: 150, count: 1 }])
    expect(plan.meters).toBe(50)
    expect(plan.cost).toBe(150)
  })

  it('prefers many small spools when that is cheaper', () => {
    const plan = planSpools(100, [
      { meters: 50, price: 150 },
      { meters: 10, price: 20 },
    ])
    expect(plan.counts).toEqual([{ meters: 10, price: 20, count: 10 }])
    expect(plan.cost).toBe(200)
  })

  it('returns null with no need or no usable spools', () => {
    expect(planSpools(0, [{ meters: 10, price: 5 }])).toBeNull()
    expect(planSpools(10, [])).toBeNull()
    expect(planSpools(10, undefined)).toBeNull()
    expect(planSpools(10, [{ meters: 0, price: 5 }])).toBeNull()
  })

  it('formats meters to one decimal', () => {
    expect(formatMeters(7.65)).toBe('7.7 m')
    expect(formatMeters(10)).toBe('10 m')
  })
})

// --- products, systems, loans ----------------------------------------------

describe('products', () => {
  it('fills a raw product with defaults without overwriting what it has', () => {
    const p = normalizeProduct({ name: 'M5', price: 3 })
    expect(p).toMatchObject({ name: 'M5', price: 3, countInInventory: 0, currency: 'NIS', consumable: false, customData: {} })
  })

  it('finds a duplicate name ignoring case and spaces, except the one being edited', () => {
    const products = [{ id: '1', name: 'NEO Motor' }]
    expect(findDuplicateProduct(products, 'neo   motor')).toBe(products[0])
    expect(findDuplicateProduct(products, 'neo motor', '1')).toBeNull()
    expect(findDuplicateProduct(products, '   ')).toBeNull()
  })

  it('searches every text field and the shown price', () => {
    const product = { name: 'M5 bolt', sku: 'B-5', supplier: 'Saad', price: 45, currency: 'USD', countInInventory: 7, wantedCount: 9 }
    expect(productMatchesSearch(product, 'bolt')).toBe(true)
    expect(productMatchesSearch(product, 'saad')).toBe(true)
    expect(productMatchesSearch(product, '')).toBe(true)
    expect(productMatchesSearch(product, 'zzz')).toBe(false)
    expect(productMatchesSearch(product, '166.50', { rates, preferred: 'NIS' })).toBe(true)
  })
})

describe('systems claiming stock', () => {
  const systems = [
    { id: 's1', needs: [{ productId: 'p', quantity: 2 }] },
    { id: 's2', needs: [{ productId: 'p', quantity: '3' }, { productId: 'q', quantity: 1 }] },
  ]

  it('sums claims across systems, skipping the one being edited', () => {
    expect(usedQuantitiesByProduct(systems)).toEqual({ p: 5, q: 1 })
    expect(usedQuantitiesByProduct(systems, 's2')).toEqual({ p: 2 })
  })

  it('takes other systems and lent-out stock off what a reusable product has free', () => {
    expect(availableForProduct({ id: 'p', countInInventory: 10, lentOut: 2 }, { p: 3 })).toBe(5)
    expect(availableForProduct({ id: 'p', countInInventory: 1 }, { p: 3 })).toBe(-2)
  })

  it('counts a consumable product by its stock alone (claims already came off it)', () => {
    expect(availableForProduct({ id: 'p', consumable: true, countInInventory: 4 }, { p: 3 })).toBe(4)
  })

  it('lists needs that claim more than is available', () => {
    const products = [{ id: 'p', countInInventory: 3 }]
    const result = overallocatedNeeds([{ productId: 'p', quantity: 5 }, { productId: 'gone', quantity: 1 }], products, {})
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ quantity: 5, max: 3, shortfall: 2 })
  })

  it('moves stock only for consumable products when needs change', () => {
    const products = [
      { id: 'glue', consumable: true },
      { id: 'motor', consumable: false },
    ]
    const before = [{ productId: 'glue', quantity: 2 }, { productId: 'motor', quantity: 1 }]
    const after = [{ productId: 'glue', quantity: 5 }, { productId: 'motor', quantity: 4 }]
    expect(consumableInventoryDeltas(before, after, products)).toEqual([{ productId: 'glue', delta: 3 }])
    expect(consumableInventoryDeltas(before, [], products)).toEqual([{ productId: 'glue', delta: -2 }])
  })
})

describe('loans', () => {
  const products = [{ id: 'p1' }]
  const lent = (extra = {}) => ({ direction: 'lent', productId: 'p1', quantity: 2, stockEffect: 'lentOut', ...extra })

  it('reserves stock while a loan is open and gives it back when returned', () => {
    expect(loanInventoryDeltas(null, lent(), products)).toEqual([{ productId: 'p1', field: 'lentOut', delta: 2 }])
    expect(loanInventoryDeltas(lent(), lent({ returnedOn: '2026-11-01' }), products)).toEqual([{ productId: 'p1', field: 'lentOut', delta: -2 }])
    expect(loanInventoryDeltas(lent(), null, products)).toEqual([{ productId: 'p1', field: 'lentOut', delta: -2 }])
  })

  it('applies only the difference when the quantity is edited', () => {
    expect(loanInventoryDeltas(lent(), lent({ quantity: 5 }), products)).toEqual([{ productId: 'p1', field: 'lentOut', delta: 3 }])
    expect(loanInventoryDeltas(lent(), lent(), products)).toEqual([])
  })

  it('takes a consumable off the count itself', () => {
    expect(loanInventoryDeltas(null, lent({ stockEffect: 'count', quantity: 3 }), products)).toEqual([
      { productId: 'p1', field: 'countInInventory', delta: -3 },
    ])
  })

  it('never touches inventory for borrowed items or deleted products', () => {
    expect(loanInventoryDeltas(null, lent({ direction: 'borrowed' }), products)).toEqual([])
    expect(loanInventoryDeltas(null, lent({ productId: 'gone' }), products)).toEqual([])
  })

  it('is overdue only while open and past its due date', () => {
    expect(isLoanOverdue({ dueDate: '2026-11-01' }, '2026-11-08')).toBe(true)
    expect(isLoanOverdue({ dueDate: '2026-11-08' }, '2026-11-08')).toBe(false)
    expect(isLoanOverdue({ dueDate: '2026-11-01', returnedOn: '2026-11-02' }, '2026-11-08')).toBe(false)
    expect(isLoanOverdue({}, '2026-11-08')).toBe(false)
  })
})
