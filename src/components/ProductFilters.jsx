// Shared by Inventory and Orders: category chips (counts against the full
// list, unaffected by the search box) plus a free-text search box (see
// productMatchesSearch in calc.js for what it matches against). Picking a
// category that has subcategories (team.subcategories, set in Settings)
// adds a second row of chips narrowing it further - counted within that
// category only.
export default function ProductFilters({
  products,
  categories,
  categoryFilter,
  onCategoryFilter,
  subcategories = {},
  subcategoryFilter = '',
  onSubcategoryFilter,
  search,
  onSearch,
}) {
  const categorySubs = (categoryFilter && subcategories[categoryFilter]) || []
  const inCategory = categorySubs.length > 0 ? products.filter((p) => p.category === categoryFilter) : []

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
      {categorySubs.length > 0 && onSubcategoryFilter && (
        <div className="filter-row" style={{ marginTop: 6 }}>
          <button className={!subcategoryFilter ? 'chip active' : 'chip'} onClick={() => onSubcategoryFilter('')}>
            All {categoryFilter} ({inCategory.length})
          </button>
          {categorySubs.map((s) => (
            <button
              key={s}
              className={subcategoryFilter === s ? 'chip active' : 'chip'}
              onClick={() => onSubcategoryFilter(s)}
            >
              {s} ({inCategory.filter((p) => p.subcategory === s).length})
            </button>
          ))}
        </div>
      )}
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
