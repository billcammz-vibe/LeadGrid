// Client Hunter view: a team of 12 Claudes finds the next paying client. The browser drives the
// pipeline one stage per request to /api/hunt (see api/lib/hunter.js for what each stage does):
//   8 scouts search the live web -> the Teardown opens every proof link and removes weak leads ->
//   3 judges score survivors -> all 12 vote alone -> all 12 final-check -> drafts for the top 3.
// Nothing is ever sent: results are drafts the user copies. Winners can be added to the CRM.
import {$,esc,escAttr,hash} from './helpers.js';
import {ic} from './icons.js';
import {LEADS,addedProspects} from './state.js';
import {sb,apiFetch,dbError} from './sb.js';
import {pickRepForNewLead,alreadyInCRM,saveNewLead} from './data.js';
import {updateBadges} from './router.js';

/* ---- brief (saved in Supabase, editable per hunt) ---- */
const DEFAULT_BRIEF={
  offer:'Booking-ready websites plus review and follow-up automation for local businesses',
  price:'',
  idealClient:'Local businesses of any type that rely on phone calls and bookings',
  area:'Toronto, ON',
  proof:'',
  senderName:'John Albano',senderCompany:'OmniGrid Digital',senderSite:'omnigriddigital.ca',senderCity:'Toronto',
};
const H={brief:{...DEFAULT_BRIEF},run:null,history:[],historyLoaded:false};

export async function loadHunterBrief(){
  try{
    const {data,error}=await sb.from('hunter_settings').select('brief').eq('id','default').maybeSingle();
    if(error)throw error;
    if(data&&data.brief)H.brief={...DEFAULT_BRIEF,...data.brief};
  }catch(err){
    // Table not created yet (migration not applied) — the hunter still works with the defaults.
    console.warn('[hunter] could not load saved brief:',err.message);
  }
}
// Who outreach emails are from — comes from the saved brief (see api/lib/generateEmail.js).
export const hunterSender=()=>({name:H.brief.senderName,company:H.brief.senderCompany,site:H.brief.senderSite,city:H.brief.senderCity});

const FIELDS={offer:'hb-offer',price:'hb-price',idealClient:'hb-ideal',area:'hb-area',proof:'hb-proof',
  senderName:'hb-name',senderCompany:'hb-company',senderSite:'hb-site',senderCity:'hb-city'};
function readBrief(){
  const b={...H.brief};
  Object.entries(FIELDS).forEach(([k,id])=>{const el=document.getElementById(id);if(el)b[k]=el.value.trim();});
  return b;
}
export async function saveHunterBrief(){
  const brief=readBrief(); H.brief=brief;
  const {error}=await sb.from('hunter_settings').upsert({id:'default',brief,updated_at:new Date().toISOString()});
  if(error)dbError('Could not save the brief — '+error.message+' (has the client_hunter migration been applied?)');
  else{const b=$('#hb-saved');if(b){b.textContent='Saved ✓';setTimeout(()=>{if(b)b.textContent='';},2500);}}
}

/* ---- team ---- */
const SCOUTS=[
  {id:1,name:'New openings'},{id:2,name:'Asking for help'},{id:3,name:'Bad reviews'},{id:4,name:'Old websites'},
  {id:5,name:'Freelance jobs'},{id:6,name:'Hiring now'},{id:7,name:'Growing fast'},{id:8,name:'No replies'}];
const JUDGES=[{id:'budget',name:'Budget'},{id:'fit',name:'Fit'},{id:'timing',name:'Timing'}];
const VOTERS=[
  ...SCOUTS.map(s=>({id:'scout'+s.id,label:`Scout ${s.id} (${s.name})`,scoutId:s.id})),
  {id:'teardown',label:'the Teardown critic'},
  ...JUDGES.map(j=>({id:'judge-'+j.id,label:`the ${j.name} judge`})),
];
const REMOVAL_LABEL={
  not_real:"the business wasn't real, was closed, or the link was dead",
  proof_mismatch:"the proof didn't show what the scout claimed",
  stale:'the signal was more than 60 days old',
  chain:"it was a large chain that won't hire someone like you",
  already_served:'someone is already doing this job well for them',
  duplicate:'it duplicated another lead',
  cant_afford:"it clearly couldn't afford your price",
  unverifiable:"the proof link couldn't be opened to check",
};
const CANCEL=new Error('Hunt stopped');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safeHref=u=>/^https?:\/\//i.test(u||'')?u:'';
const host=u=>{try{return new URL(u).host.replace(/^www\./,'');}catch{return u||'';}};
const leadKey=l=>host(l.link)+'|'+(()=>{try{return new URL(l.link).pathname.replace(/\/+$/,'');}catch{return '';}})();
const nameKey=l=>(l.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');

async function callStage(r,stage,payload,tries=2){
  for(let i=0;;i++){
    if(r.cancelled)throw CANCEL;
    try{
      const res=await apiFetch('/api/hunt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage,...payload})});
      const data=await res.json().catch(()=>({}));
      if(res.ok)return data;
      const err=new Error(data.error||(res.status+' '+res.statusText)); err.status=res.status;
      if(i<tries-1&&(res.status===429||res.status>=500)){
        await sleep(Math.min(+res.headers.get('Retry-After')||2*(i+1),20)*1000); continue;
      }
      throw err;
    }catch(e){
      if(e===CANCEL||e.status)throw e;
      if(i<tries-1){await sleep(2000);continue;}
      throw e;
    }
  }
}
// run fn over items, at most `limit` at once
async function pool(items,limit,fn){
  let i=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(i<items.length){const idx=i++;await fn(items[idx],idx);}}));
}
const slim=l=>({id:l.id,scoutId:l.scoutId,scout:l.scout,name:l.name,link:l.link,need:l.need,proof:l.proof,contact:l.contact,
  teardown:l.teardownNote||'',judgeNotes:l.judgeNotes||''});

/* ---- the hunt ---- */
function newRun(){
  return{running:true,cancelled:false,step:'',error:'',notes:[],round:0,
    scouts:SCOUTS.map(s=>({...s,status:'wait',n:0,dropped:0,error:''})),
    leads:[],survivors:[],removed:[],
    judges:Object.fromEntries(JUDGES.map(j=>[j.id,'wait'])),
    ballots:[],ballotsDone:0,ballotsFailed:0,tally:[],
    finalRounds:[],top:[],drafts:{},draftError:'',runnerUps:[],topReason:'',disagreement:[],outcome:'',startedAt:Date.now()};
}

export async function startHunt(){
  if(H.run&&H.run.running)return;
  const brief=readBrief(); H.brief=brief;
  const need=[['offer','your offer'],['price','a rough price range'],['idealClient','your ideal client'],['area','an area']].filter(([k])=>!brief[k]);
  if(need.length){dbError('Before hunting, fill in: '+need.map(n=>n[1]).join(', ')+'.');return;}
  saveHunterBrief();
  const r=H.run=newRun(); paint();
  try{ await pipeline(r,brief); }
  catch(e){ if(e===CANCEL){r.outcome='stopped';}else{r.error=e.message||String(e);} }
  r.running=false; r.step='';
  paint();
  if(r.outcome==='found'||r.outcome==='none')persistHunt(r,brief);
}
export function stopHunt(){ if(H.run&&H.run.running){H.run.cancelled=true;H.run.step='Stopping…';paint();} }

async function pipeline(r,brief){
  /* 1+2 — scouts, then the Teardown; if fewer than 3 survive, the scouts go out again (max 2 extra rounds) */
  let lessons='';
  for(let round=0;round<=2;round++){
    r.round=round;
    r.step=round?`Scouts out again with the Teardown's notes (extra round ${round} of 2)`:'8 scouts are searching the live web…';
    r.scouts.forEach(s=>{s.status='wait';s.n=0;s.dropped=0;s.error='';});
    paint();
    const found=await runScouts(r,brief,lessons,round);
    r.leads.push(...found);
    if(found.length){ r.step=`The Teardown is opening ${found.length} proof link set${found.length===1?'':'s'}…`; paint(); await runTeardown(r,brief,found); }
    if(r.survivors.length>=3)break;
    lessons=lessonsFrom(r);
  }
  if(!r.survivors.length){ r.outcome='none'; return; }
  if(r.survivors.length<3)r.notes.push(`Only ${r.survivors.length} lead${r.survivors.length===1?'':'s'} survived the Teardown after the extra rounds.`);
  if(r.survivors.length>25){r.notes.push(`${r.survivors.length} leads survived — the judges scored the first 25.`);r.survivors=r.survivors.slice(0,25);}

  /* 3 — judges */
  r.step='3 judges are scoring the survivors (budget, fit, timing)…'; paint();
  await runJudges(r,brief);

  /* 4 — secret vote */
  r.step='All 12 are voting alone…'; paint();
  await runVotes(r,brief);

  /* 5 — final check, swapping out leads the Teardown agrees are weak (max 3 rounds) */
  await runFinalChecks(r,brief);

  /* 6 — first messages */
  r.step='Drafting the first messages…'; paint();
  await runDrafts(r,brief);
  r.outcome='found';
}

async function runScouts(r,brief,lessons,round){
  const avoid=r.leads.map(l=>l.name);
  const out=[];
  await Promise.all(r.scouts.map(async s=>{
    s.status='run'; paint();
    try{
      const d=await callStage(r,'scout',{brief,scoutId:s.id,avoid,lessons});
      s.status='done'; s.n=(d.leads||[]).length; s.dropped=d.dropped||0;
      (d.leads||[]).forEach(l=>out.push({...l,id:`r${round}-${l.id}`}));
    }catch(e){
      if(e===CANCEL)throw e;
      s.status='fail'; s.error=e.message;
    }
    paint();
  }));
  // de-duplicate within this batch and against everything already found
  const seenLink=new Set(r.leads.map(leadKey)), seenName=new Set(r.leads.map(nameKey));
  const unique=[];
  for(const l of out){
    const lk=leadKey(l), nk=nameKey(l);
    if(seenLink.has(lk)||seenName.has(nk)){r.removed.push({lead:l,code:'duplicate',reason:'Found by more than one scout.'});continue;}
    seenLink.add(lk); seenName.add(nk); unique.push(l);
  }
  if(r.scouts.every(s=>s.status==='fail'))throw new Error('Every scout failed — '+(r.scouts[0].error||'check the Anthropic key and that web search is enabled for your account'));
  return unique;
}

async function runTeardown(r,brief,leads){
  const chunks=[]; for(let i=0;i<leads.length;i+=8)chunks.push(leads.slice(i,i+8));
  await pool(chunks,2,async chunk=>{
    try{
      const d=await callStage(r,'teardown',{brief,leads:chunk.map(slim)},2);
      const byId=new Map((d.verdicts||[]).map(v=>[v.id,v]));
      chunk.forEach(l=>{
        const v=byId.get(l.id);
        if(v&&v.keep){r.survivors.push({...l,teardownNote:v.reason||''});}
        else r.removed.push({lead:l,code:(v&&v.code)||'unverifiable',reason:(v&&v.reason)||'No verdict returned.'});
      });
    }catch(e){
      if(e===CANCEL)throw e;
      chunk.forEach(l=>r.removed.push({lead:l,code:'unverifiable',reason:'The Teardown step failed: '+e.message}));
      r.notes.push('A Teardown batch failed ('+e.message+') — those leads were dropped, not kept unchecked.');
    }
    paint();
  });
}

function lessonsFrom(r){
  const counts={}; r.removed.forEach(x=>{counts[x.code]=(counts[x.code]||0)+1;});
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>`${n} removed because ${REMOVAL_LABEL[c]||c}`);
  const eg=r.removed.slice(-6).map(x=>`${x.lead.name}: ${x.reason}`);
  return [...top,...eg].join('\n');
}

async function runJudges(r,brief){
  const leads=r.survivors.map(slim);
  r.survivors.forEach(l=>{l.scores={};l.why={};});
  await Promise.all(JUDGES.map(async j=>{
    r.judges[j.id]='run'; paint();
    try{
      const d=await callStage(r,'judge',{brief,leads,judge:j.id});
      (d.scores||[]).forEach(s=>{const l=r.survivors.find(x=>x.id===s.id);if(l){l.scores[j.id]=s.score;l.why[j.id]=s.why;}});
      r.judges[j.id]='done';
    }catch(e){
      if(e===CANCEL)throw e;
      r.judges[j.id]='fail'; r.notes.push(`The ${j.name} judge failed (${e.message}) — scores from the other judges are used.`);
    }
    paint();
  }));
  if(JUDGES.every(j=>r.judges[j.id]==='fail'))throw new Error('All three judges failed — try again.');
  r.survivors.forEach(l=>{
    const v=Object.values(l.scores); l.total=v.reduce((a,b)=>a+b,0); l.avg=v.length?l.total/v.length:0;
    l.judgeNotes=JUDGES.filter(j=>l.scores[j.id]!=null).map(j=>`${j.name} ${l.scores[j.id]}/10 (${l.why[j.id]})`).join('; ');
  });
}

async function runVotes(r,brief){
  const pack=r.survivors.map(slim);
  const points={}; r.survivors.forEach(l=>{points[l.id]={id:l.id,points:0,firsts:0};});
  await Promise.all(VOTERS.map(async v=>{
    try{
      const d=await callStage(r,'vote',{brief,leads:pack,voter:v});
      r.ballots.push({voter:v.id,label:v.label,ranking:d.ranking||[],why:d.why||''});
      (d.ranking||[]).forEach((id,i)=>{ if(points[id]){points[id].points+=3-i; if(i===0)points[id].firsts++;} });
      r.ballotsDone++;
    }catch(e){
      if(e===CANCEL)throw e;
      r.ballotsFailed++; r.notes.push(`${v.label} could not vote (${e.message}).`);
    }
    r.step=`All 12 are voting alone… ${r.ballotsDone+r.ballotsFailed}/12 ballots in`; paint();
  }));
  if(!r.ballotsDone)throw new Error('No ballots came back — try again.');
  r.tally=Object.values(points).sort((a,b)=>b.points-a.points||b.firsts-a.firsts||(leadOf(r,b.id).total||0)-(leadOf(r,a.id).total||0));
}
const leadOf=(r,id)=>r.survivors.find(l=>l.id===id)||{};

async function runFinalChecks(r,brief){
  let top=r.tally.slice(0,3).map(t=>t.id);
  const tried=new Set(top);
  for(let round=1;round<=3;round++){
    r.step=`Final check, round ${round}: would each of the 12 stake their name on these ${top.length}?`; paint();
    const pack=top.map(id=>slim(leadOf(r,id)));
    const answers=[];
    await Promise.all(VOTERS.map(async v=>{
      try{ answers.push({...(await callStage(r,'final',{brief,leads:pack,voter:v})),label:v.label}); }
      catch(e){ if(e===CANCEL)throw e; r.notes.push(`${v.label} could not answer the final check (${e.message}).`); }
    }));
    const noes=answers.filter(a=>a.answer==='no');
    const fr={round,top:[...top],responded:answers.length,yes:answers.length-noes.length,noes:noes.map(n=>({label:n.label,leadId:n.leadId,reason:n.reason})),rulings:[]};
    r.finalRounds.push(fr);
    if(!noes.length)break;
    const objections=noes.filter(n=>n.leadId).map(n=>({leadId:n.leadId,reason:n.reason}));
    if(objections.length){
      try{ fr.rulings=(await callStage(r,'ruling',{brief,leads:pack,objections})).rulings||[]; }
      catch(e){ if(e===CANCEL)throw e; r.notes.push('The Teardown could not rule on the objections ('+e.message+').'); }
    }
    const agreed=fr.rulings.filter(x=>x.agree).map(x=>x.leadId);
    if(!agreed.length||round===3)break;
    // swap each lead the Teardown agrees is weak for the next highest-voted one
    top=top.filter(id=>!agreed.includes(id));
    for(const t of r.tally){ if(top.length>=3)break; if(!tried.has(t.id)){top.push(t.id);tried.add(t.id);} }
    if(!top.length)break;
  }
  const last=r.finalRounds[r.finalRounds.length-1];
  r.top=top.map(id=>{
    const l=leadOf(r,id), t=r.tally.find(x=>x.id===id)||{points:0};
    // "yes" for a lead = everyone who answered, minus any "no" aimed at it (or at no lead in particular)
    const against=last?last.noes.filter(n=>!n.leadId||n.leadId===id).length:0;
    return{...l,points:t.points,yes:last?last.responded-against:0,of:last?last.responded:0};
  });
  r.disagreement=last?last.noes.map(n=>({...n,leadName:(leadOf(r,n.leadId)||{}).name||'the picks overall',
    ruling:(last.rulings.find(x=>x.leadId===n.leadId)||{}).why||''})):[];
  r.runnerUps=r.tally.filter(t=>!top.includes(t.id)).slice(0,2).map(t=>leadOf(r,t.id).name).filter(Boolean);
  const counts={}; r.removed.forEach(x=>{counts[x.code]=(counts[x.code]||0)+1;});
  const [code,n]=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]||[];
  r.topReason=code?`${n} of ${r.removed.length} removed leads: ${REMOVAL_LABEL[code]||code}.`:'';
}

async function runDrafts(r,brief){
  try{
    const d=await callStage(r,'draft',{brief,leads:r.top.map(slim)});
    (d.drafts||[]).forEach(x=>{r.drafts[x.id]={message:x.message,words:x.words};});
  }catch(e){ if(e===CANCEL)throw e; r.draftError=e.message; }
}
export async function redraft(){
  const r=H.run; if(!r||r.running||!r.top.length)return;
  r.running=true; r.draftError=''; r.step='Drafting the first messages…'; paint();
  await runDrafts(r,H.brief); r.running=false; r.step=''; paint();
}

/* ---- persistence: hunt history ---- */
async function persistHunt(r,brief){
  const summary=r.outcome==='none'?'No leads survived the Teardown':r.top.map(t=>t.name).join(' · ');
  const result={...r,running:false,cancelled:false};
  const {data,error}=await sb.from('hunts').insert({brief,status:r.outcome==='none'?'none_found':'done',summary,result}).select('id').single();
  if(error){dbError('Could not save this hunt — '+error.message+' (has the client_hunter migration been applied?)');return;}
  r.id=data&&data.id; await loadHunts(); paintHistory();
}
async function loadHunts(){
  const {data,error}=await sb.from('hunts').select('id,created_at,summary,status').order('created_at',{ascending:false}).limit(10);
  if(!error)H.history=data||[];
  H.historyLoaded=true;
}
export async function openHunt(id){
  const {data,error}=await sb.from('hunts').select('result,brief').eq('id',id).single();
  if(error){dbError('Could not open that hunt — '+error.message);return;}
  if(H.run&&H.run.running){dbError('A hunt is running — stop it first.');return;}
  H.run={...newRun(),...data.result,running:false,cancelled:false,id}; paint();
  const el=$('#hunterrun'); if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---- add to CRM ---- */
export function addHunterLead(i){
  const r=H.run, l=r&&r.top[i]; if(!l)return;
  const sourceId='h_'+hash(leadKey(l));
  const mark=()=>{const b=$('#hadd-'+i);if(b)b.outerHTML='<span style="color:var(--won);font-size:12px;font-weight:600">✓ In CRM</span>';};
  if(alreadyInCRM(sourceId)){mark();return;}
  const rep=pickRepForNewLead();
  if(!rep){dbError('Add a rep before adding leads to your CRM — see the Reps tab.');return;}
  const d=r.drafts[l.id]||{};
  const notes=[`Client Hunter — ${new Date().toISOString().slice(0,10)}`,`Need: ${l.need}`,'Proof:',
    ...l.proof.map(p=>`- ${p.url} — ${p.shows} (${p.date})`),`Contact route: ${l.contact}`,
    d.message?`\nDrafted first message:\n${d.message}`:''].join('\n');
  const avg=l.avg||5;
  const nl={id:'l_'+sourceId+'_'+Date.now(),sourceId,name:l.name,cat:'Local business',city:H.brief.area,province:'',postal:'',street:'',address:'',
    lat:null,lng:null,phone:'',website:true,web:l.link,rating:0,reviewCount:0,value:0,
    email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.contact)?l.contact:null,status:'',siteAudit:null,socials:{},reviews:[],hot:false,
    score:Math.max(1,Math.min(100,Math.round(avg*10))),
    gaps:[{type:'hunter',tag:l.need.length>48?l.need.slice(0,47)+'…':l.need,sev:Math.min(1,avg/10)}],
    gapSummary:l.need,demandSignal:null,stage:'new',rep:rep.id,notes,nextAction:'',nextActionAt:null};
  addedProspects.add(sourceId); LEADS.push(nl); mark(); updateBadges();
  saveNewLead(nl,sourceId,'Added from Client Hunter — '+l.need);
}
export function copyHunterMessage(i){
  const r=H.run, l=r&&r.top[i], d=l&&r.drafts[l.id]; if(!d)return;
  navigator.clipboard.writeText(d.message).then(()=>{const b=$('#hcopy-'+i);if(b){b.textContent='Copied ✓';setTimeout(()=>{if(b)b.textContent='Copy message';},1800);}})
    .catch(()=>dbError('Could not copy — select the text and copy it manually.'));
}

/* ---- rendering ---- */
export function renderHunter(){
  const b=H.brief;
  const inp=(id,label,val,ph,wide)=>`<div style="flex:${wide?'2 1 320px':'1 1 200px'};min-width:0"><div class="flbl">${label}</div><input id="${id}" value="${escAttr(val)}" placeholder="${escAttr(ph||'')}" class="hinput"></div>`;
  $('#v-hunter').innerHTML=`<div class="viewhead"><div><div class="t">Client Hunter</div><div class="s">12 Claudes find your next paying client — 8 scouts search the live web, a Teardown critic removes weak leads, 3 judges score the rest, then all 12 vote in secret. Drafts only: nothing is ever sent.</div></div></div>
    <div class="card" style="margin-bottom:16px">
      <h3>The brief <span class="link" onclick="saveHunterBrief()">Save as default</span></h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${inp('hb-offer','What you sell',b.offer,'In plain words',true)}${inp('hb-price','Rough price range',b.price,'e.g. $1,500–$4,000 per project')}
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${inp('hb-ideal','Ideal client',b.idealClient,'The kind of business or person you help best',true)}${inp('hb-area','Area',b.area,'A town or region, or "online"')}
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        ${inp('hb-proof','Proof (optional)',b.proof,'One past result or example of your work',true)}
      </div>
      <details style="margin-bottom:14px"><summary style="cursor:pointer;color:var(--muted);font-size:12.5px">Who messages and emails are written as</summary>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">${inp('hb-name','Your name',b.senderName)}${inp('hb-company','Company',b.senderCompany)}${inp('hb-site','Website',b.senderSite)}${inp('hb-city','City',b.senderCity)}</div>
        <div style="color:var(--dim);font-size:12px;margin-top:8px">Also used to sign the outreach emails drafted from the CRM drawer.</div>
      </details>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn" id="hunt-go" onclick="startHunt()">${ic('search','#fff')} Start hunt</button>
        <button class="btn ghost" id="hunt-stop" onclick="stopHunt()" style="display:none">${ic('x')} Stop</button>
        <span id="hb-saved" style="font-size:12px;color:var(--won)"></span>
        <span style="font-size:12px;color:var(--dim);flex:1;min-width:200px">A hunt makes roughly 50 Claude calls and takes several minutes. Use only public business information; check the cold-outreach rules where you and the recipient live before sending anything.</span>
      </div>
    </div>
    <div id="hunterrun"></div>
    <div id="hunterhistory"></div>`;
  paint(); paintHistory();
  if(!H.historyLoaded)loadHunts().then(paintHistory);
}

function paint(){
  const el=$('#hunterrun'); if(!el)return;
  const r=H.run;
  const go=$('#hunt-go'), stop=$('#hunt-stop');
  if(go){go.disabled=!!(r&&r.running);go.style.opacity=r&&r.running?.6:1;}
  if(stop)stop.style.display=r&&r.running?'':'none';
  el.innerHTML=r?renderRun(r):'';
}
function paintHistory(){
  const el=$('#hunterhistory'); if(!el)return;
  if(!H.history.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="card" style="margin-top:16px"><h3>Past hunts</h3>${H.history.map(h=>`<div class="hrow" onclick="openHunt('${h.id}')"><span class="mono" style="color:var(--dim);font-size:12px;white-space:nowrap">${new Date(h.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.summary||'')}</span><span style="color:var(--blue-2);font-size:12px">Open</span></div>`).join('')}</div>`;
}

const dot=s=>s==='done'?'✓':s==='run'?'…':s==='fail'?'✕':'·';
const chip=(label,s,extra)=>`<span class="hchip ${s}" title="${escAttr(extra||'')}">${dot(s)} ${esc(label)}${extra&&s==='done'?` <b>${esc(extra)}</b>`:''}</span>`;

function renderRun(r){
  const live=r.running;
  const mins=Math.max(0,Math.round((Date.now()-r.startedAt)/60000));
  const steps=[];
  steps.push(`<div class="hstep"><div class="hk">1 · Scouts${r.round?` <small>(round ${r.round+1})</small>`:''}</div><div class="hchips">${r.scouts.map(s=>chip(s.name,s.status,s.status==='done'?String(s.n):s.error)).join('')}</div></div>`);
  if(r.leads.length||r.removed.length)steps.push(`<div class="hstep"><div class="hk">2 · Teardown</div><div>${r.leads.length} lead${r.leads.length===1?'':'s'} found · <b style="color:var(--won)">${r.survivors.length} survived</b> · ${r.removed.length} removed</div></div>`);
  if(r.survivors.length&&(live||r.top.length))steps.push(`<div class="hstep"><div class="hk">3 · Judges</div><div class="hchips">${JUDGES.map(j=>chip(j.name,r.judges[j.id])).join('')}</div></div>`);
  if(r.ballotsDone||r.ballotsFailed)steps.push(`<div class="hstep"><div class="hk">4 · Secret vote</div><div>${r.ballotsDone} of 12 ballots counted${r.ballotsFailed?` · ${r.ballotsFailed} failed`:''}</div></div>`);
  if(r.finalRounds.length)steps.push(`<div class="hstep"><div class="hk">5 · Final check</div><div>${r.finalRounds.map(f=>`Round ${f.round}: ${f.yes} of ${f.responded} yes${f.noes.length?` — ${f.noes.length} “no”`:''}${f.rulings.some(x=>x.agree)?' (Teardown agreed, swapped)':''}`).join(' → ')}</div></div>`);
  const head=live
    ? `<div class="hlive"><span class="hspin"></span><b>${esc(r.step||'Working…')}</b><span style="color:var(--dim);font-size:12px">${mins?mins+' min':''}</span></div>`
    : r.error?`<div style="color:#F87171;font-size:13px;margin-bottom:10px"><b>Hunt stopped:</b> ${esc(r.error)}</div>`
    : r.outcome==='stopped'?'<div style="color:var(--muted);font-size:13px;margin-bottom:10px">Hunt stopped before finishing.</div>':'';
  const notes=r.notes.length?`<div class="hnotes">${r.notes.slice(0,6).map(n=>'• '+esc(n)).join('<br>')}</div>`:'';
  let body='';
  if(r.outcome==='none')body=`<div class="empty" style="padding:24px">${ic('search','#5C6E8A',34)}<div>No lead survived the Teardown.</div><div style="font-size:12px;margin-top:4px">${esc(r.topReason||lessonsFrom(r).split('\n')[0]||'Try a wider area, a broader ideal client, or a lower price range.')}</div></div>`;
  if(r.outcome==='found')body=renderTop(r);
  return `<div class="card" style="margin-bottom:16px"><h3>${live?'Hunt in progress':'Hunt results'}</h3>${head}<div class="hsteps">${steps.join('')}</div>${notes}</div>${body}${!live&&r.removed.length?renderRemoved(r):''}`;
}

function contactHtml(c){
  const v=String(c||'');
  if(/^https?:\/\//i.test(v))return `<a href="${escAttr(safeHref(v))}" target="_blank" rel="noopener">${esc(host(v))} ${ic('ext','#4D9FFF',12)}</a>`;
  return esc(v);
}
function renderTop(r){
  const cards=r.top.map((l,i)=>{
    const d=r.drafts[l.id], added=alreadyInCRM('h_'+hash(leadKey(l)));
    return `<div class="card hcard"><div class="hrank">${i+1}</div><div style="flex:1;min-width:0">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b style="font-family:var(--disp);font-size:16px">${esc(l.name)}</b><a href="${escAttr(safeHref(l.link))}" target="_blank" rel="noopener" style="font-size:12px">${esc(host(l.link))} ${ic('ext','#4D9FFF',12)}</a></div>
      <div class="hrow2"><span class="hk">Why they'll pay</span>${esc(l.need)}</div>
      <div class="hrow2"><span class="hk">Proof</span><ul class="hlist">${l.proof.map(p=>`<li><a href="${escAttr(safeHref(p.url))}" target="_blank" rel="noopener">${esc(host(p.url))}</a> — ${esc(p.shows)} <span style="color:var(--dim)">(${esc(p.date||'undated')})</span></li>`).join('')}</ul></div>
      <div class="hrow2"><span class="hk">Vote</span>${l.points} points · ${l.yes} of ${l.of} said yes${l.scores?` · judges: ${JUDGES.filter(j=>l.scores[j.id]!=null).map(j=>`${j.name} ${l.scores[j.id]}`).join(', ')}`:''}</div>
      <div class="hrow2"><span class="hk">Contact</span>${contactHtml(l.contact)}</div>
      <div class="hrow2"><span class="hk">First message</span>${d?`<div class="hmsg">${esc(d.message)}</div><div style="color:var(--dim);font-size:11.5px;margin-top:4px">${d.words} words · draft only — you send it</div>`:`<span style="color:var(--dim)">${r.draftError?`Drafting failed (${esc(r.draftError)}) — <a style="cursor:pointer" onclick="redraft()">retry</a>`:'No draft yet.'}</span>`}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${d?`<button class="btn ghost" id="hcopy-${i}" onclick="copyHunterMessage(${i})">Copy message</button>`:''}
        ${added?'<span style="color:var(--won);font-size:12px;font-weight:600;align-self:center">✓ In CRM</span>':`<button class="btn" id="hadd-${i}" onclick="addHunterLead(${i})">${ic('plus','#fff')} Add to CRM</button>`}
      </div></div></div>`;
  }).join('');
  const dis=r.disagreement.length?`<div class="card" style="margin-bottom:16px;border-color:rgba(245,165,36,.45)"><h3>Not everyone agreed</h3><div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">The final check did not end unanimous. Here is every “no”, unedited:</div>${r.disagreement.map(n=>`<div style="font-size:13px;margin-bottom:8px"><b>${esc(n.label)}</b> on <b>${esc(n.leadName)}</b>: ${esc(n.reason)}${n.ruling?`<div style="color:var(--dim);font-size:12px">Teardown: ${esc(n.ruling)}</div>`:''}</div>`).join('')}</div>`:'';
  return `<div class="viewhead" style="margin:4px 2px 10px"><div class="t" style="font-size:18px">Your top ${r.top.length}</div></div>${dis}${cards}
    <div style="color:var(--muted);font-size:13px;margin:4px 2px 16px;line-height:1.7">${r.runnerUps.length?`<div><b>Runners-up:</b> ${r.runnerUps.map(esc).join(', ')}.</div>`:''}${r.topReason?`<div><b>Most common Teardown removal:</b> ${esc(r.topReason)}</div>`:''}</div>`;
}
function renderRemoved(r){
  return `<details class="card" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:600;font-size:13px">What the Teardown removed (${r.removed.length})</summary><div style="margin-top:10px">${r.removed.map(x=>`<div style="font-size:12.5px;margin-bottom:6px"><b>${esc(x.lead.name)}</b> <span style="color:var(--dim)">— ${esc(REMOVAL_LABEL[x.code]||x.code)}.</span> ${esc(x.reason)}</div>`).join('')}</div></details>`;
}
