// A team's Firestore id is its FRC team number (1-5 digits, no leading
// zero - firestore.rules enforces the same on create). Text + inputMode
// rather than type="number" so phones show a digit pad without the
// spinner, "e"/"-" and other number-field quirks.
export default function TeamNumberInput({ value, onChange, ...props }) {
  return (
    <input
      inputMode="numeric"
      pattern="[1-9][0-9]{0,4}"
      title="FRC team number (up to 5 digits)"
      placeholder="e.g. 3211"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 5))}
      required
      {...props}
    />
  )
}
