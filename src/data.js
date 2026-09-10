// Supabase data layer + lead lifecycle. Client arrays are the source of truth for rendering; this
// module keeps them synced with Supabase. Mutations update the array and re-render immediately,
// then persist in the background; a failed write surfaces via dbError() instead of vanishing. No
// rollback-on-failure or realtime multi-tab sync — this is a single-owner tool.
import {sb,dbError,apiFetch} from './sb.js';
import {LEADS,REPS,EVENTS,addedProspects,state} from './state.js';
import {leadById,prospectById} from './helpers.js';
import {ic} from './icons.js';
import {updateBadges,render} from './router.js';
import {drawMarkers,showBizPanel,map} from './maps.js';
import {closeDrawer,openLead} from './drawer.js';
import {renderCRM} from './crm.js';

export function dbLeadToClient(row){
  return{id:row.id,sourceId:row.source_id,name:row.name,cat:row.cat,city:row.city,
    province:row.province,postal:row.postal,street:row.street,address:row.address,
    lat:row.lat,lng:row.lng,phone:row.phone,website:row.website,web:row.web,
    rating:row.rating,reviewCount:row.review_count,value:row.value,email:row.email,
    socials:row.socials||{},reviews:row.reviews||[],hot:row.hot,score:row.score,
    stage:row.stage,rep:row.rep_id,
    _enrichChecked:row.enrich_checked,_enrichOk:row.enrich_ok,_enrichNote:row.enrich_note,
    createdAt:row.created_at,updatedAt:row.updated_at};
}
export function clientLeadToDb(l){
  return{id:l.id,source_id:l.sourceId||null,name:l.name,cat:l.cat,city:l.city,
    province:l.province,postal:l.postal,street:l.street,address:l.address,
    lat:l.lat,lng:l.lng,phone:l.phone,website:!!l.website,web:l.web,
    rating:l.rating,review_count:l.reviewCount,value:l.value,email:l.email,
    socials:l.socials||{},reviews:l.reviews||[],hot:!!l.hot,score:l.score,
    stage:l.stage,rep_id:l.rep||null,
    enrich_checked:!!l._enrichChecked,enrich_ok:l._enrichOk==null?null:!!l._enrichOk,enrich_note:l._enrichNote||null};
}
export function dbEventToClient(row){
  return{id:row.id,leadId:row.lead_id,repId:row.rep_id,type:row.type,startsAt:new Date(row.starts_at),durationMinutes:row.duration_minutes};
}
export function clientEventToDb(e){
  return{lead_id:e.leadId,rep_id:e.repId,type:e.type,starts_at:e.startsAt.toISOString(),duration_minutes:e.durationMinutes||30};
}
export async function loadAllData(retrying){
  try{
    const[repsRes,leadsRes,eventsRes]=await Promise.all([
      sb.from('reps').select('*').order('created_at'),
      sb.from('leads').select('*').order('created_at'),
      sb.from('events').select('*').order('starts_at'),
    ]);
    if(repsRes.error)throw repsRes.error;
    if(leadsRes.error)throw leadsRes.error;
    if(eventsRes.error)throw eventsRes.error;
    REPS.length=0;REPS.push(...repsRes.data);
    LEADS.length=0;LEADS.push(...leadsRes.data.map(dbLeadToClient));
    EVENTS.length=0;EVENTS.push(...eventsRes.data.map(dbEventToClient));
    addedProspects.clear();
    LEADS.forEach(l=>{if(l.sourceId)addedProspects.add(l.sourceId);});
  }catch(err){
    // Right after sign-in, Supabase's auth service and database can be a moment out of sync,
    // so a brand-new token's `iat` sometimes lands ahead of the database's clock — a transient
    // "JWT issued at future" from PostgREST that clears itself within a second. Retry once
    // before bothering the user with it.
    if(!retrying&&/issued at future/i.test(err.message||'')){
      await new Promise(r=>setTimeout(r,1500));
      return loadAllData(true);
    }
    dbError('Failed to load your data — '+err.message);
  }
}

/* ---- lead creation / dedup ---- */
// least-loaded rep gets each new lead — shared by every place a prospect becomes a CRM lead
export function pickRepForNewLead(){
  if(!REPS.length)return null;
  return REPS.reduce((best,r)=>{const n=LEADS.filter(l=>l.rep===r.id).length;return n<best.n?{r,n}:best;},{r:REPS[0],n:1e9}).r;
}
// A prospect is identified by its Google Place id (stored as sourceId). Guard every add-to-CRM
// path against re-adding the same one — otherwise a double-click, or the same business surfacing
// in a later search, quietly creates duplicate leads.
export const alreadyInCRM=sourceId=>addedProspects.has(sourceId)||LEADS.some(l=>l.sourceId===sourceId);
// Insert a new lead, tolerating a race where the same sourceId was inserted by another session/
// device: the DB's unique index on source_id rejects the duplicate (code 23505), which just means
// "already in CRM" — not an error worth alarming the user about.
export function saveNewLead(nl,sourceId){
  sb.from('leads').insert(clientLeadToDb(nl)).then(({error})=>{
    if(!error)return;
    if(error.code==='23505'){addedProspects.add(sourceId);return;}
    dbError('Failed to save lead — '+error.message);
  });
}
export function addProspectToCRM(pid){
  const p=prospectById(pid);if(!p)return;
  if(alreadyInCRM(pid)){const ex=LEADS.find(l=>l.sourceId===pid);if(ex)showBizPanel('lead',ex.id);return;}
  const rep=pickRepForNewLead();
  if(!rep){dbError('Add a rep before adding leads to your CRM — see the Reps tab.');return;}
  addedProspects.add(pid);
  const nl={...p,id:'l_'+pid+'_'+Date.now(),sourceId:pid,stage:'new',rep:rep.id};
  LEADS.push(nl);
  updateBadges();
  drawMarkers();
  showBizPanel('lead',nl.id);
  saveNewLead(nl,pid);
}

/* ---- enrichment persistence ---- */
export function persistEnrich(kind,id,b){
  if(kind!=='lead')return; // prospects are pre-CRM and never touch Supabase
  sb.from('leads').update({socials:b.socials||{},enrich_checked:true,enrich_ok:b._enrichOk,enrich_note:b._enrichNote}).eq('id',id)
    .then(({error})=>{if(error)dbError('Failed to save enrichment — '+error.message);});
}
export async function reEnrich(kind,id){
  const b=kind==='lead'?leadById(id):prospectById(id);
  if(!b)return;
  b._enrichChecked=true;
  const note=document.querySelector('#bizpopup .enrichnote');
  const relink=`<a onclick="reEnrich('${kind}','${id}')">Re-enrich</a>`;
  if(note)note.innerHTML=ic('spark','#A855F7',12)+' '+(b.web?'Scraping '+b.web.replace('https://',''):'Searching for '+b.name)+'…';
  try{
    const qs=new URLSearchParams({url:b.web||'',name:b.name||'',city:b.city||''});
    const res=await apiFetch('/api/socials?'+qs.toString());
    const data=await res.json();
    if(data.error){
      b._enrichOk=false; b._enrichNote=data.error;
      if(note)note.innerHTML=ic('link','#5C6E8A',12)+' '+data.error+' · '+relink;
      persistEnrich(kind,id,b);
      return;
    }
    b.socials=b.socials||{};
    if(data.instagram){b.socials.instagram=data.instagram;b.socials.instagramSource=data.instagramSource;}
    if(data.facebook){b.socials.facebook=data.facebook;b.socials.facebookSource=data.facebookSource;}
    const found=[data.instagram&&'Instagram',data.facebook&&'Facebook'].filter(Boolean);
    const anyUnverified=data.instagramSource==='search'||data.facebookSource==='search';
    b._enrichOk=true;
    b._enrichNote=found.length?found.join(' & ')+' found'+(anyUnverified?' (via search — please verify)':''):'No social links found';
    if(document.getElementById('bizpopup'))showBizPanel(kind,id); // re-render with the new socials + note
    else if(note)note.innerHTML=ic('check','#22C55E',12)+' '+b._enrichNote+' · '+relink;
    if(state.view==='crm')renderCRM();
    persistEnrich(kind,id,b);
  }catch(err){
    b._enrichOk=false; b._enrichNote='Scrape failed — '+err.message;
    if(note)note.innerHTML=ic('link','#5C6E8A',12)+' Scrape failed — '+err.message+' · '+relink;
    persistEnrich(kind,id,b);
  }
}

/* ---- lead mutation ---- */
export function deleteLead(id){
  const i=LEADS.findIndex(l=>l.id===id); if(i<0)return;
  // if this lead came from a map prospect or a Lead Finder search, free it so it can resurface
  if(LEADS[i].sourceId)addedProspects.delete(LEADS[i].sourceId);
  LEADS.splice(i,1);
  for(let j=EVENTS.length-1;j>=0;j--){if(EVENTS[j].leadId===id)EVENTS.splice(j,1);} // DB cascades the row; array doesn't auto-sync
  closeDrawer(); updateBadges();
  if(state.view==='areas'&&map){drawMarkers();} else {render(state.view);}
  sb.from('leads').delete().eq('id',id).then(({error})=>{if(error)dbError('Failed to delete lead — '+error.message);});
}
export function setStage(id,stage){
  const l=leadById(id); l.stage=stage; openLead(id); render(state.view);
  sb.from('leads').update({stage}).eq('id',id).then(({error})=>{if(error)dbError('Failed to save stage change — '+error.message);});
}
