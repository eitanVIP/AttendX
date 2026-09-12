// The wordmark is black-on-transparent art, painted as a CSS mask filled
// with --accent rather than drawn as an <img> - that's what lets it follow
// the team's accent colour, and it replaces the dark-mode invert hack.
export default function Logo({ className = 'brand-logo' }) {
  return <span className={className} role="img" aria-label="AttendX" />
}
