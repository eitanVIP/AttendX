// Remembers the last values submitted through an "add" form, per page - a
// plain module-level object, so it lives only as long as the tab does and
// never touches the database or localStorage.
const lastValues = {}

export function rememberForm(key, values, skipFields = []) {
  const rest = { ...values }
  for (const field of [].concat(skipFields)) delete rest[field]
  lastValues[key] = rest
}

export function withLastValues(key, emptyForm) {
  return { ...emptyForm, ...lastValues[key] }
}
