import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CrashBoundary from './CrashBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </React.StrictMode>,
);
