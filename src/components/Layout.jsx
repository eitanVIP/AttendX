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

  // Sticky page toolbars (see .page-toolbar) need to sit right below the
  // sticky header, whose height varies (wraps on narrow widths, different
  // font metrics per OS) - so it's measured rather than hardcoded, same
  // pattern as the accent colour var in AuthContext.
  useEffect(() => {
    const header = headerRef.current
    const set = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)
    set()
    const observer = new ResizeObserver(set)
    observer.observe(header)
    return () => observer.disconnect()
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
