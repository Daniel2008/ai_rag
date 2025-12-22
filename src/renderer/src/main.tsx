import 'antd/dist/reset.css'
import '@ant-design/x-markdown/themes/light.css'
import '@ant-design/x-markdown/themes/dark.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
