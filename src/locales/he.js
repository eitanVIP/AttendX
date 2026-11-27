// Hebrew text, keyed by the English text used in the code (see lib/i18n.js).
// Split by area so each rollout step touches its own file. Keep {variables}
// exactly as in the English key. A missing key just shows in English, so it is
// fine for these files to grow page by page.
import common from './he/common'
import student from './he/student'
import tasks from './he/tasks'

export default { ...common, ...student, ...tasks }
