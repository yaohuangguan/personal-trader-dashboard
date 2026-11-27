import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {InAppReaderProvider} from './components/InAppReader';
import ErrorBoundary from './components/ErrorBoundary';
import './component-styles';
import {t} from './preferences';
import './styles.css';
import './neutral.css';
import './readability.css';
import './pinned-desk.css';
import './light-theme.css';
import './ux.css';

const crashed=()=> <div className="app-crash" role="alert"><h1>{t('页面遇到错误')}</h1><p>{t('自选、分组与设置仍保存在本机。')}</p><button type="button" onClick={()=>location.reload()}>{t('重新加载')}</button></div>;
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary fallback={crashed}><InAppReaderProvider><App /></InAppReaderProvider></ErrorBoundary></React.StrictMode>
);
