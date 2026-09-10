// Calendar view: weekly meeting grid + the meeting editor modal.
import {$,leadById,repById} from './helpers.js';
import {EVENTS,LEADS,REPS,state} from './state.js';
import {ic} from './icons.js';
import {sb,dbError} from './sb.js';
import {clientEventToDb} from './data.js';
import {openConfirm} from './drawer.js';

function mondayOf(offsetWeeks){
  const now=new Date();
  const diffToMonday=now.getDay()===0?-6:1-now.getDay();
  const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()+diffToMonday+offsetWeeks*7);
  monday.setHours(0,0,0,0);
  return monday;
}
const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
export function renderCal(){
  const hours=[9,10,11,12,13,14,15,16];
  const dayLabels=['Mon','Tue','Wed','Thu','Fri'];
  const monday=mondayOf(state.calWeekOffset);
  const weekDates=[0,1,2,3,4].map(i=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d;});
  const fmt=d=>d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const evs=EVENTS.filter(e=>(state.rep==='all'||e.repId===state.rep)&&weekDates.some(d=>sameDay(e.startsAt,d)));
  let cells='';
  cells+='<div class="ch corner"></div>'+weekDates.map((d,i)=>`<div class="ch">${dayLabels[i]}<small>${fmt(d)}</small></div>`).join('');
  hours.forEach(h=>{
    cells+=`<div class="hr">${h}:00</div>`;
    weekDates.forEach(d=>{
      const dayEvents=evs.filter(e=>sameDay(e.startsAt,d)&&e.startsAt.getHours()===h);
      const evHtml=dayEvents.map(e=>{
        const l=leadById(e.leadId),r=repById(e.repId);
        if(!l||!r)return'';
        return`<div class="ev" style="background:${r.color}" onclick="openLead('${e.leadId}')">
          <button class="evdel" onclick="event.stopPropagation();askDeleteMeeting('${e.id}')" title="Delete meeting">${ic('x','',10)}</button>
          ${e.type}<small>${l.name}</small></div>`;
      }).join('');
      cells+=`<div class="cell">${evHtml}</div>`;
    });
  });
  const weekLabel=state.calWeekOffset===0?'This week':fmt(weekDates[0])+' – '+fmt(weekDates[4]);
  $('#v-calendar').innerHTML=`<div class="viewhead"><div><div class="t">Calendar</div><div class="s">${weekLabel} · ${evs.length} meeting${evs.length===1?'':'s'} scheduled</div></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn ghost" style="padding:8px 12px" onclick="state.calWeekOffset--;renderCal()">‹</button>
      <button class="btn ghost" style="padding:8px 14px;font-size:12px" onclick="state.calWeekOffset=0;renderCal()">Today</button>
      <button class="btn ghost" style="padding:8px 12px" onclick="state.calWeekOffset++;renderCal()">›</button>
      <button class="btn" onclick="openMeetingModal()">${ic('plus')} New meeting</button>
    </div></div>
    <div class="calwrap"><div class="calgrid">${cells}</div></div>`;
}
export function openMeetingModal(){
  const open=LEADS.filter(l=>!['won','lost'].includes(l.stage));
  if(!open.length){dbError('Add a lead before scheduling a meeting.');return;}
  if(!REPS.length){dbError('Add a rep before scheduling a meeting — see the Reps tab.');return;}
  $('#meetLead').innerHTML=open.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  $('#meetRep').innerHTML=REPS.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  $('#meetHour').innerHTML=[9,10,11,12,13,14,15,16].map(h=>`<option value="${h}">${h}:00</option>`).join('');
  $('#meetDate').value=new Date().toISOString().slice(0,10);
  $('#meetModalError').style.display='none';
  onMeetLeadChange();
  $('#meetingModal').classList.add('open');
}
export function onMeetLeadChange(){const l=leadById($('#meetLead').value);if(l)$('#meetRep').value=l.rep;}
export function closeMeetingModal(){$('#meetingModal').classList.remove('open');}
export function saveMeetingModal(){
  const leadId=$('#meetLead').value,repId=$('#meetRep').value,type=$('#meetType').value;
  const dateStr=$('#meetDate').value,hour=+$('#meetHour').value;
  const err=$('#meetModalError');
  if(!leadId||!repId||!dateStr){err.textContent='Fill in every field.';err.style.display='block';return;}
  const[y,m,d]=dateStr.split('-').map(Number);
  const ev={id:'e_'+Date.now(),leadId,repId,type,startsAt:new Date(y,m-1,d,hour,0,0,0),durationMinutes:30};
  EVENTS.push(ev);
  closeMeetingModal();
  renderCal();
  sb.from('events').insert(clientEventToDb(ev)).select().single().then(({data,error})=>{
    if(error){dbError('Failed to save meeting — '+error.message);return;}
    ev.id=data.id; // swap the temp client-side id for the real DB-generated uuid
  });
}
export function askDeleteMeeting(id){openConfirm('Delete this meeting? This can’t be undone.',()=>deleteMeeting(id));}
function deleteMeeting(id){
  const i=EVENTS.findIndex(e=>e.id===id); if(i<0)return;
  EVENTS.splice(i,1);
  renderCal();
  sb.from('events').delete().eq('id',id).then(({error})=>{if(error)dbError('Failed to delete meeting — '+error.message);});
}
