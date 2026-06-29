import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './lib/push-notifications'
import { installConsoleBuffer } from './lib/consoleBuffer'
import { maybeDevAutoLogin } from './lib/devAutoLogin'

// Capture recent console errors for feedback reports (must run before app code).
installConsoleBuffer()

// DEV-only: optionally populate a real session before mount (no-op in prod
// builds and unless VITE_DEV_AUTOLOGIN=1 with credentials in .env.local).
maybeDevAutoLogin().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})

// Register push notification service worker
registerServiceWorker()
