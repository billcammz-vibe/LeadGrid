// Lead detail drawer + the shared confirm modal.
import {$,leadById,repById,pill,scorePill,money,hash} from './helpers.js';
import {STAGES,state,setPendingMapFocus} from './state.js';
import {ic} from './icons.js';
import {aiScaffold,renderAI,setCurLead,setAiSeed} from './outreach.js';
import {deleteLead} from './data.js';
import {go} from './router.js';

export function openLead(id){
  const l=leadById(id),r=repById(l.rep);
  setCurLead(id); const seed=hash(l.name)%2; setAiSeed(seed);
  $('#drawerbody').innerHTML=`
    <div class="dhead">
      <button class="x" onclick="closeDrawer()">${ic('x')}</button>
      <div class="dcat">${l.cat} · ${l.city}</div>
      <h2>${l.name} ${l.hot?'🔥':''}</h2>
      <div class="dmeta">${pill(l.stage)} ${l.website?'':'<span class="nowww">no website</span>'} <span class="cat">★ ${l.rating} (${l.reviewCount})</span> ${scorePill(l.score)}</div>
    </div>
    <div class="dbody">
      ${aiScaffold()}
      <div class="dsec"><div class="st">Stage &amp; actions</div>
        <div class="stageflow">${STAGES.filter(s=>s.id!=='lost').map(s=>`<button class="${l.stage===s.id?'on':''}" style="${l.stage===s.id?'background:'+s.color+';border-color:'+s.color:''}" onclick="setStage('${l.id}','${s.id}')">${s.name}</button>`).join('')}</div>
        <div class="dacts"><button class="btn" onclick="window.location.href='tel:${(l.phone||'').replace(/[^\d+]/g,'')}'"${l.phone?'':' disabled style="opacity:.5;cursor:not-allowed"'}>${ic('phone','#fff')} Call</button><button class="btn ghost" onclick="addToRoute('${l.id}')">${ic('route')} Add to route</button><button class="btn ghost" onclick="viewLeadOnMap('${l.id}')">${ic('map')} View on map</button></div>
      </div>
      <div class="dsec"><div class="st">Details</div>
        <div class="kv2">
          <div><div class="k">Sales score</div><div class="v">${scorePill(l.score)}</div></div>
          <div><div class="k">Est. deal value</div><div class="v mono">${money(l.value)}</div></div>
          <div><div class="k">Owner / Rep</div><div class="v">${r.name}</div></div>
          <div><div class="k">Phone</div><div class="v mono">${l.phone}</div></div>
          <div><div class="k">Address</div><div class="v" style="font-size:12.5px">${l.street}, ${l.city} ${l.postal}</div></div>
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
export function askDeleteLead(id){const l=leadById(id);if(!l)return;openConfirm(`Delete <b>${l.name}</b> from your CRM?<br><span style="color:var(--muted);font-size:12.5px">This removes the lead and its outreach. It can’t be undone.</span>`,()=>deleteLead(id));}

export function addToRoute(id){closeDrawer();const l=leadById(id);state.rep=l.rep;go('routes');setTimeout(()=>alert(l.name+' added to '+repById(l.rep).name+"'s route"),120);}
export function viewLeadOnMap(id){
  const l=leadById(id); if(!l||!l.lat||!l.lng)return;
  closeDrawer();
  state.rep=l.rep; // so the lead's marker is visible even if the map's rep filter was on someone else
  setPendingMapFocus(id);
  go('areas');
}
