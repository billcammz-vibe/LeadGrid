// Reps view: per-rep performance cards + the add/edit rep modal.
import {$,repById,money} from './helpers.js';
import {LEADS,REPS,EVENTS,state} from './state.js';
import {ic} from './icons.js';
import {sb,dbError} from './sb.js';
import {renderRepFilter,render} from './router.js';

export function renderReps(){
  $('#v-reps').innerHTML=`<div class="viewhead"><div><div class="t">Sales Reps</div><div class="s">Team performance and territory load</div></div>
    <button class="btn" onclick="openRepModal()">${ic('plus','#fff')} Add rep</button></div>
    <div class="repgrid">${REPS.map(r=>{
      const rl=LEADS.filter(l=>l.rep===r.id);
      const won=rl.filter(l=>l.stage==='won');
      const closed=rl.filter(l=>['won','lost'].includes(l.stage)).length;
      const rate=closed?Math.round(won.length/closed*100):0;
      const pipe=rl.filter(l=>!['won','lost'].includes(l.stage)).reduce((s,l)=>s+l.value,0);
      const load=Math.min(rl.length/8*100,100);
      return `<div class="repcard">
        <div class="rh"><div class="rav" style="background:${r.color}">${r.init}</div><div class="rn"><b>${r.name}</b><small>${r.area}</small></div>
          <button class="btn ghost" style="padding:6px 10px;margin-left:auto" title="Edit rep" onclick="openRepModal('${r.id}')">${ic('badge','',14)}</button></div>
        <div class="repstats">
          <div class="rst"><div class="v">${rl.length}</div><div class="l">active leads</div></div>
          <div class="rst"><div class="v">${money(pipe)}</div><div class="l">pipeline</div></div>
          <div class="rst"><div class="v">${won.length}</div><div class="l">won</div></div>
          <div class="rst"><div class="v">${rate}%</div><div class="l">close rate</div></div>
        </div>
        <div style="font-size:11px;color:var(--muted);display:flex;justify-content:space-between"><span>Capacity</span><span>${Math.round(load)}%</span></div>
        <div class="repbar"><i style="width:${load}%"></i></div>
        <button class="btn ghost" style="width:100%;justify-content:center;margin-top:14px" onclick="state.rep='${r.id}';go('crm')">View ${r.name.split(' ')[0]}'s leads</button>
      </div>`;
    }).join('')}</div>`;
}
let _editingRepId=null;
export function openRepModal(id){
  _editingRepId=id||null;
  const r=id?repById(id):null;
  $('#repModalTitle').textContent=r?'Edit rep':'Add rep';
  $('#repName').value=r?r.name:'';
  $('#repInit').value=r?r.init:'';
  $('#repArea').value=r?r.area:'';
  $('#repColor').value=r?r.color:'#2F6BFF';
  $('#repModalError').style.display='none';
  $('#repDeleteBtn').style.display=r?'block':'none';
  $('#repModal').classList.add('open');
}
export function closeRepModal(){ $('#repModal').classList.remove('open'); _editingRepId=null; }
export function saveRepModal(){
  const name=$('#repName').value.trim(), init=$('#repInit').value.trim().toUpperCase()||name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const area=$('#repArea').value.trim(), color=$('#repColor').value;
  const err=$('#repModalError');
  if(!name){err.textContent='Name is required.';err.style.display='block';return;}
  let rep;
  if(_editingRepId){
    rep=repById(_editingRepId);
    Object.assign(rep,{name,init,area,color});
  }else{
    rep={id:'r_'+Date.now(),name,init,area,color};
    REPS.push(rep);
  }
  closeRepModal();
  renderRepFilter();
  render(state.view);
  sb.from('reps').upsert(rep).then(({error})=>{if(error)dbError('Failed to save rep — '+error.message);});
}
export function deleteRepFromModal(){
  if(!_editingRepId)return;
  const r=repById(_editingRepId);
  const assignedLeads=LEADS.filter(l=>l.rep===_editingRepId).length;
  const assignedEvents=EVENTS.filter(e=>e.repId===_editingRepId).length;
  if(assignedLeads>0||assignedEvents>0){
    const parts=[];
    if(assignedLeads>0)parts.push(`${assignedLeads} lead${assignedLeads===1?'':'s'}`);
    if(assignedEvents>0)parts.push(`${assignedEvents} meeting${assignedEvents===1?'':'s'}`);
    $('#repModalError').textContent=`Reassign or remove ${r.name}'s ${parts.join(' and ')} before deleting them.`;
    $('#repModalError').style.display='block';
    return;
  }
  const id=_editingRepId;
  const idx=REPS.findIndex(x=>x.id===id); if(idx>=0)REPS.splice(idx,1); // in-place so the shared REPS binding stays valid
  if(state.rep===id)state.rep='all';
  closeRepModal();
  renderRepFilter();
  render(state.view);
  sb.from('reps').delete().eq('id',id).then(({error})=>{if(error)dbError('Failed to delete rep — '+error.message);});
}
