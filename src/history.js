// Per-lead activity log (the lead_history table). Kept as its own module so data.js, drawer.js,
// dashboard.js and outreach.js can all record/read history without an import cycle — this file
// imports only from sb.js and state.js.
import {sb,dbError} from './sb.js';
import {HISTORY} from './state.js';

export const HISTORY_KINDS={
  created:{label:'Added',color:'#7C8AA0'},
  stage_change:{label:'Stage',color:'#F5A524'},
  note:{label:'Note',color:'#4D9FFF'},
  next_action:{label:'Next step',color:'#A855F7'},
  email_drafted:{label:'Outreach',color:'#22C55E'},
};

export function dbHistoryToClient(r){
  return {id:r.id,leadId:r.lead_id,at:new Date(r.at),kind:r.kind,body:r.body||'',meta:r.meta||{}};
}
export const historyFor=leadId=>HISTORY.filter(h=>h.leadId===leadId).sort((a,b)=>b.at-a.at);
export const recentHistory=n=>[...HISTORY].sort((a,b)=>b.at-a.at).slice(0,n);

// Optimistic: push to the in-memory log now, persist in the background. The DB assigns the real
// uuid; the temp id is only a render key until the next full load replaces these rows.
export function addHistory(leadId,kind,body,meta){
  const row={id:'h_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    leadId,at:new Date(),kind,body:body||'',meta:meta||{}};
  HISTORY.push(row);
  sb.from('lead_history').insert({lead_id:leadId,kind,body:body||null,meta:meta||{}})
    .then(({error})=>{if(error)dbError('Failed to save history — '+error.message);});
  return row;
}
export function dropHistoryFor(leadId){
  for(let i=HISTORY.length-1;i>=0;i--){if(HISTORY[i].leadId===leadId)HISTORY.splice(i,1);}
}
