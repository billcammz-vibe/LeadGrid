// AI outreach layer — placeholder generators (why-reach-out blurb, review summary, draft email)
// plus the drawer render + send actions. Each generator returns the shape a real endpoint should
// return, so wiring the Anthropic API later is a drop-in: replace the body of genAI() with a fetch.
import {$,leadById} from './helpers.js';
import {REVIEW_THEMES,stageOf} from './state.js';
import {ic} from './icons.js';

let curLead=null, aiSeed=0;
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
function genEmail(l,seed){
  const cat=l.cat.toLowerCase();
  const subject=seed%2?`Quick idea for ${l.name} — more bookings from Google`:`${l.name}: turning your ${l.rating}★ reputation into booked customers`;
  const hook=l.website
    ? `I took a look at your online presence and spotted a few quick wins that could turn more of your Google traffic into booked customers.`
    : `I noticed you don't have a website yet. Right now, customers finding ${l.name} on Google have no easy way to book or learn more — and some are going to competitors who show up with a polished site.`;
  const proof=`${l.rating}★ across ${l.reviewCount} reviews is genuinely strong — you've clearly earned local trust.`;
  const body=`Hi ${l.name} team,\n\nI came across ${l.name} while looking at ${cat}s in ${l.city}. ${proof}\n\n${hook}\n\nWe're a local Toronto agency (OmniGrid Digital) that builds booking-ready sites and automated follow-up for ${cat}s. I'd be happy to send over a free mockup of what ${l.name} could look like — no obligation, just so you can see it.\n\nAre you free for a quick 10-minute call this week?\n\nBest,\nJohn Albano\nOmniGrid Digital\nomnigriddigital.ca`;
  return {subject,body};
}
export function genAI(l,seed){return {why:genWhy(l,seed),review:genReview(l),email:genEmail(l,seed)};}

export function aiScaffold(){return `
  <div class="dsec"><div class="aihead"><div class="st">Why reach out <span class="aibadge">${ic('spark','#fff',10)} AI</span></div><button class="ai-regen" onclick="regenAI()">${ic('spark','#4D9FFF',13)} Regenerate</button></div>
    <div id="ai-why" class="aitext"></div></div>
  <div class="dsec"><div class="st">What their reviews say <span class="aibadge">${ic('spark','#fff',10)} AI</span></div>
    <div id="ai-review"></div></div>
  <div class="dsec"><div class="aihead"><div class="st">Outreach email <span class="aibadge">${ic('spark','#fff',10)} AI</span></div><span style="font-size:10.5px;color:var(--dim)">draft · editable</span></div>
    <div id="ai-email"></div></div>`;
}
function skel(n){return '<div class="ai-skel">'+Array.from({length:n}).map(()=>'<span></span>').join('')+'</div>';}
export function renderAI(l,seed){
  const a=genAI(l,seed);
  const why=$('#ai-why'); if(why)why.textContent=a.why;
  const rv=$('#ai-review'); if(rv)rv.innerHTML=`<div class="aitext">${a.review.text}</div>
    <div class="themechips">${a.review.pros.map(p=>`<span class="tchip pro">+ ${p}</span>`).join('')}${a.review.cons.map(c=>`<span class="tchip con">− ${c}</span>`).join('')}</div>
    ${a.review.samples&&a.review.samples.length?`<div class="revlist"><div class="revlist-h">Recent reviews <span>${l.reviewCount} total</span></div>${a.review.samples.slice(0,3).map(rw=>`<div class="revcard"><div class="revtop"><b>${rw.author}</b><span class="revstars">${'★'.repeat(rw.rating)}${'☆'.repeat(5-rw.rating)}</span><time>${rw.time}</time></div><p>${rw.text}</p></div>`).join('')}</div>`:''}`;
  const em=$('#ai-email'); if(em)em.innerHTML=`
    <div class="emailbox">
      <div class="emrow"><span class="emlbl">To</span><span class="emto">${l.email||'<span style="color:var(--dim)">no email on file — enrich to fill</span>'}</span></div>
      <input id="ai-subj" class="emsubj" value="${a.email.subject.replace(/"/g,'&quot;')}">
      <textarea id="ai-body" class="embody" rows="12">${a.email.body.replace(/</g,'&lt;')}</textarea>
      <div class="emacts">
        <button class="btn" onclick="sendGmail()">${ic('mail','#fff',15)} Open in Gmail</button>
        <button class="btn ghost" onclick="sendDefault()">${ic('mail')} Default mail</button>
        <button class="btn ghost" id="copybtn" onclick="copyEmail()">Copy</button>
      </div>
      <div class="enrichnote" style="margin-top:2px">${ic('spark','#5C6E8A',12)} Placeholder draft — connect your AI API to generate this live.</div>
    </div>`;
}
export function regenAI(){
  ['#ai-why','#ai-review','#ai-email'].forEach(s=>{const el=$(s);if(el)el.innerHTML=skel(s==='#ai-email'?5:3);});
  const l=leadById(curLead); aiSeed=(aiSeed+1)%2;
  setTimeout(()=>renderAI(l,aiSeed),750);
}
function emailFields(){const l=leadById(curLead);return {to:l.email||'',su:($('#ai-subj')||{}).value||'',body:($('#ai-body')||{}).value||''};}
export function sendGmail(){const{to,su,body}=emailFields();if(!to)return alert('No email on file for this business yet — enrich it first, or send via the phone/socials.');window.open('https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(to)+'&su='+encodeURIComponent(su)+'&body='+encodeURIComponent(body),'_blank');}
export function sendDefault(){const{to,su,body}=emailFields();if(!to)return alert('No email on file for this business yet.');window.location.href='mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(su)+'&body='+encodeURIComponent(body);}
export function copyEmail(){const{su,body}=emailFields();const txt=su+'\n\n'+body;(navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>{const b=$('#copybtn');if(b){b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy',1400);}}).catch(()=>{const t=$('#ai-body');if(t){t.focus();t.select();document.execCommand&&document.execCommand('copy');}});}
