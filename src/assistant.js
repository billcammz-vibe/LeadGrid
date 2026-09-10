// Grid Assistant: a rule-based Q&A panel over the current pipeline (placeholder for a real LLM).
import {$,visibleLeads,money,cap} from './helpers.js';
import {REPS,LEADS,AI_SUGG,currentUserName} from './state.js';

export function openAI(){$('#aipanel').classList.add('open');$('#aifab').style.display='none';if(!$('#aibody').dataset.init){aiBot(`Hey ${cap(currentUserName)} — I can see your live pipeline. Ask me who to call, where the gaps are, or to summarize an area.`);renderSugg();$('#aibody').dataset.init=1;}}
export function closeAI(){$('#aipanel').classList.remove('open');$('#aifab').style.display='grid';}
function renderSugg(){$('#aisugg').innerHTML=AI_SUGG.map(s=>`<button onclick="aiSend('${s}')">${s}</button>`).join('');}
function aiBot(html){const d=document.createElement('div');d.className='msg bot';d.innerHTML=html;$('#aibody').appendChild(d);$('#aibody').scrollTop=1e6;}
function aiMe(t){const d=document.createElement('div');d.className='msg me';d.textContent=t;$('#aibody').appendChild(d);$('#aibody').scrollTop=1e6;}
export function aiSend(preset){
  const q=preset||$('#aiinput').value.trim();if(!q)return;
  aiMe(q);$('#aiinput').value='';
  setTimeout(()=>aiBot(aiAnswer(q.toLowerCase())),320);
}
function aiAnswer(q){
  const ls=visibleLeads();
  if(q.includes('call')||q.includes('today')||q.includes('priorit')){
    const hot=[...ls].filter(l=>!['won','lost'].includes(l.stage)).sort((a,b)=>(b.hot?1:0)-(a.hot?1:0)||b.value-a.value).slice(0,4);
    return `<b>Top 4 to call today</b> — ranked by intent + value:${hot.map((l,i)=>`<div class="mrow2"><span>${i+1}. ${l.name}${l.hot?' 🔥':''}</span><span>${money(l.value)}</span></div>`).join('')}<div style="margin-top:8px;color:var(--muted)">The two 🔥 are late-stage — I'd hit those first.</div>`;
  }
  if(q.includes('rep')||q.includes('underload')||q.includes('load')||q.includes('gap')){
    const load=REPS.map(r=>({r,n:LEADS.filter(l=>l.rep===r.id&&!['won','lost'].includes(l.stage)).length})).sort((a,b)=>a.n-b.n);
    return `<b>Rep capacity</b> — lightest load first:${load.map(x=>`<div class="mrow2"><span>${x.r.name}</span><span>${x.n} open</span></div>`).join('')}<div style="margin-top:8px;color:var(--muted)">${load[0].r.name.split(' ')[0]} has room — route the next batch there.</div>`;
  }
  if(q.includes('summar')||q.includes('area')||ls.some(l=>l.city&&q.includes(l.city.toLowerCase()))){
    const cities=[...new Set(ls.map(l=>l.city).filter(Boolean))];
    if(!cities.length)return `You don't have any leads yet — add some from the Map or Lead Finder and I can summarize an area for you.`;
    const named=cities.filter(c=>q.includes(c.toLowerCase()));
    const targetCities=named.length?named:cities; // no city named — summarize everything you've got
    const area=ls.filter(l=>targetCities.includes(l.city));
    const val=area.reduce((s,l)=>s+l.value,0);const noweb=area.filter(l=>!l.website).length;
    const load=REPS.map(r=>({r,n:area.filter(l=>l.rep===r.id).length})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
    const closest=area.filter(l=>l.stage==='proposal').sort((a,b)=>b.value-a.value)[0];
    return `<b>${targetCities.join(' + ')}</b><div class="mrow2"><span>Leads</span><span>${area.length}</span></div><div class="mrow2"><span>Pipeline</span><span>${money(val)}</span></div><div class="mrow2"><span>No-website</span><span>${noweb}</span></div>${load.length?`<div class="mrow2"><span>Most leads here</span><span>${load[0].r.name}</span></div>`:''}<div style="margin-top:8px;color:var(--muted)">${closest?closest.name+' is at proposal — closest to closing.':'Nothing at proposal stage here yet.'}</div>`;
  }
  if(q.includes('website')||q.includes('no-website')||q.includes('opportun')){
    const nw=ls.filter(l=>!l.website&&!['won','lost'].includes(l.stage)).sort((a,b)=>b.value-a.value).slice(0,5);
    return `<b>No-website leads</b> — your warmest pitch (you can lead with a mockup):${nw.map(l=>`<div class="mrow2"><span>${l.name}</span><span>${money(l.value)}</span></div>`).join('')}`;
  }
  if(q.includes('total')||q.includes('pipeline')||q.includes('value')){
    const open=ls.filter(l=>!['won','lost'].includes(l.stage));const v=open.reduce((s,l)=>s+l.value,0);
    return `Open pipeline right now is <b>${money(v)}</b> across ${open.length} leads. Won this month adds ${money(ls.filter(l=>l.stage==='won').reduce((s,l)=>s+l.value,0))}.`;
  }
  return `I can help with: who to <b>call today</b>, <b>rep capacity</b>, an <b>area summary</b>, or <b>no-website</b> opportunities. Try one of the chips below.`;
}
