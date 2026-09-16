import { mount } from 'svelte';
import 'leaflet/dist/leaflet.css';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

// Register Service Worker for PWA and offline resilience
if (
  'serviceWorker' in navigator &&
  !window.location.host.includes('localhost:5173')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('ServiceWorker registration failed:', err);
    });
  });
}

export default app;
