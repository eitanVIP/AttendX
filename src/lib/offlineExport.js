// Exports a read-only, self-contained HTML snapshot of every page in the
// main admin nav - for looking things up with no internet (e.g. at a
// competition with no wifi). Deliberately does NOT cover individual student
// profiles (unbounded, one per student) or the student-facing area (it
// signs in through a separate, anonymous auth context that wouldn't just
// carry over into a same-origin iframe the way this admin session does).
//
// Each page is rendered for real, in a hidden same-origin iframe, so it
// shares this tab's already-signed-in Firebase session and shows real data
// - then frozen: every <script> stripped (there's no live app to boot once
// this is opened from disk, and no network to re-fetch Firestore from
// anyway), every loaded stylesheet's CSS inlined as plain text (the page's
// own /assets/*.css won't resolve under file://, which has no concept of a
// site root to resolve an absolute path against), and every absolute-path
// image/icon (the header logo, the favicon) inlined as a data URI for the
// same reason. The result is a plain HTML file: readable, not interactive,
// and stale from the moment it's saved - exactly what was asked for.
const PAGES = [
  { path: '/', slug: 'dashboard', label: 'Dashboard' },
  { path: '/students', slug: 'students', label: 'Students' },
  { path: '/sessions', slug: 'attendance', label: 'Attendance' },
  { path: '/trainings', slug: 'trainings', label: 'Trainings' },
  { path: '/certifications', slug: 'certifications', label: 'Certifications' },
  { path: '/inventory', slug: 'inventory', label: 'Inventory' },
  { path: '/orders', slug: 'orders', label: 'Orders' },
  { path: '/orders/purchases', slug: 'purchases', label: 'Bought items' },
  { path: '/systems', slug: 'systems', label: 'Systems' },
  { path: '/settings', slug: 'settings', label: 'Settings' },
  { path: '/settings/log', slug: 'system-log', label: 'System log' },
]

// What each nav link's real (in-app) href should point to once it's a
// sibling file on disk instead of a client-side route - a plain relative
// filename, not an absolute path, since there's no way to know from inside
// the browser what folder the user is about to save these into (the File
// System Access API deliberately never exposes a real filesystem path) and
// no need to: opened via file://, a bare "students.html" resolves against
// whatever folder the CURRENT file is sitting in, whichever one that turns
// out to be. A link to something outside PAGES (a student's own profile,
// "switch teams") is left as its original absolute path - it was never
// going to resolve offline anyway (see the module comment), so leaving it
// alone is more honest than silently pointing it at a file that isn't there.
const PATH_TO_FILENAME = Object.fromEntries(PAGES.map((p) => [p.path, `${p.slug}.html`]))

const IFRAME_WIDTH = 1280
const IFRAME_HEIGHT = 900
const READY_TIMEOUT_MS = 12000
const READY_POLL_MS = 200

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Waits until the iframe's own React app has actually mounted AND finished
// loading data - both ProtectedRoute's own auth-check and every page's own
// Firestore fetch render the same .page-loading class while pending, so
// this single check covers whichever one (or both, in sequence) is
// currently blocking. Resolves anyway past the timeout rather than
// rejecting - a slow page still gets a best-effort snapshot instead of
// failing the whole export.
function waitForReady(doc) {
  const start = Date.now()
  return new Promise((resolve) => {
    function check() {
      const stillLoading = doc.querySelector('.page-loading')
      const mounted = doc.querySelector('.app-shell')
      if ((mounted && !stillLoading) || Date.now() - start > READY_TIMEOUT_MS) {
        resolve()
        return
      }
      setTimeout(check, READY_POLL_MS)
    }
    check()
  })
}

function renderRoute(path) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = `position:fixed; top:-99999px; left:-99999px; width:${IFRAME_WIDTH}px; height:${IFRAME_HEIGHT}px; border:0;`
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out loading ${path}`))
    }, READY_TIMEOUT_MS + 5000)

    function cleanup() {
      clearTimeout(timeout)
      iframe.remove()
    }

    iframe.onload = async () => {
      try {
        await waitForReady(iframe.contentDocument)
        const html = await snapshot(iframe.contentDocument, iframe.contentWindow)
        cleanup()
        resolve(html)
      } catch (err) {
        cleanup()
        reject(err)
      }
    }
    document.body.appendChild(iframe)
    iframe.src = path
  })
}

const ABSOLUTE_URL_RE = /url\((['"]?)(\/[^)'"]+)\1\)/g

// Rewrites every url(/...) reference inside a chunk of CSS text (e.g. the
// header logo's mask-image) to a data URI, fetching each unique one at most
// once via the shared `cache` map.
async function inlineCssUrls(cssText, win, cache) {
  const urls = new Set()
  for (const m of cssText.matchAll(ABSOLUTE_URL_RE)) urls.add(m[2])
  await Promise.all([...urls].map((url) => fetchAsDataUrl(url, win, cache)))
  return cssText.replace(ABSOLUTE_URL_RE, (_match, quote, url) => `url(${quote}${cache.get(url) || url}${quote})`)
}

async function fetchAsDataUrl(url, win, cache) {
  if (cache.has(url)) return cache.get(url)
  try {
    const res = await win.fetch(url)
    const blob = await res.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    cache.set(url, dataUrl)
    return dataUrl
  } catch {
    cache.set(url, url) // leave the broken absolute path rather than fail the export
    return url
  }
}

async function snapshot(doc, win) {
  const cache = new Map()
  const clone = doc.documentElement.cloneNode(true)
  clone.querySelectorAll('script').forEach((s) => s.remove())

  const cssText = [...doc.styleSheets]
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((r) => r.cssText).join('\n')
      } catch {
        return '' // a cross-origin sheet (e.g. a Google Font) - can't read its rules, skip
      }
    })
    .join('\n')
  clone.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.remove())
  const style = doc.createElement('style')
  style.textContent = await inlineCssUrls(cssText, win, cache)
  clone.querySelector('head')?.appendChild(style)

  const assetEls = [...clone.querySelectorAll('img[src^="/"], link[rel="icon"][href^="/"]')]
  await Promise.all(
    assetEls.map(async (el) => {
      const attr = el.tagName === 'LINK' ? 'href' : 'src'
      el.setAttribute(attr, await fetchAsDataUrl(el.getAttribute(attr), win, cache))
    })
  )

  clone.querySelectorAll('a[href]').forEach((a) => {
    const filename = PATH_TO_FILENAME[a.getAttribute('href')]
    if (filename) a.setAttribute('href', filename)
  })

  const banner = doc.createElement('div')
  banner.textContent = `Offline snapshot (beta, partially works) - exported ${new Date().toLocaleString()} - read-only, may be out of date`
  banner.setAttribute(
    'style',
    'position:sticky; top:0; z-index:999; background:#dc2626; color:#fff; font:13px system-ui,sans-serif; padding:6px 14px; text-align:center;'
  )
  clone.querySelector('body')?.prepend(banner)

  return `<!doctype html>\n${clone.outerHTML}`
}

function triggerDownload(filename, html) {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function writeIntoDirectory(dirHandle, filename, html) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(html)
  await writable.close()
}

// `onProgress(current, total, label)` fires right before each page starts
// rendering. A page that fails to render (timeout, thrown error) is
// skipped rather than failing the whole export - its label comes back in
// the returned `failed` list.
//
// Where Chrome/Edge support it (the File System Access API - not in
// Firefox/Safari), this asks once up front for a folder and writes every
// page straight into it, so the internal links rewritten above actually
// resolve to real sibling files. Cancelling that picker aborts the whole
// export (`{ cancelled: true }`, nothing rendered) rather than silently
// falling back to loose downloads the user didn't ask for. Where the API
// isn't available at all, this falls back to one browser download per page
// (into an "attendx-offline" subfolder of Downloads, same as before) - the
// exported links still work AS LONG AS the browser saves every download
// into that same folder, which is its default behavior unless the user's
// "ask where to save each file" setting is on.
export async function exportOfflineSite(onProgress) {
  const failed = []
  let dirHandle = null
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    } catch (err) {
      if (err?.name === 'AbortError') return { failed: [], cancelled: true }
      dirHandle = null // picker failed for some other reason - fall back to downloads
    }
  }
  for (let i = 0; i < PAGES.length; i++) {
    const page = PAGES[i]
    onProgress?.(i + 1, PAGES.length, page.label)
    try {
      const html = await renderRoute(page.path)
      const filename = `${page.slug}.html`
      if (dirHandle) {
        await writeIntoDirectory(dirHandle, filename, html)
      } else {
        triggerDownload(`attendx-offline/${filename}`, html)
        await sleep(350) // gives the browser room to actually start each download before the next
      }
    } catch {
      failed.push(page.label)
    }
  }
  return { failed }
}
