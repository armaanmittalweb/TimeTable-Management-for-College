import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Embed from './Embed';
import './styles/base.css';
import './styles/station.css';
import './styles/board.css';
import './styles/control.css';
import './styles/embed.css';

const isEmbed = /^\/embed\/?$/.test(location.pathname);

createRoot(document.getElementById('root')!).render(<StrictMode>{isEmbed ? <Embed /> : <App />}</StrictMode>);
