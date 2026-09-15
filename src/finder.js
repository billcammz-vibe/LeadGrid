// Lead Finder view: searches Google Places across every category for an area, flags businesses
// with a gap, and adds them to the CRM. Also owns the low-level searchPlaces() proxy call.
import {$,scorePill,placeToBusiness,gapChips} from './helpers.js';
import {ic} from './icons.js';
import {CATS,CAT_QUERY_TERMS,AREA_SUGGESTIONS,GAP_TYPES,addedProspects,state,setLivePool,LEADS} from './state.js';
import {apiFetch,dbError} from './sb.js';
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

// "Dental" when scoped to one vertical, "HVAC, Plumbing, …" when broadened later.
const catScopeLabel=()=>CATS.join(', ');

export function renderFinder(){
  $('#v-finder').innerHTML=`<div class="viewhead"><div><div class="t">Lead Finder</div><div class="s">Searching <b>${catScopeLabel()}</b> via Google Places — flags every business with a gap you can pitch and tags it with the reason</div></div></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:220px" class="area-suggest-wrap"><div class="flbl">Area</div>
          <input id="farea" autocomplete="off" value="Mississauga, ON" style="width:100%;background:var(--ink);border:1px solid var(--line);border-radius:9px;padding:10px 12px;color:var(--text)"
            oninput="renderAreaSuggest()" onfocus="renderAreaSuggest(true)" onblur="setTimeout(hideAreaSuggest,150)">
          <div id="areaSuggest" class="area-suggest"></div></div>
        <button class="btn" id="findbtn" onclick="runFinder()">${ic('search','#fff')} Find leads</button>
      </div>
    </div>
    <div id="finderresults"><div class="empty">${ic('search','#5C6E8A',40)}<div>Enter an area and run a search.</div><div style="font-size:12px;margin-top:4px">Searches ${catScopeLabel()} businesses, keeps only ones with a gap — no website, low rating, few reviews, or an odd status — and scores each by gap severity × demand.</div></div></div>`;
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
  const area=$('#farea').value.trim();
  const out=$('#finderresults'), btn=$('#findbtn');
  if(!area){
    out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+'<div>Enter an area to search.</div></div>';
    return;
  }
  btn.disabled=true; btn.style.opacity=.6;
  out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+`<div>Searching for ${catScopeLabel()} in ${area}…</div></div>`;
  try{
    // No user-picked type: query every category in CATS (currently just Dental — see state.js) in
    // parallel, then label each hit from its own Google Places type (inferCategory), falling back
    // to whichever query found it if that's inconclusive.
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
    const scanned=res.length;
    res=res.filter(b=>b.gaps&&b.gaps.length); // only businesses with something to pitch
    setLivePool(res);
    state.finderResults=res;
    state.finderArea=area;
    state.finderScanned=scanned;
    state.finderCat=''; state.finderGap=''; state.finderSort='score';
    renderFinderResults(res,area);
  }catch(err){
    out.innerHTML=`<div class="card" style="border-color:rgba(239,68,68,.4)"><b style="color:#F87171">Places API error</b><div style="color:var(--muted);font-size:13px;margin-top:6px">${(''+err.message).replace(/</g,'&lt;')}</div><div style="color:var(--dim);font-size:12px;margin-top:8px">Check the key is valid, billing is enabled, and the <b>Places API (New)</b> is turned on. If you opened this file locally, the request still works — but some corporate networks block it.</div></div>`;
  }finally{btn.disabled=false; btn.style.opacity=1;}
}
export function setFinderCat(cat){ state.finderCat=cat; renderFinderResults(state.finderResults,state.finderArea); }
export function setFinderGap(gap){ state.finderGap=gap; renderFinderResults(state.finderResults,state.finderArea); }
export function setFinderSort(sort){ state.finderSort=sort; renderFinderResults(state.finderResults,state.finderArea); }

function renderFinderResults(res,area){
  const out=$('#finderresults');
  const scanned=state.finderScanned||0;
  if(!res.length){out.innerHTML='<div class="empty">'+ic('search','#5C6E8A',34)+`<div>Scanned ${scanned} businesses — none had a gap worth pitching (all had a site, a solid rating, and enough reviews).</div></div>`;return;}
  const cats=[...new Set(res.map(p=>p.cat))].sort();
  const gapCount=t=>res.filter(p=>p.gaps.some(g=>g.type===t)).length;
  const sort=state.finderSort||'score';
  let rows=res.slice();
  if(state.finderCat)rows=rows.filter(p=>p.cat===state.finderCat);
  if(state.finderGap)rows=rows.filter(p=>p.gaps.some(g=>g.type===state.finderGap));
  rows.sort((a,b)=>sort==='rating'?(b.rating||0)-(a.rating||0):sort==='reviews'?(b.reviewCount||0)-(a.reviewCount||0):b.score-a.score);
  const chip=(on,label,count,fn)=>`<button class="chip ${on?'on':''}" onclick="${fn}">${label} <span style="opacity:.6">${count}</span></button>`;
  out.innerHTML=`<div style="margin:6px 2px 12px;color:var(--muted);font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${res.length} flagged of ${scanned} scanned in ${area||'your area'} <span class="pill" style="background:#22C55E1a;color:#22C55E"><span class="d" style="background:#22C55E"></span>live · Google Places</span></div>
    ${cats.length>1?`<div class="filterrow" style="margin-bottom:8px">${chip(!state.finderCat,'All types',res.length,"setFinderCat('')")}${cats.map(c=>chip(c===state.finderCat,c,res.filter(p=>p.cat===c).length,`setFinderCat('${c}')`)).join('')}</div>`:''}
    <div class="filterrow" style="margin-bottom:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      ${chip(!state.finderGap,'Any gap',res.length,"setFinderGap('')")}${GAP_TYPES.filter(g=>gapCount(g.type)).map(g=>chip(g.type===state.finderGap,g.label,gapCount(g.type),`setFinderGap('${g.type}')`)).join('')}
      <span style="flex:1"></span>
      <span style="font-size:12px;color:var(--dim)">Sort</span>
      <div class="seg">${[['score','Score'],['rating','Rating'],['reviews','Reviews']].map(([k,l])=>`<button class="${sort===k?'on':''}" onclick="setFinderSort('${k}')">${l}</button>`).join('')}</div>
    </div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Business</th><th>Category</th><th>Address</th><th>Rating</th><th>Why flagged</th><th>Score</th><th></th></tr></thead><tbody>
    ${rows.map(p=>{const i=res.indexOf(p);return `<tr><td><div class="biz"><b>${p.name}</b><small>${p.city||''} · ${p.phone||'no phone'}</small></div></td>
      <td class="nowrap" style="font-size:12px;color:var(--muted)">${p.cat}</td>
      <td class="nowrap" style="font-size:12px;color:var(--muted)">${p.street||'—'}</td>
      <td class="mono nowrap">★ ${p.rating||'—'} · ${p.reviewCount||0}</td>
      <td>${gapChips(p)}</td>
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
  saveNewLead(nl,p.id);
}
