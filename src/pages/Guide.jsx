import { useEffect } from 'react'
import GuideView from '../components/GuideView'
import { ADMIN_GUIDE } from '../lib/guide'

// The admin guide (a top-bar tab).
export default function Guide() {
  useEffect(() => {
    document.title = 'AttendX | Guide'
  }, [])
  return <GuideView title="Guide" intro="How AttendX works, page by page. Search, or jump to a section." sections={ADMIN_GUIDE} />
}
