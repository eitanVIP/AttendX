import { describe, expect, it } from 'vitest'
import { PRODUCT_IMPORT_HEADERS, parseCSV, parseProductImport } from './csv'

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
