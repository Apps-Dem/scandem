import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import Admin from './Admin';
import './styles.css';

registerSW({ immediate: true });
const isAdmin = window.location.pathname.replace(/\/$/, '') === '/admin';
createRoot(document.getElementById('root')!).render(<StrictMode>{isAdmin ? <Admin /> : <App />}</StrictMode>);
