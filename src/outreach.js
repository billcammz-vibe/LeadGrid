// AI outreach layer. The "Why reach out" blurb and review summary are still local heuristics;
// the outreach email is drafted by Claude via /api/generate-email (key stays server-side — see
// api/lib/generateEmail.js). Drafts land in editable fields; nothing sends automatically.
import {$,leadById,esc,escAttr} from './helpers.js';
import {REVIEW_THEMES,stageOf} from './state.js';
import {apiFetch} from './sb.js';
import {addHistory} from './history.js';
import {ic} from './icons.js';

let curLead=null, aiSeed=0, emailVariant=0;
export const setCurLead=v=>{curLead=v;};
export const setAiSeed=v=>{aiSeed=v;};
export {aiSeed};

function ratingWord(r){return r>=4.6?'highly-rated':r>=4.2?'well-reviewed':r>=3.8?'solidly-rated':'up-and-coming';}
function priorityWord(s){return s>=75?'top-priority':s>=58?'a strong':s>=45?'a moderate':'a lower-priority';}
function genWhy(l,seed){
  const cat=l.cat.toLowerCase();
  const open=seed%2
    ? `${l.name} is ${ratingWord(l.rating)==='up-and-coming'?'an':'a'} ${ratingWord(l.rating)} ${cat} in ${l.city} — ${l.rating}★ across ${l.reviewCount} Google reviews.`
    : `With ${l.reviewCount} reviews at ${l.rating}★, ${l.name} is one of the more established ${cat}s in ${l.city}.`;
  const gap=l.website
    ? `They already have a website, but there are quick wins in turning Google traffic into booked customers — follow-up automation and review generation especially.`
    : `Critically, they have no website. Customers finding them on Google have no way to book or learn more, so they're leaking business to competitors who show up polished — exactly the gap you close.`;
  const fit=`At a sales score of ${l.score}, this is ${priorityWord(l.score)} target${l.hot?', and it’s already flagged hot':''}.`;
  const now=l.stage==='new'?'No one has reached out yet, so you’d be first in the door.':`They’re currently at the ${stageOf(l.stage).name.toLowerCase()} stage — keep the momentum going.`;
  return `${open} ${gap} ${fit} ${now}`;
}
function genReview(l){
  const revs=l.reviews||[];
  const t=REVIEW_THEMES[l.cat]||{pros:['friendly service','good value'],cons:['room to improve online presence']};
  const pros=t.pros.slice(0,3), cons=t.cons.slice(0,2);
  const pos=revs.filter(r=>r.rating>=4).length, neg=revs.length-pos;
  const lead=l.rating>=4.4?'Customers consistently praise':l.rating>=4.0?'Reviewers generally appreciate':'Feedback is mixed, but many note';
  let text=`Across ${l.reviewCount} reviews (${l.rating}★${revs.length?`, ${pos} of the ${revs.length} most recent positive`:''}), ${lead.toLowerCase()} ${pros.slice(0,2).join(' and ')}. `;
  text+=(cons.length&&(neg>0||l.rating<4.5))?`A minority mention ${cons.join(' and ')}. `:'';
  text+=l.website?'':'Several reviewers ask whether they have a website or online booking — clear, stated demand you can capture.';
  return {text:text.trim(),pros,cons,samples:revs};
}
export function genAI(l,seed){return {why:genWhy(l,seed),review:genReview(l)};}

export function aiScaffold(){return `
  <div class="dsec"><div class="aihead"><div class="st">Why reach out <span class="aibadge">${ic('spark','#fff',10)} AI</span></div><button class="ai-regen" onclick="regenAI()">${ic('spark','#4D9FFF',13)} Regenerate</button></div>
    <div id="ai-why" class="aitext"></div></div>
  <div class="dsec"><div class="st">What their reviews say <span class="aibadge">${ic('spark','#fff',10)} AI</span></div>
    <div id="ai-review"></div></div>
  <div class="dsec"><div class="aihead"><div class="st">Outreach email <span class="aibadge">${ic('spark','#fff',10)} Claude</span></div><button class="ai-regen" onclick="regenEmail()">${ic('spark','#4D9FFF',13)} Regenerate</button></div>
    <div id="ai-email"></div></div>`;
}
function skel(n){return '<div class="ai-skel">'+Array.from({length:n}).map(()=>'<span></span>').join('')+'</div>';}

export function renderAI(l,seed){
  const a=genAI(l,seed);
  const why=$('#ai-why'); if(why)why.textContent=a.why;
  const rv=$('#ai-review'); if(rv)rv.innerHTML=`<div class="aitext">${a.review.text}</div>
    <div class="themechips">${a.review.pros.map(p=>`<span class="tchip pro">+ ${p}</span>`).join('')}${a.review.cons.map(c=>`<span class="tchip con">− ${c}</span>`).join('')}</div>
    ${a.review.samples&&a.review.samples.length?`<div class="revlist"><div class="revlist-h">Recent reviews <span>${l.reviewCount} total</span></div>${a.review.samples.slice(0,3).map(rw=>`<div class="revcard"><div class="revtop"><b>${rw.author}</b><span class="revstars">${'★'.repeat(rw.rating)}${'☆'.repeat(5-rw.rating)}</span><time>${rw.time}</time></div><p>${rw.text}</p></div>`).join('')}</div>`:''}`;
  emailVariant=0;
  loadEmail(l);
}

/* ---- Claude-drafted outreach email ---- */
const ANGLE_LABEL={no_website:'no website',few_reviews:'few reviews',low_rating:'low rating',odd_status:'listing status'};
function leadPayload(l){
  return {name:l.name,cat:l.cat,city:l.city,province:l.province,rating:l.rating,
    reviewCount:l.reviewCount,website:!!l.website,web:l.web,gaps:l.gaps||[],gapSummary:l.gapSummary||''};
}
async function loadEmail(l){
  const box=$('#ai-email'); if(!box)return;
  box.innerHTML=`<div class="emailbox">${skel(6)}<div class="enrichnote" style="margin-top:8px">${ic('spark','#5C6E8A',12)} Claude is drafting a personalised email…</div></div>`;
  try{
    const res=await apiFetch('/api/generate-email',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lead:leadPayload(l),variant:emailVariant})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||(res.status+' '+res.statusText));
    renderEmailBox(l,data.subject,data.body,data.angle,data.model,null);
  }catch(err){
    renderEmailBox(l,`Quick idea for ${l.name}`,'',null,null,err.message);
  }
}
function renderEmailBox(l,subject,body,angle,model,error){
  const box=$('#ai-email'); if(!box)return;
  const note=error
    ? `<span style="color:#F87171">${ic('x','#F87171',12)} ${esc(error)}</span> · <a onclick="regenEmail()" style="cursor:pointer">Retry</a>`
    : `${ic('spark','#22C55E',12)} Claude${model?' ('+esc(model)+')':''}${angle&&ANGLE_LABEL[angle]?' · angle: '+ANGLE_LABEL[angle]:''} · edit before sending`;
  box.innerHTML=`
    <div class="emailbox">
      <div class="emrow"><span class="emlbl">To</span><span class="emto">${l.email?esc(l.email):'<span style="color:var(--dim)">no email yet — add it in Gmail</span>'}</span></div>
      <input id="ai-subj" class="emsubj" value="${escAttr(subject)}">
      <textarea id="ai-body" class="embody" rows="12">${esc(body)}</textarea>
      <div class="emacts">
        <button class="btn" onclick="sendGmail()">${ic('mail','#fff',15)} Open in Gmail</button>
        <button class="btn ghost" onclick="sendDefault()">${ic('mail')} Default mail</button>
        <button class="btn ghost" id="copybtn" onclick="copyEmail()">Copy</button>
      </div>
      <div class="enrichnote" style="margin-top:2px">${note}</div>
    </div>`;
}

export function regenAI(){
  ['#ai-why','#ai-review'].forEach(s=>{const el=$(s);if(el)el.innerHTML=skel(3);});
  const l=leadById(curLead); aiSeed=(aiSeed+1)%2;
  setTimeout(()=>{
    const a=genAI(l,aiSeed);
    const why=$('#ai-why'); if(why)why.textContent=a.why;
    const rv=$('#ai-review'); if(rv)rv.innerHTML=`<div class="aitext">${a.review.text}</div>
      <div class="themechips">${a.review.pros.map(p=>`<span class="tchip pro">+ ${p}</span>`).join('')}${a.review.cons.map(c=>`<span class="tchip con">− ${c}</span>`).join('')}</div>`;
  },500);
}
export function regenEmail(){ emailVariant++; loadEmail(leadById(curLead)); }

function emailFields(){const l=leadById(curLead);return {to:l.email||'',su:($('#ai-subj')||{}).value||'',body:($('#ai-body')||{}).value||''};}
function logOutreach(how){const su=($('#ai-subj')||{}).value||'';if(curLead)addHistory(curLead,'email_drafted',how+(su?' — “'+su+'”':''),{});}
export function sendGmail(){const{to,su,body}=emailFields();logOutreach('Opened outreach in Gmail');window.open('https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(to)+'&su='+encodeURIComponent(su)+'&body='+encodeURIComponent(body),'_blank');}
export function sendDefault(){const{to,su,body}=emailFields();logOutreach('Opened outreach in mail app');window.location.href='mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(su)+'&body='+encodeURIComponent(body);}
export function copyEmail(){const{su,body}=emailFields();const txt=su+'\n\n'+body;(navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>{const b=$('#copybtn');if(b){b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy',1400);}logOutreach('Copied outreach email');}).catch(()=>{const t=$('#ai-body');if(t){t.focus();t.select();document.execCommand&&document.execCommand('copy');}});}
