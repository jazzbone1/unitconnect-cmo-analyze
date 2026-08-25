import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import SsoGate from './components/SsoGate'
import './styles.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root 엘리먼트를 찾을 수 없습니다.')

createRoot(rootEl).render(
  <StrictMode>
    <SsoGate>
      <App />
    </SsoGate>
  </StrictMode>,
)
