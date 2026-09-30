import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Embed from './Embed';
import { countViews } from './beacon';
import './styles/base.css';
import './styles/station.css';
import './styles/board.css';
import './styles/control.css';
import './styles/embed.css';

const isEmbed = /^\/embed\/?$/.test(location.pathname);
countViews('edusched');

createRoot(document.getElementById('root')!).render(<StrictMode>{isEmbed ? <Embed /> : <App />}</StrictMode>);
