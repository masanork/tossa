import { mount } from 'svelte';
import 'leaflet/dist/leaflet.css';
import './app.css';
import App from './App.svelte';
import { registerOutboxClient } from './lib/outboxCompatibility';

// Respond to the active worker's compatibility check before App can open or
// migrate the offline outbox during startup.
registerOutboxClient();

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Register Service Worker for PWA and offline resilience
if (
  'serviceWorker' in navigator &&
  !window.location.host.includes('localhost:5173')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((err) => {
        console.warn('ServiceWorker registration failed:', err);
      });
  });
}

export default app;
