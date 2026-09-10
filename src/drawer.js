// Lead detail drawer + the shared confirm modal.
import {$,leadById,repById,pill,scorePill,money,hash,gapChips,esc,escAttr,timeAgo} from './helpers.js';
import {STAGES} from './state.js';
import {ic} from './icons.js';
import {aiScaffold,renderAI,setCurLead,setAiSeed} from './outreach.js';
import {deleteLead} from './data.js';
import {historyFor,HISTORY_KINDS} from './history.js';

export function openLead(id){
  const l=leadById(id),r=repById(l.rep);
  setCurLead(id); const seed=hash(l.name)%2; setAiSeed(seed);
  const flow=STAGES.filter(s=>s.id!=='lost');
  const nextAtVal=l.nextActionAt?String(l.nextActionAt).slice(0,10):'';
  const hist=historyFor(l.id);
  $('#drawerbody').innerHTML=`
    <div class="dhead">
      <button class="x" onclick="closeDrawer()">${ic('x')}</button>
      <div class="dcat">${l.cat} · ${l.city}</div>
      <h2>${l.name} ${l.hot?'🔥':''}</h2>
      <div class="dmeta">${pill(l.stage)} <span class="cat">★ ${l.rating} (${l.reviewCount})</span> ${scorePill(l.score)}</div>
      ${l.gaps&&l.gaps.length?`<div class="dmeta" style="margin-top:6px">${gapChips(l)}</div>`:''}
    </div>
    <div class="dbody">
      ${aiScaffold()}
      <div class="dsec"><div class="st">Stage &amp; actions</div>
        <div class="stageflow">${flow.map(s=>`<button class="${l.stage===s.id?'on':''}" style="${l.stage===s.id?'background:'+s.color+';border-color:'+s.color:''}" onclick="setStage('${l.id}','${s.id}')">${s.name}</button>`).join('')}</div>
        <div class="dacts">
          <button class="btn" onclick="window.location.href='tel:${(l.phone||'').replace(/[^\d+]/g,'')}'"${l.phone?'':' disabled style="opacity:.5;cursor:not-allowed"'}>${ic('phone','#fff')} Call</button>
          ${l.stage==='lost'
            ? `<button class="btn ghost" onclick="setStage('${l.id}','new')">${ic('spark')} Reopen</button>`
            : `<button class="btn ghost" onclick="setStage('${l.id}','lost')" style="color:#F87171">Mark lost</button>`}
        </div>
      </div>
      <div class="dsec"><div class="st">Notes &amp; next step</div>
        <textarea id="lead-notes" class="embody" rows="4" placeholder="Anything worth remembering about this lead…" onblur="saveLeadNotes('${l.id}')">${esc(l.notes||'')}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <input id="lead-next" class="emsubj" style="flex:1;min-width:180px" placeholder="Next action — e.g. Call back re: mockup" value="${escAttr(l.nextAction||'')}" onblur="saveLeadNextAction('${l.id}')">
          <input id="lead-next-at" type="date" class="emsubj" style="width:150px" value="${nextAtVal}" onchange="saveLeadNextAction('${l.id}')">
        </div>
      </div>
      <div class="dsec"><div class="st">History</div>
        ${hist.length
          ? `<div class="histlog">${hist.map(h=>{const k=HISTORY_KINDS[h.kind]||{color:'#7C8AA0'};return `<div class="histrow"><span class="histdot" style="background:${k.color}"></span><div class="histbody">${esc(h.body)}<time>${timeAgo(h.at)}</time></div></div>`;}).join('')}</div>`
          : '<div style="color:var(--dim);font-size:12.5px">No activity yet.</div>'}
      </div>
      <div class="dsec"><div class="st">Details</div>
        <div class="kv2">
          <div><div class="k">Sales score</div><div class="v">${scorePill(l.score)}</div></div>
          <div><div class="k">Est. deal value</div><div class="v mono">${money(l.value)}</div></div>
          <div><div class="k">Owner / Rep</div><div class="v">${r?r.name:'Unassigned'}</div></div>
          <div><div class="k">Phone</div><div class="v mono">${l.phone||'—'}</div></div>
          <div><div class="k">Address</div><div class="v" style="font-size:12.5px">${l.street||'—'}, ${l.city} ${l.postal||''}</div></div>
          <div><div class="k">Website</div><div class="v">${l.website?'Live':'None — opportunity'}</div></div>
        </div>
      </div>
      <div class="dsec"><button class="btn danger-ghost" style="width:100%;justify-content:center" onclick="askDeleteLead('${l.id}')">${ic('trash')} Delete lead</button></div>
    </div>`;
  renderAI(l,seed);
  $('#drawer').classList.add('open');
}
export function closeDrawer(){$('#drawer').classList.remove('open');}

/* ---- delete + confirm ---- */
let _confirmCb=null;
export function openConfirm(html,cb){_confirmCb=cb;$('#confirmMsg').innerHTML=html;$('#confirmModal').classList.add('open');}
export function closeConfirm(){$('#confirmModal').classList.remove('open');_confirmCb=null;}
export function doConfirm(){const cb=_confirmCb;_confirmCb=null;$('#confirmModal').classList.remove('open');if(cb)cb();}
export function askDeleteLead(id){const l=leadById(id);if(!l)return;openConfirm(`Delete <b>${l.name}</b> from your CRM?<br><span style="color:var(--muted);font-size:12.5px">This removes the lead and its history. It can’t be undone.</span>`,()=>deleteLead(id));}
