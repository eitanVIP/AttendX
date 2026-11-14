import { describe, expect, it } from 'vitest'
import { evaluateFormula, isReservedFieldName, isValidFieldName } from './formula'

const ok = (source, scope = {}) => {
  const r = evaluateFormula(source, scope)
  expect(r.error).toBeNull()
  return r.value
}
const bad = (source, scope = {}) => {
  const r = evaluateFormula(source, scope)
  expect(r.value).toBeNull()
  expect(r.error).toBeTruthy()
  return r.error
}

describe('evaluateFormula - arithmetic', () => {
  it('follows normal precedence and parentheses', () => {
    expect(ok('2 + 3 * 4')).toBe(14)
    expect(ok('(2 + 3) * 4')).toBe(20)
    expect(ok('10 - 4 - 3')).toBe(3)
    expect(ok('20 / 4 / 5')).toBe(1)
    expect(ok('7 % 3')).toBe(1)
  })

  it('supports unary minus and decimals', () => {
    expect(ok('-5 + 8')).toBe(3)
    expect(ok('--4')).toBe(4)
    expect(ok('1.5 * 2')).toBe(3)
    expect(ok('.5 + .25')).toBe(0.75)
  })

  it('treats a blank formula as "no formula", not an error', () => {
    expect(evaluateFormula('', {})).toEqual({ value: null, error: null })
    expect(evaluateFormula('   ', {})).toEqual({ value: null, error: null })
    expect(evaluateFormula(undefined, {})).toEqual({ value: null, error: null })
  })
})

describe('evaluateFormula - functions', () => {
  it('has the whitelisted functions', () => {
    expect(ok('ceil(2.1)')).toBe(3)
    expect(ok('floor(2.9)')).toBe(2)
    expect(ok('round(2.5)')).toBe(3)
    expect(ok('int(-2.9)')).toBe(-2)
    expect(ok('double(2.5)')).toBe(2.5)
    expect(ok('abs(-7)')).toBe(7)
    expect(ok('min(4, 2, 9)')).toBe(2)
    expect(ok('max(4, 2, 9)')).toBe(9)
  })

  it('is case-insensitive for function and variable names', () => {
    expect(ok('CEIL(WANTED / 3)', { wanted: 7 })).toBe(3)
  })

  it('rejects unknown functions', () => {
    expect(bad('eval(1)')).toMatch(/Unknown function/)
  })
})

describe('evaluateFormula - variables and custom fields', () => {
  it('reads built-in variables', () => {
    expect(ok('wanted - stock', { wanted: 10, stock: 4 })).toBe(6)
  })

  it('reads custom fields by dot and by quoted name', () => {
    const scope = { custom: { PackSize: '50', 'Pack Size': 25 } }
    expect(ok('custom.PackSize', scope)).toBe(50)
    expect(ok('custom["Pack Size"]', scope)).toBe(25)
    expect(ok("custom['Pack Size']", scope)).toBe(25)
  })

  it('rounds a pack formula up to whole packs', () => {
    expect(ok('ceil(wanted / int(custom.PackSize))', { wanted: 120, custom: { PackSize: '50' } })).toBe(3)
  })

  it('rejects unknown variables', () => {
    expect(bad('nonsense + 1')).toMatch(/Unknown variable/)
  })

  it('reports a missing or non-numeric custom field instead of throwing', () => {
    expect(bad('custom.Missing + 1', { custom: {} })).toMatch(/number/)
    expect(bad('custom.Name', { custom: { Name: 'abc' } })).toMatch(/number/)
  })
})

describe('evaluateFormula - never throws, never runs code', () => {
  it('reports division and modulo by zero as "not a number"', () => {
    expect(bad('1 / 0')).toMatch(/number/)
    expect(bad('5 % 0')).toMatch(/number/)
  })

  it('reports syntax errors', () => {
    bad('2 +')
    bad('(2 + 3')
    bad('2 3')
    bad('2 $ 3')
    bad('custom["unterminated')
    bad('custom[')
  })

  it('refuses anything that is not plain arithmetic', () => {
    bad('constructor')
    bad('process.exit(1)')
    bad('globalThis')
    bad('alert(1)')
  })

  it('refuses over-long formulas', () => {
    expect(bad('1+'.repeat(200) + '1')).toMatch(/too long/)
  })
})

describe('field name checks', () => {
  it('reserves only "type"', () => {
    expect(isReservedFieldName('type')).toBe(true)
    expect(isReservedFieldName(' type ')).toBe(true)
    expect(isReservedFieldName('Type')).toBe(false)
    expect(isReservedFieldName('thickness')).toBe(false)
  })

  it('rejects names Firestore cannot store', () => {
    expect(isValidFieldName('Thickness')).toBe(true)
    expect(isValidFieldName('Pack size')).toBe(true)
    expect(isValidFieldName('')).toBe(false)
    expect(isValidFieldName('   ')).toBe(false)
    expect(isValidFieldName('a/b')).toBe(false)
    expect(isValidFieldName('__proto__')).toBe(false)
    expect(isValidFieldName('__a')).toBe(true)
  })
})
