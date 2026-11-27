import { t } from '../lib/i18n'

// A short-lived bar offering to take back the last drag or move. `undo` is
// { message, run } or null.
export default function UndoBar({ undo, onClose }) {
  if (!undo) return null
  return (
    <div className="undo-bar" role="status">
      <span>{undo.message}</span>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          undo.run()
          onClose()
        }}
      >
        {t('Undo')}
      </button>
      <button type="button" className="link-btn" aria-label={t('Dismiss')} onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
