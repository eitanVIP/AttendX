// A small, deliberately non-Turing-complete arithmetic language for
// per-product formulas (Settings -> Product types -> "To buy"/"Total
// price"). This is NOT a JS sandbox and never touches eval/Function/vm -
// it's a hand-written tokenizer + recursive-descent parser + tree-walking
// evaluator over its own AST, so the only operations that can ever run are
// the arithmetic below and the five whitelisted functions - there's no
// property access beyond a fixed `custom.<field>` form, no loop or
// user-defined-function syntax, and no way to reach the DOM, network, or
// anything outside the numbers handed to it.
//
// That restriction is the point, not an afterthought: a formula is
// authored by one admin and stored on a shared product doc, so every other
// admin's browser evaluates it just by opening Orders - unlike a console
// someone can only reach on their own machine, this runs in everyone
// else's session automatically. A real `eval` on that string would let one
// team member run arbitrary code as any other; this interpreter can only
// ever compute a number.

// `type` is the only reserved name: it's the key a product's own customData
// uses to record which product type it is (see calc.js). The formulas
// themselves live only on the type in team.productTypes, never copied onto
// a product, so there's nothing else here for a field name to collide with.
const RESERVED_FIELD_NAMES = ['type']

export function isReservedFieldName(name) {
  return RESERVED_FIELD_NAMES.includes((name || '').trim())
}

// Same Firestore restriction as above, plus the one on "/" - a user-typed
// field name isn't limited to the couple of reserved strings, so this
// catches any name (reserved or not) Firestore would otherwise reject the
// whole product write over.
export function isValidFieldName(name) {
  const trimmed = (name || '').trim()
  return !!trimmed && !trimmed.includes('/') && !(trimmed.startsWith('__') && trimmed.endsWith('__'))
}

const FUNCTIONS = {
  int: Math.trunc,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  // An explicit no-op: every value reaching a function here is already a
  // number (custom/var lookups coerce on read), so this exists purely so a
  // formula can say "keep this a decimal" as clearly as int() truncates one.
  double: (x) => x,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
}

const MAX_LENGTH = 300
const SINGLE_CHAR_TOKENS = {
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '/': 'slash',
  '%': 'percent',
  '(': 'lparen',
  ')': 'rparen',
  '[': 'lbracket',
  ']': 'rbracket',
  '.': 'dot',
  ',': 'comma',
}

function tokenize(source) {
  const tokens = []
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] || ''))) {
      let j = i + 1
      while (/[0-9.]/.test(source[j] || '')) j++
      tokens.push({ type: 'num', value: Number(source.slice(i, j)) })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1
      while (/[a-zA-Z0-9_]/.test(source[j] || '')) j++
      tokens.push({ type: 'ident', value: source.slice(i, j) })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let str = ''
      while (j < source.length && source[j] !== c) {
        str += source[j]
        j++
      }
      if (source[j] !== c) throw new Error('Unterminated quote')
      tokens.push({ type: 'string', value: str })
      i = j + 1
      continue
    }
    const kind = SINGLE_CHAR_TOKENS[c]
    if (kind) {
      tokens.push({ type: kind })
      i++
      continue
    }
    throw new Error(`Unexpected character "${c}"`)
  }
  return tokens
}

// expression := term (('+'|'-') term)*
// term       := unary (('*'|'/'|'%') unary)*
// unary      := '-' unary | primary
// primary    := NUMBER | '(' expression ')' | IDENT '(' args? ')'
//             | 'custom' ('.' IDENT | '[' STRING ']') | IDENT
function parse(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (type) => {
    const t = next()
    if (!t || t.type !== type) throw new Error(`Expected "${type}"`)
    return t
  }

  function parseExpression() {
    let node = parseTerm()
    while (peek() && (peek().type === 'plus' || peek().type === 'minus')) {
      const op = next().type === 'plus' ? '+' : '-'
      node = { type: 'binary', op, left: node, right: parseTerm() }
    }
    return node
  }

  function parseTerm() {
    let node = parseUnary()
    while (peek() && ['star', 'slash', 'percent'].includes(peek().type)) {
      const opType = next().type
      const op = opType === 'star' ? '*' : opType === 'slash' ? '/' : '%'
      node = { type: 'binary', op, left: node, right: parseUnary() }
    }
    return node
  }

  function parseUnary() {
    if (peek() && peek().type === 'minus') {
      next()
      return { type: 'unary', arg: parseUnary() }
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const t = peek()
    if (!t) throw new Error('Unexpected end of formula')

    if (t.type === 'num') {
      next()
      return { type: 'num', value: t.value }
    }
    if (t.type === 'lparen') {
      next()
      const node = parseExpression()
      expect('rparen')
      return node
    }
    if (t.type === 'ident') {
      next()
      const name = t.value

      if (peek()?.type === 'lparen') {
        next()
        const args = []
        if (peek()?.type !== 'rparen') {
          args.push(parseExpression())
          while (peek()?.type === 'comma') {
            next()
            args.push(parseExpression())
          }
        }
        expect('rparen')
        return { type: 'call', name: name.toLowerCase(), args }
      }

      if (name.toLowerCase() === 'custom' && (peek()?.type === 'dot' || peek()?.type === 'lbracket')) {
        if (peek().type === 'dot') {
          next()
          return { type: 'customRef', field: expect('ident').value }
        }
        next() // lbracket
        const field = expect('string').value
        expect('rbracket')
        return { type: 'customRef', field }
      }

      return { type: 'var', name: name.toLowerCase() }
    }
    throw new Error(`Unexpected token near "${t.value ?? t.type}"`)
  }

  const node = parseExpression()
  if (pos !== tokens.length) throw new Error('Unexpected trailing input')
  return node
}

function toNumber(v) {
  if (typeof v === 'number') return v
  if (v === null || v === undefined || v === '') return NaN
  const n = parseFloat(v)
  return Number.isNaN(n) ? NaN : n
}

function evalNode(node, scope) {
  switch (node.type) {
    case 'num':
      return node.value
    case 'unary':
      return -evalNode(node.arg, scope)
    case 'binary': {
      const l = evalNode(node.left, scope)
      const r = evalNode(node.right, scope)
      if (node.op === '+') return l + r
      if (node.op === '-') return l - r
      if (node.op === '*') return l * r
      if (node.op === '/') return r === 0 ? NaN : l / r
      return r === 0 ? NaN : l % r // '%'
    }
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) throw new Error(`Unknown function "${node.name}"`)
      return fn(...node.args.map((a) => evalNode(a, scope)))
    }
    case 'var':
      if (!(node.name in scope)) throw new Error(`Unknown variable "${node.name}"`)
      return toNumber(scope[node.name])
    case 'customRef':
      return toNumber(scope.custom?.[node.field])
    default:
      throw new Error('Invalid formula')
  }
}

// `scope` supplies every name a formula may reference: plain lowercase
// keys for built-ins (sku, price, ...) and a `custom` object for
// `custom.<field>`/`custom["field"]`. Never throws - a bad formula or a
// missing/non-numeric value just comes back as a null value with an error
// string, so one broken formula can't take down the whole table.
export function evaluateFormula(source, scope) {
  const trimmed = (source || '').trim()
  if (!trimmed) return { value: null, error: null }
  if (trimmed.length > MAX_LENGTH) return { value: null, error: 'Formula is too long' }
  try {
    const value = evalNode(parse(tokenize(trimmed)), scope)
    if (!Number.isFinite(value)) return { value: null, error: "Formula didn't produce a number" }
    return { value, error: null }
  } catch (e) {
    return { value: null, error: e.message || 'Invalid formula' }
  }
}
