export default function MoveButtons({ onUp, onDown, canUp, canDown }) {
  return (
    <>
      <button type="button" className="link-btn move-btn" onClick={onUp} disabled={!canUp} aria-label="Move up" title="Move up">
        ↑
      </button>
      <button
        type="button"
        className="link-btn move-btn"
        onClick={onDown}
        disabled={!canDown}
        aria-label="Move down"
        title="Move down"
      >
        ↓
      </button>
    </>
  )
}
