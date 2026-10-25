import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {InAppReaderProvider} from './components/InAppReader';
import './styles.css';
import './neutral.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><InAppReaderProvider><App /></InAppReaderProvider></React.StrictMode>
);
