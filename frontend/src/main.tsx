import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode removed — it causes useEffect to fire twice in dev,
// which results in duplicate socket join-room calls and doubled avatars.
createRoot(document.getElementById('root')!).render(<App />)
