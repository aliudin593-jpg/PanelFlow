import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from '@/components/theme-provider';

// Global error handling to catch "Object" exceptions
window.addEventListener('error', (event) => {
  if (event.error && typeof event.error === 'object' && !(event.error instanceof Error)) {
    console.error('Global Error (Object):', JSON.stringify(event.error));
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && typeof event.reason === 'object' && !(event.reason instanceof Error)) {
    console.error('Unhandled Rejection (Object):', JSON.stringify(event.reason));
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="panelflow-ui-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
