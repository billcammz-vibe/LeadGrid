// View router + the two bits of chrome that every view touches (CRM count badge, rep filter).
import {$} from './helpers.js';
import {state,LEADS,REPS} from './state.js';
import {renderDash} from './dashboard.js';
import {renderCRM} from './crm.js';
import {renderFinder} from './finder.js';
import {renderCal} from './calendar.js';
import {renderReps} from './reps.js';

export function go(view){
  state.view=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));
  document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active',a.dataset.view===view));
  $('#crumb').textContent={dashboard:'Dashboard',crm:'CRM',finder:'Lead Finder',calendar:'Calendar',reps:'Sales Reps'}[view];
  render(view);
}
export function render(view){({dashboard:renderDash,crm:renderCRM,finder:renderFinder,calendar:renderCal,reps:renderReps}[view])();updateBadges();}
export function updateBadges(){$('#nb-crm').textContent=LEADS.length;}

export function renderRepFilter(){
  const sel=$('#repfilter'), keep=sel.value;
  sel.innerHTML='<option value="all">All reps</option>'+REPS.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  sel.value=REPS.some(r=>r.id===keep)?keep:'all';
  if(sel.value!==keep){state.rep=sel.value;}
}
