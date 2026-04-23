// React import not needed when not using JSX transform or StrictMode
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  // NOTE: React.StrictMode disabled temporarily because it causes issues with
  // WeaveProvider from @inditextech/weave-react. StrictMode's double-mount behavior
  // triggers the store's disconnect() before the WebSocket connection is established,
  // corrupting the Y.js document state.
  // TODO: Re-enable when Weave.js or our integration is updated to handle Strict Mode.
  <App />,
)

