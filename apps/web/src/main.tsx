import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { applyFavicon } from './brand.js';
import './styles.css';

applyFavicon();

if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('/sw.js').then(async () => {
    const ready = await navigator.serviceWorker.ready;
    // Guarda también lo que ya se descargó en esta visita, como las fuentes.
    ready.active?.postMessage({
      type: 'cache-assets',
      urls: performance.getEntriesByType('resource').map((entry) => entry.name),
    });
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      // Sin esto, al no haber señal las consultas se pausan y nunca fallan, y
      // recepción se quedaría cargando en lugar de usar su lista local.
      networkMode: 'always',
    },
    mutations: { networkMode: 'always' },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
