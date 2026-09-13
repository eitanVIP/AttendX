// Shared by Inventory and Orders: category chips (counts against the full
// list, unaffected by the search box) plus a free-text search box (see
// productMatchesSearch in calc.js for what it matches against).
export default function ProductFilters({ products, categories, categoryFilter, onCategoryFilter, search, onSearch }) {
  return (
    <>
      <div className="filter-row">
        <button className={!categoryFilter ? 'chip active' : 'chip'} onClick={() => onCategoryFilter('')}>
          All ({products.length})
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={categoryFilter === c ? 'chip active' : 'chip'}
            onClick={() => onCategoryFilter(c)}
          >
            {c} ({products.filter((p) => p.category === c).length})
          </button>
        ))}
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search products..."
        style={{ maxWidth: 280, marginTop: 8 }}
      />
    </>
  )
}
