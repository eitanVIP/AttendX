import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // `npm test` - the unit tests next to the code they cover (src/**/*.test.js).
  // They are the gate every change has to pass before it can reach dev or
  // main (see .github/workflows/ci.yml and deploy.yml).
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    // A fixed zone so date maths behaves the same on every machine and on CI.
    env: { TZ: 'Asia/Jerusalem' },
  },
})
