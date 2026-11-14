import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stands in for Firestore: every write is recorded instead of sent, so the
// tests can check exactly what a purchase does to stock and to the records.
const store = vi.hoisted(() => ({ ops: [], batches: [], autoId: 0 }))

vi.mock('firebase/firestore', () => {
  const record = (op, ref, data) => store.ops.push({ op, path: ref.path, data })
  return {
    addDoc: async (ref, data) => record('add', ref, data),
    arrayRemove: (...items) => ({ __arrayRemove: items }),
    arrayUnion: (...items) => ({ __arrayUnion: items }),
    collection: (_db, ...segments) => ({ path: segments.join('/'), isCollection: true }),
    deleteDoc: async (ref) => record('delete', ref),
    deleteField: () => ({ __deleteField: true }),
    doc: (first, ...segments) =>
      first?.isCollection && segments.length === 0
        ? { path: `${first.path}/auto${++store.autoId}` }
        : { path: segments.join('/') },
    FieldPath: class {},
    getDoc: async () => ({ exists: () => false }),
    getDocs: async () => ({ docs: [], empty: true }),
    increment: (n) => ({ __increment: n }),
    onSnapshot: () => () => {},
    query: (ref) => ref,
    setDoc: async (ref, data) => record('set', ref, data),
    updateDoc: async (ref, data) => record('update', ref, data),
    where: () => ({}),
    writeBatch: () => {
      const batch = {
        update: (ref, data) => record('update', ref, data),
        set: (ref, data) => record('set', ref, data),
        delete: (ref) => record('delete', ref),
        commit: async () => {},
      }
      store.batches.push(batch)
      return batch
    },
  }
})

vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'u1', email: 'admin@example.test' } }, db: { __db: true } }))

const { commitAll, dismissPurchase, fixOldPackPurchases, logCart, logFakePurchase, markPackPurchaseFixed, revertPurchase } = await import('./actions')

const TEAM = 'team1'
const stockWrites = () => store.ops.filter((o) => o.path.startsWith(`teams/${TEAM}/products/`))
const purchaseWrites = () => store.ops.filter((o) => o.path.startsWith(`teams/${TEAM}/purchases`))
const logWrites = () => store.ops.filter((o) => o.path.startsWith(`teams/${TEAM}/log`))

beforeEach(() => {
  store.ops.length = 0
  store.batches.length = 0
  store.autoId = 0
})

describe('logCart - what a logged purchase does to stock', () => {
  const bolts = { id: 'bolts', name: 'M5 bolt', category: 'Fasteners', subcategory: 'Bolts', supplier: 'Saad' }

  it('adds packs × pack size to stock, not just the number of packs (the order batch bug)', async () => {
    await logCart(TEAM, [{ product: bolts, quantity: 4, unitsPer: 50, unitPrice: 20, currency: 'NIS', supplier: 'Saad' }], null)
    expect(stockWrites()).toEqual([{ op: 'update', path: 'teams/team1/products/bolts', data: { countInInventory: { __increment: 200 } } }])
  })

  it('records the pack size on the purchase so it can be reverted and displayed later', async () => {
    await logCart(TEAM, [{ product: bolts, quantity: 4, unitsPer: 50, unitPrice: 20, currency: 'NIS', supplier: 'Saad' }], null)
    const [purchase] = purchaseWrites()
    expect(purchase.data).toMatchObject({
      productId: 'bolts',
      productName: 'M5 bolt',
      category: 'Fasteners',
      supplier: 'Saad',
      quantity: 4,
      unitsPerPurchase: 50,
      unitPrice: 20,
      currency: 'NIS',
      dismissed: false,
    })
  })

  it('adds just the quantity for a product bought by the unit', async () => {
    await logCart(TEAM, [{ product: bolts, quantity: 7, unitsPer: 1, unitPrice: 3, currency: 'USD' }], null)
    expect(stockWrites()[0].data.countInInventory).toEqual({ __increment: 7 })
  })

  it('adds a fractional length for spools without float noise', async () => {
    await logCart(TEAM, [{ product: bolts, quantity: 0.1, unitsPer: 3, unitPrice: 1, currency: 'USD' }], null)
    expect(stockWrites()[0].data.countInInventory).toEqual({ __increment: 0.3 })
  })

  it('writes one purchase and one stock update per line, plus one change-log entry for the cart', async () => {
    const nut = { id: 'nut', name: 'Nut' }
    await logCart(
      TEAM,
      [
        { product: bolts, quantity: 1, unitsPer: 1, unitPrice: 1, currency: 'NIS' },
        { product: nut, quantity: 2, unitsPer: 1, unitPrice: 1, currency: 'NIS' },
      ],
      null
    )
    expect(stockWrites()).toHaveLength(2)
    expect(purchaseWrites()).toHaveLength(2)
    expect(logWrites()).toHaveLength(1)
    expect(logWrites()[0].data.summary).toBe('Logged a cart of 2 items (M5 bolt, Nut)')
    expect(logWrites()[0].data).toMatchObject({ entity: 'purchase', action: 'create', uid: 'u1' })
  })

  it('logs a price difference as one extra line that touches no stock', async () => {
    await logCart(TEAM, [{ product: bolts, quantity: 1, unitsPer: 1, unitPrice: 100, currency: 'NIS' }], {
      amount: -15,
      currency: 'NIS',
      category: 'Fasteners',
      supplier: 'Saad',
    })
    const extra = purchaseWrites().find((p) => p.data.productName === 'Cart discrepancy')
    expect(extra.data).toMatchObject({ productId: '', quantity: 1, unitPrice: -15, discount: true, category: 'Fasteners', supplier: 'Saad' })
    expect(stockWrites()).toHaveLength(1)
  })

  it('ignores a rounding-sized difference', async () => {
    await logCart(TEAM, [{ product: bolts, quantity: 1, unitsPer: 1, unitPrice: 1, currency: 'NIS' }], { amount: 0.001, currency: 'NIS' })
    expect(purchaseWrites()).toHaveLength(1)
  })
})

describe('reverting and hiding purchases', () => {
  it('takes back exactly the units the purchase added', async () => {
    await revertPurchase(TEAM, { id: 'p1', productId: 'bolts', productName: 'M5 bolt', quantity: 4, unitsPerPurchase: 50 })
    expect(stockWrites()).toEqual([{ op: 'update', path: 'teams/team1/products/bolts', data: { countInInventory: { __increment: -200 } } }])
    expect(store.ops.find((o) => o.op === 'delete').path).toBe('teams/team1/purchases/p1')
  })

  it('takes back just the quantity for a purchase logged without a pack size', async () => {
    await revertPurchase(TEAM, { id: 'p1', productId: 'bolts', productName: 'M5 bolt', quantity: 4 })
    expect(stockWrites()[0].data.countInInventory).toEqual({ __increment: -4 })
  })

  it('has no stock to give back for a manual expense', async () => {
    await revertPurchase(TEAM, { id: 'p2', productId: '', productName: 'Pizza', quantity: 1 })
    expect(stockWrites()).toEqual([])
  })

  it('hiding a purchase from the Bought table changes no stock', async () => {
    await dismissPurchase(TEAM, { id: 'p1', productId: 'bolts', productName: 'M5 bolt', quantity: 4 })
    expect(stockWrites()).toEqual([])
    expect(purchaseWrites()[0]).toMatchObject({ op: 'update', path: 'teams/team1/purchases/p1', data: { dismissed: true } })
  })
})

describe('old pack purchases', () => {
  const fix = { purchase: { id: 'p1', productId: 'bolts', productName: 'M5 bolt', quantity: 4 }, packSize: 50 }

  it('"Fix their stock" adds the missing units and records the pack size', async () => {
    await fixOldPackPurchases(TEAM, [fix])
    expect(stockWrites()[0].data.countInInventory).toEqual({ __increment: 4 * 49 })
    expect(purchaseWrites()[0]).toMatchObject({ path: 'teams/team1/purchases/p1', data: { unitsPerPurchase: 50 } })
  })

  it('"Already fixed" records the pack size and never touches stock', async () => {
    await markPackPurchaseFixed(TEAM, fix)
    expect(stockWrites()).toEqual([])
    expect(purchaseWrites()).toEqual([{ op: 'update', path: 'teams/team1/purchases/p1', data: { unitsPerPurchase: 50 } }])
    expect(logWrites()[0].data.summary).toContain('already fixed')
  })
})

describe('manual expenses', () => {
  it('count toward spend but never touch stock', async () => {
    await logFakePurchase(TEAM, { productName: 'Shipping', quantity: 1, unitPrice: 30, currency: 'NIS', date: '2026-11-08', shipping: true, supplier: 'Saad' })
    expect(stockWrites()).toEqual([])
    expect(purchaseWrites()[0].data).toMatchObject({ productId: '', unitPrice: 30, shipping: true, supplier: 'Saad', dismissed: false })
  })

  it('flags a discount', async () => {
    await logFakePurchase(TEAM, { productName: 'Coupon', quantity: 1, unitPrice: -575, currency: 'NIS', date: '2026-11-08', discount: true })
    expect(purchaseWrites()[0].data).toMatchObject({ unitPrice: -575, discount: true })
    expect(purchaseWrites()[0].data).not.toHaveProperty('shipping')
  })
})

describe('commitAll', () => {
  it('splits big writes into batches of 15', async () => {
    await commitAll(Array.from({ length: 40 }, () => (batch) => batch.set({ path: 'x' }, {})))
    expect(store.batches).toHaveLength(3)
    expect(store.ops).toHaveLength(40)
  })

  it('does nothing for no writes', async () => {
    await commitAll([])
    expect(store.batches).toHaveLength(0)
  })
})
