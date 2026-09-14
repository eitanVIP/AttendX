import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { useStudentAuth } from '../context/StudentAuthContext'
import Logo from './Logo'

const links = [
  { to: '/log-hours', label: 'Community Hours' },
  { to: '/request-order', label: 'Request Order' },
  { to: '/my-systems', label: 'My Systems' },
  { to: '/my-profile', label: 'My Profile' },
]

// The student equivalent of Layout.jsx (the admin shell) - same header/
// nav/drawer markup and CSS classes for a consistent look, just with the
// three student tabs instead of the admin's, and "Log out" clearing the
// student session (see StudentAuthContext) instead of the real Firebase
// Auth one. Skips Layout's sticky-toolbar height measuring - these pages
// are plain forms, not the scrolling data tables that needs it for. Needs
// BOTH a verified team and a chosen student - either missing sends back to
// /student-login, which shows whichever of its two steps is still needed.
export default function StudentLayout() {
  const { verified, studentId, student, changeStudent, logout } = useStudentAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (!verified || !studentId) return <Navigate to="/student-login" replace />

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="nav-toggle" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <span />
          <span />
          <span />
        </button>
        <div className="brand">
          <Link to="/log-hours" className="brand-logo-link" title="Community Hours">
            <Logo />
          </Link>
          {verified.teamName && <span className="brand-team">{verified.teamName}</span>}
          <Link to="/student-login" className="brand-team" onClick={changeStudent} title="Not you? Change student">
            {student?.fullName}
          </Link>
        </div>
        <nav className="main-nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
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
            <Link to="/log-hours" className="brand-logo-link" onClick={() => setDrawerOpen(false)}>
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
