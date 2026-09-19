import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Dashboard } from './dashboard';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { SocketProvider } from './context/SocketContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <SocketProvider>
        <Dashboard />
      </SocketProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
