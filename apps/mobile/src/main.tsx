import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installConsoleBuffer } from './lib/consoleBuffer'

// Capture recent console errors for feedback reports (must run before app code).
installConsoleBuffer()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
