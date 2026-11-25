import { describe, expect, it } from 'vitest'
import {
  PRODUCT_IMPORT_HEADERS,
  filterPurchasesBySupplier,
  parseCSV,
  parseProductImport,
  purchaseExportHeaders,
  purchaseExportRows,
  purchaseSupplierOptions,
} from './csv'

describe('parseCSV', () => {
  it('splits rows and cells', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('accepts CRLF, bare CR and a trailing newline', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCSV('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps commas, quotes and newlines inside quoted cells', () => {
    expect(parseCSV('"a, b","say ""hi""","line1\nline2"')).toEqual([['a, b', 'say "hi"', 'line1\nline2']])
  })

  it('drops a leading BOM and fully blank lines', () => {
    expect(parseCSV('﻿a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps empty cells in the middle of a row', () => {
    expect(parseCSV('a,,c')).toEqual([['a', '', 'c']])
  })
})

describe('parseProductImport', () => {
  const options = {
    categories: ['Fasteners', 'Electronics'],
    subcategories: { Fasteners: ['Bolts'] },
    currencyCodes: ['NIS', 'USD'],
  }
  const header = PRODUCT_IMPORT_HEADERS.join(',')

  it('turns a valid file into products with defaults filled in', () => {
    const csv = `${header}\nM5 bolt,B-5,Fasteners,Bolts,0.5,NIS,Saad,https://x.test,100,250\n`
    const { products, errors } = parseProductImport(csv, options)
    expect(errors).toEqual([])
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      name: 'M5 bolt',
      sku: 'B-5',
      category: 'Fasteners',
      subcategory: 'Bolts',
      price: 0.5,
      currency: 'NIS',
      supplier: 'Saad',
      countInInventory: 100,
      wantedCount: 250,
      consumable: false,
      customData: {},
    })
  })

  it('treats blank stock and wanted as zero, and allows a file with no Subcategory column', () => {
    const noSub = PRODUCT_IMPORT_HEADERS.filter((h) => h !== 'Subcategory').join(',')
    const { products, errors } = parseProductImport(`${noSub}\nNut,,Fasteners,2,NIS,,,,,\n`, options)
    expect(errors).toEqual([])
    expect(products[0]).toMatchObject({ subcategory: '', countInInventory: 0, wantedCount: 0, price: 2 })
  })

  it('accepts the columns in any order', () => {
    const shuffled = [...PRODUCT_IMPORT_HEADERS].reverse()
    const row = { Name: 'N', SKU: '', Category: 'Electronics', Subcategory: '', Price: '3', Currency: 'USD', Supplier: '', Link: '', 'In stock': '1', Wanted: '2' }
    const csv = `${shuffled.join(',')}\n${shuffled.map((h) => row[h]).join(',')}\n`
    const { products, errors } = parseProductImport(csv, options)
    expect(errors).toEqual([])
    expect(products[0]).toMatchObject({ name: 'N', category: 'Electronics', price: 3, currency: 'USD', countInInventory: 1, wantedCount: 2 })
  })

  it('imports nothing at all when any row is bad, listing every problem', () => {
    const csv = [
      header,
      ',,Fasteners,,1,NIS,,,,',
      'A,,Nope,,1,NIS,,,,',
      'B,,Fasteners,Washers,1,NIS,,,,',
      'C,,Fasteners,,abc,NIS,,,,',
      'D,,Fasteners,,1,EUR,,,,',
      'E,,Fasteners,,1,NIS,,,-1,',
      'Good,,Fasteners,,1,NIS,,,1,1',
    ].join('\n')
    const { products, errors } = parseProductImport(csv, options)
    expect(products).toBeNull()
    expect(errors).toHaveLength(6)
    expect(errors[0]).toMatch(/^Row 2: Name is required/)
    expect(errors[1]).toMatch(/^Row 3: category "Nope"/)
    expect(errors[2]).toMatch(/^Row 4: subcategory "Washers"/)
    expect(errors[3]).toMatch(/^Row 5: Price "abc"/)
    expect(errors[4]).toMatch(/^Row 6: currency "EUR"/)
    expect(errors[5]).toMatch(/^Row 7: In stock "-1"/)
  })

  it('rejects empty files, wrong columns and files with no rows', () => {
    expect(parseProductImport('', options).errors).toEqual(['The file is empty.'])
    const wrong = parseProductImport('Name,Color\nA,red', options)
    expect(wrong.products).toBeNull()
    expect(wrong.errors.join(' ')).toMatch(/Missing columns/)
    expect(wrong.errors.join(' ')).toMatch(/Unexpected column: Color/)
    expect(parseProductImport(header, options).errors).toEqual(['No product rows found below the header.'])
  })
})

describe('purchase export', () => {
  const rates = { NIS: 3.6, USD: 1 }
  const headers = purchaseExportHeaders('NIS')
  const col = (row, name) => row[headers.indexOf(name)]

  it('has one header per value in every row', () => {
    const rows = purchaseExportRows([{ productId: 'a', productName: 'Bolt', quantity: 1, unitPrice: 2, currency: 'NIS', date: '2026-11-01' }], rates, 'NIS')
    expect(rows[0]).toHaveLength(headers.length)
    expect(headers).toContain('Cost (NIS)')
  })

  it('writes packs, pack size and the units that went into stock (the order batch case)', () => {
    const [row] = purchaseExportRows(
      [{ productId: 'bolts', productName: 'M5 bolt', category: 'Fasteners', supplier: 'Saad', quantity: 4, unitsPerPurchase: 50, unitPrice: 20, currency: 'NIS', date: '2026-11-08', dismissed: false }],
      rates,
      'NIS'
    )
    expect(col(row, 'Type')).toBe('Product')
    expect(col(row, 'Quantity')).toBe(4)
    expect(col(row, 'Pack size')).toBe(50)
    expect(col(row, 'Units added')).toBe(200)
    expect(col(row, 'Cost')).toBe(80)
    expect(col(row, 'Date')).toBe('2026-11-08')
    expect(col(row, 'Dismissed')).toBe('No')
  })

  it('treats an old purchase without a pack size as bought by the unit', () => {
    const [row] = purchaseExportRows([{ productId: 'a', productName: 'Nut', quantity: 3, unitPrice: 1, currency: 'NIS' }], rates, 'NIS')
    expect(col(row, 'Pack size')).toBe(1)
    expect(col(row, 'Units added')).toBe(3)
  })

  it('includes dismissed purchases and marks them', () => {
    const rows = purchaseExportRows(
      [
        { productId: 'a', productName: 'A', quantity: 1, unitPrice: 1, currency: 'NIS', dismissed: true },
        { productId: 'b', productName: 'B', quantity: 1, unitPrice: 1, currency: 'NIS', dismissed: false },
      ],
      rates,
      'NIS'
    )
    expect(rows.map((r) => col(r, 'Dismissed'))).toEqual(['Yes', 'No'])
  })

  it('labels manual expenses, shipping and discounts, with no stock columns', () => {
    const rows = purchaseExportRows(
      [
        { productId: '', productName: 'Pizza', quantity: 1, unitPrice: 30, currency: 'NIS' },
        { productId: '', productName: 'Shipping from Saad', quantity: 1, unitPrice: 25, currency: 'NIS', shipping: true },
        { productId: '', productName: 'Coupon', quantity: 1, unitPrice: -575, currency: 'NIS', discount: true },
      ],
      rates,
      'NIS'
    )
    expect(rows.map((r) => col(r, 'Type'))).toEqual(['Manual expense', 'Shipping', 'Discount'])
    for (const r of rows) {
      expect(col(r, 'Pack size')).toBe('')
      expect(col(r, 'Units added')).toBe('')
    }
    expect(col(rows[2], 'Cost')).toBe(-575)
  })

  it('converts the cost to the preferred currency and leaves it blank for an unknown currency', () => {
    const rows = purchaseExportRows(
      [
        { productId: 'a', productName: 'US part', quantity: 2, unitPrice: 10, currency: 'USD' },
        { productId: 'b', productName: 'Odd part', quantity: 1, unitPrice: 5, currency: 'XYZ' },
        { productId: 'c', productName: 'Free part', quantity: 1, unitPrice: 0, currency: 'NIS' },
      ],
      rates,
      'NIS'
    )
    expect(col(rows[0], 'Cost')).toBe(20)
    expect(col(rows[0], 'Cost (NIS)')).toBe(72)
    expect(col(rows[1], 'Cost (NIS)')).toBe('')
    expect(col(rows[2], 'Cost (NIS)')).toBe(0)
  })

  it('stays in the order it was given and handles an empty list', () => {
    const rows = purchaseExportRows(
      [
        { productId: 'a', productName: 'First', quantity: 1, unitPrice: 1, currency: 'NIS' },
        { productId: 'b', productName: 'Second', quantity: 1, unitPrice: 1, currency: 'NIS' },
      ],
      rates,
      'NIS'
    )
    expect(rows.map((r) => col(r, 'Item'))).toEqual(['First', 'Second'])
    expect(purchaseExportRows([], rates, 'NIS')).toEqual([])
  })
})

describe('purchase export by supplier', () => {
  const suppliers = [{ name: 'Saad' }, { name: 'Amazon' }]
  const purchases = [
    { productName: 'A', supplier: 'Saad' },
    { productName: 'B', supplier: 'saad ' },
    { productName: 'C', supplier: 'Amazon' },
    { productName: 'D', supplier: '' },
    { productName: 'E' },
    { productName: 'F', supplier: 'Local shop' },
  ]

  it('lists each supplier once, spelled as on the supplier list, with "no supplier" as its own entry', () => {
    expect(purchaseSupplierOptions(purchases, suppliers)).toEqual([
      { key: '', label: '' },
      { key: 'amazon', label: 'Amazon' },
      { key: 'local shop', label: 'Local shop' },
      { key: 'saad', label: 'Saad' },
    ])
  })

  it('keeps everything when no supplier is chosen', () => {
    expect(filterPurchasesBySupplier(purchases, [], suppliers)).toBe(purchases)
  })

  it('keeps only the chosen supplier, ignoring case and spacing', () => {
    expect(filterPurchasesBySupplier(purchases, ['saad'], suppliers).map((p) => p.productName)).toEqual(['A', 'B'])
  })

  it('can combine several suppliers and pick out purchases with none', () => {
    expect(filterPurchasesBySupplier(purchases, ['amazon', 'local shop'], suppliers).map((p) => p.productName)).toEqual(['C', 'F'])
    expect(filterPurchasesBySupplier(purchases, [''], suppliers).map((p) => p.productName)).toEqual(['D', 'E'])
  })
})
