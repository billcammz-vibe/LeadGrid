// Lead Finder view: searches Google Places across every category for an area, lists results, and
// adds them to the CRM. Also owns the low-level searchPlaces() proxy call used by the map search.
import {$,scorePill,placeToBusiness} from './helpers.js';
import {ic} from './icons.js';
import {CATS,CAT_QUERY_TERMS,AREA_SUGGESTIONS,addedProspects,state,setLivePool,LEADS,GOOGLE_KEY} from './state.js';
import {apiFetch,dbError} from './sb.js';
import {map,drawMarkers} from './maps.js';
import {pickRepForNewLead,alreadyInCRM,saveNewLead} from './data.js';
import {updateBadges} from './router.js';

/* ---- area autosuggest ---- */
// Custom-rendered area suggestions — a native <datalist> popup gets clipped by this app's
// scrollable/overflow-hidden ancestors in Chromium, so it can't fully open. This renders
// its own dropdown instead, fully under our control.
export function renderAreaSuggest(showAll){
  const el=$('#areaSuggest'), input=$('#farea'); if(!el||!input)return;
  const q=showAll?'':input.value.trim().toLowerCase();
  const matches=AREA_SUGGESTIONS.filter(a=>!q||a.toLowerCase().includes(q));
  if(!matches.length){el.classList.remove('open');el.innerHTML='';return;}
  el.innerHTML=matches.map(a=>`<button type="button" onmousedown="event.preventDefault();pickArea('${a.replace(/'/g,"\\'")}')">${a}</button>`).join('');
  el.classList.add('open');
}
export function pickArea(a){ $('#farea').value=a; hideAreaSuggest(); }
export function hideAreaSuggest(){ const el=$('#areaSuggest'); if(el){el.classList.remove('open');} }

export function renderFinder(){
  $('#v-finder').innerHTML=`<div class="viewhead"><div><div class="t">Lead Finder</div><div class="s">Search an area via Google Places — every business type at once, categorized from what's actually found</div></div></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:220px" class="area-suggest-wrap"><div class="flbl">Area</div>
          <input id="farea" autocomplete="off" value="Mississauga, ON" style="width:100%;background:var(--ink);border:1px solid var(--line);border-radius:9px;padding:10px 12px;color:var(--text)"
            oninput="renderAreaSuggest()" onfocus="renderAreaSuggest(true)" onblur="setTimeout(hideAreaSuggest,150)">
          <div id="areaSuggest" class="area-suggest"></div></div>
        <div><div class="flbl">Filter</div>
          <label style="display:flex;align-items:center;gap:7px;background:var(--ink);border:1px solid var(--line);border-radius:9px;padding:11px 12px;font-size:13px"><input type="checkbox" id="fnoweb"> No website only</label></div>
        <button class="btn" id="findbtn" onclick="runFinder()"${GOOGLE_KEY?'':' disabled style="opacity:.5;cursor:not-allowed"'}>${ic('search','#fff')} Find leads</button>
      </div>
    </div>
    <div id="finderresults"><div class="empty">${ic('search','#5C6E8A',40)}<div>${GOOGLE_KEY?'Enter an area and run a search.':'No Google API key configured — set VITE_GOOGLE_API_KEY in .env.local, or add one via Connect Google Maps on the Map tab.'}</div><div style="font-size:12px;margin-top:4px">Searches ${CATS.length} categories at once and tags each result by its actual Google Places type.</div></div></div>`;
}

/* ---- Google Places API (New) — searchText, via our /api/places-search proxy ---- */
export async function searchPlaces(textQuery,near){
  const res=await apiFetch('/api/places-search',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({textQuery,near})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||(res.status+' '+res.statusText));
  return data.places||[];
}

export async function runFinder(){
  const area=$('#farea').value.trim(), noweb=$('#fnoweb').checked;
  const out=$('#finderresults'), btn=$('#findbtn');
  if(!GOOGLE_KEY){
    out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+'<div>No Google API key configured — set VITE_GOOGLE_API_KEY in .env.local, or add one via Connect Google Maps on the Map tab.</div></div>';
    return;
  }
  if(!area){
    out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+'<div>Enter an area to search.</div></div>';
    return;
  }
  btn.disabled=true; btn.style.opacity=.6;
  out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+`<div>Searching ${CATS.length} categories in ${area}…</div></div>`;
  try{
    // No user-picked type: query every category in parallel, then label each hit from its own
    // Google Places type (inferCategory), falling back to whichever query found it if that's inconclusive.
    const batches=await Promise.allSettled(CATS.map(c=>searchPlaces(`${CAT_QUERY_TERMS[c]} in ${area}`).then(places=>({cat:c,places}))));
    const failed=batches.filter(b=>b.status==='rejected');
    if(failed.length===batches.length)throw failed[0].reason||new Error('Places API request failed');
    const seen=new Set();
    let res=[];
    batches.forEach(b=>{
      if(b.status!=='fulfilled')return;
      const {cat,places}=b.value;
      places.forEach(p=>{
        if(!p.id||seen.has(p.id)||addedProspects.has('g_'+p.id))return; // skip dupes + businesses already in the CRM
        seen.add(p.id);
        const biz=placeToBusiness(p,cat);
        if(biz.lat&&biz.lng)res.push(biz);
      });
    });
    if(noweb)res=res.filter(b=>!b.website);
    setLivePool(res);                          // feed the map
    state.finderResults=res;
    state.finderArea=area;
    state.finderCat='';
    renderFinderResults(res,area);
    if(state.view==='areas'&&map)drawMarkers();
  }catch(err){
    out.innerHTML=`<div class="card" style="border-color:rgba(239,68,68,.4)"><b style="color:#F87171">Places API error</b><div style="color:var(--muted);font-size:13px;margin-top:6px">${(''+err.message).replace(/</g,'&lt;')}</div><div style="color:var(--dim);font-size:12px;margin-top:8px">Check the key is valid, billing is enabled, and the <b>Places API (New)</b> is turned on. If you opened this file locally, the request still works — but some corporate networks block it.</div></div>`;
  }finally{btn.disabled=false; btn.style.opacity=1;}
}
export function setFinderCat(cat){ state.finderCat=cat; renderFinderResults(state.finderResults,state.finderArea); }

function renderFinderResults(res,area){
  const out=$('#finderresults');
  if(!res.length){out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+'<div>No businesses matched.</div></div>';return;}
  const cats=[...new Set(res.map(p=>p.cat))].sort();
  const rows=state.finderCat?res.filter(p=>p.cat===state.finderCat):res;
  out.innerHTML=`<div style="margin:6px 2px 12px;color:var(--muted);font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${res.length} businesses in ${area||'your area'} <span class="pill" style="background:#22C55E1a;color:#22C55E"><span class="d" style="background:#22C55E"></span>live · Google Places</span></div>
    <div class="filterrow" style="margin-bottom:12px">${['all',...cats].map(c=>`<button class="chip ${(c==='all'?'':c)===state.finderCat?'on':''}" onclick="setFinderCat('${c==='all'?'':c}')">${c==='all'?'All types':c} <span style="opacity:.6">${c==='all'?res.length:res.filter(p=>p.cat===c).length}</span></button>`).join('')}</div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Business</th><th>Category</th><th>Address</th><th>Rating</th><th>Signal</th><th>Score</th><th></th></tr></thead><tbody>
    ${rows.map(p=>{const i=res.indexOf(p);return `<tr><td><div class="biz"><b>${p.name}</b><small>${p.city||''} · ${p.phone||'no phone'}</small></div></td>
      <td class="nowrap" style="font-size:12px;color:var(--muted)">${p.cat}</td>
      <td class="nowrap" style="font-size:12px;color:var(--muted)">${p.street||'—'}</td>
      <td class="mono nowrap">★ ${p.rating||'—'} · ${p.reviewCount||0}</td>
      <td>${p.website?'<span style="color:var(--muted);font-size:12px">has site</span>':'<span class="nowww">no website</span>'}</td>
      <td>${scorePill(p.score)}</td>
      <td><button class="btn ghost" id="add-${i}" onclick="addFromFinder(${i})" style="padding:6px 12px">${ic('plus')} Add</button></td></tr>`;}).join('')}
    </tbody></table></div>`;
}
export function addFromFinder(i){
  const p=state.finderResults[i];if(!p)return;
  const markAdded=()=>{const btn=$('#add-'+i);if(btn)btn.outerHTML='<span style="color:var(--won);font-size:12px;font-weight:600">✓ In CRM</span>';};
  if(alreadyInCRM(p.id)){markAdded();return;}
  const rep=pickRepForNewLead();
  if(!rep){dbError('Add a rep before adding leads to your CRM — see the Reps tab.');return;}
  addedProspects.add(p.id);
  const nl={...p,id:'l_'+p.id+'_'+Date.now(),sourceId:p.id,stage:'new',rep:rep.id};
  LEADS.push(nl);
  markAdded();
  updateBadges();
  if(state.view==='areas'&&map)drawMarkers();
  saveNewLead(nl,p.id);
}
