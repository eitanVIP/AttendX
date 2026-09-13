import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/students', label: 'Students' },
  { to: '/sessions', label: 'Attendance' },
  { to: '/trainings', label: 'Trainings' },
  { to: '/certifications', label: 'Certifications' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { team, memberships, logout } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const headerRef = useRef(null)

  // Sticky page toolbars (see .page-toolbar) sit right below the sticky
  // header, and each table's own header row sticks right below whichever
  // of those the current page has - all three heights vary (wrapping,
  // font metrics, whether a page even has a toolbar/filter row), so
  // they're measured rather than hardcoded, same pattern as the accent
  // colour var in AuthContext. --sticky-top is the combined header +
  // toolbar height table headers use; --header-h (just the header) is what
  // the toolbar itself sticks to.
  //
  // The toolbar is watched via MutationObserver rather than a ref, because
  // every page that has one renders a loading placeholder (no toolbar in
  // the DOM at all) until its Firestore data arrives, and route changes
  // swap in a different page under the same Layout instance - a plain
  // effect keyed on the route would measure too early and never notice it
  // showing up moments later.
  useEffect(() => {
    const header = headerRef.current
    let toolbarObserver = null
    let currentToolbar = null

    function measure() {
      const headerH = header.offsetHeight
      document.documentElement.style.setProperty('--header-h', `${headerH}px`)
      document.documentElement.style.setProperty('--sticky-top', `${headerH + (currentToolbar?.offsetHeight || 0)}px`)
    }

    function syncToolbar() {
      const el = document.querySelector('.page-toolbar')
      if (el === currentToolbar) return
      toolbarObserver?.disconnect()
      currentToolbar = el
      if (el) {
        toolbarObserver = new ResizeObserver(measure)
        toolbarObserver.observe(el)
      }
      measure()
    }

    const headerObserver = new ResizeObserver(measure)
    headerObserver.observe(header)

    const bodyObserver = new MutationObserver(syncToolbar)
    bodyObserver.observe(document.querySelector('.app-main'), { childList: true, subtree: true })
    syncToolbar()

    return () => {
      headerObserver.disconnect()
      bodyObserver.disconnect()
      toolbarObserver?.disconnect()
    }
  }, [])

  useEffect(() => {
    const current = links.find((l) =>
      l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)
    )
    document.title = current ? `AttendX | ${current.label}` : 'AttendX'
  }, [location.pathname])

  return (
    <div className="app-shell">
      <header className="app-header" ref={headerRef}>
        <button className="nav-toggle" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <span />
          <span />
          <span />
        </button>
        <div className="brand">
          <Link to="/" className="brand-logo-link" title="Dashboard">
            <Logo />
          </Link>
          <Link to="/teams" className="brand-team" title="Switch teams">
            {team?.name || team?.id}
            {memberships.length > 1 ? ` (+${memberships.length - 1})` : ''}
          </Link>
        </div>
        <nav className="main-nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button className="logout-btn" onClick={logout}>
          Log out
        </button>
      </header>

      <div
        className={`nav-drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        inert={drawerOpen ? undefined : true}
      >
        <nav className="nav-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="nav-drawer-header">
            <Link to="/" className="brand-logo-link" onClick={() => setDrawerOpen(false)}>
              <Logo />
            </Link>
            <button className="nav-drawer-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
              &times;
            </button>
          </div>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setDrawerOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
