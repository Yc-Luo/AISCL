import { BrowserRouter } from 'react-router-dom'
import { Router } from './router'
import { ToastViewport } from './components/ui/Toast'

function App() {
  return (
    <BrowserRouter>
      <Router />
      <ToastViewport />
    </BrowserRouter>
  )
}

export default App
