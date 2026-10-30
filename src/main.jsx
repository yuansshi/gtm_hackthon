import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import './styles.css';
import './industry.css';
import './workflow.css';
import './billing.css';
import IndustryApp from './IndustryApp';

createRoot(document.getElementById('root')).render(<IndustryApp />);
