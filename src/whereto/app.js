import '../platform/base.css';
import './whereto.css';
import { topbar } from '../platform/shell.js';
import { cleanId } from './ids.js';

// Whereto: /whereto/ makes a plan, /whereto/?p=<id> shows one.

topbar('Whereto');
const raw = new URLSearchParams(location.search).get('p');
const id = cleanId(raw);
if (id) import('./plan.js').then((m) => m.showPlan(id));
else if (raw) document.getElementById('missing').classList.remove('hidden');
else import('./create.js').then((m) => m.showCreate());
