// Map view: Google Maps loader, marker rendering/clustering, the in-map area search, and the
// business popup (InfoWindow). Owns the main `map` instance and the Google-loader state.
import {GOOGLE_KEY,GOOGLE_MAP_ID,stageOf,state,POOL,livePool,addedProspects,pendingMapFocus,setPendingMapFocus,saveGoogleCreds} from './state.js';
import {$,visibleLeads,leadById,prospectById,pill,contactRow,socialChip,placeToBusiness} from './helpers.js';
import {ic} from './icons.js';
import {apiFetch} from './sb.js';
import {reEnrich} from './data.js';
import {searchPlaces} from './finder.js';
import {renderRoutes} from './routes.js';

/* ========== GOOGLE MAPS LOADER ========== */
export let gmapsReady=false;
let gmapsLoading=false, gmapsQueue=[];
export let googleAuthError=null;
export function ensureGoogleMaps(cb){
  if(gmapsReady){cb();return;}
  gmapsQueue.push(cb);
  if(gmapsLoading)return;
  gmapsLoading=true;
  window.onGoogleMapsReady=()=>{
    gmapsReady=true; gmapsLoading=false; googleAuthError=null;
    const q=gmapsQueue; gmapsQueue=[]; q.forEach(fn=>fn());
  };
  window.gm_authFailure=()=>{
    gmapsReady=false; gmapsLoading=false; gmapsQueue=[];
    googleAuthError='Google rejected this API key (invalid, unbilled, or missing the Maps JavaScript API / Places API). Check your key in Cloud Console and try again.';
    if(state.view==='routes')renderRoutes(); else if(state.view==='areas')renderAreas();
  };
  const s=document.createElement('script');
  s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(GOOGLE_KEY)+'&libraries=marker&loading=async&callback=onGoogleMapsReady';
  s.onerror=()=>{
    gmapsLoading=false; gmapsQueue=[];
    googleAuthError='Could not load the Google Maps script — check your internet connection.';
    if(state.view==='routes')renderRoutes(); else if(state.view==='areas')renderAreas();
  };
  document.head.appendChild(s);
}
export function nudgeMap(m){
  if(!m)return;
  const c=m.getCenter();
  google.maps.event.trigger(m,'resize');
  if(c)m.setCenter(c);
}
export function googleGateHTML(containerId){
  const err=googleAuthError?`<div class="card" style="border-color:rgba(239,68,68,.4);margin-bottom:14px;text-align:left"><b style="color:#F87171">Google Maps error</b><div style="color:var(--muted);font-size:13px;margin-top:6px">${googleAuthError}</div></div>`:'';
  return `<div class="empty" style="max-width:400px;margin:40px auto 0">
    ${err}
    ${ic('map','#5C6E8A',40)}
    <div style="font-weight:600;color:var(--text);margin:10px 0 4px">Connect Google Maps</div>
    <div style="font-size:12.5px;margin-bottom:16px">Paste a Google API key (Maps JavaScript API + Places API enabled) to load the map.</div>
    <input id="${containerId}-ggkey" type="password" placeholder="Google API key" value="${GOOGLE_KEY?GOOGLE_KEY.replace(/"/g,'&quot;'):''}" style="width:100%;background:var(--ink);border:1px solid var(--line);border-radius:9px;padding:10px 12px;color:var(--text);font-family:var(--mono);font-size:12px;margin-bottom:8px">
    <input id="${containerId}-ggmapid" type="text" placeholder="Map ID (optional — but required for dark mode; blank uses Google's demo Map ID, which is light-only)" value="${GOOGLE_MAP_ID?GOOGLE_MAP_ID.replace(/"/g,'&quot;'):''}" style="width:100%;background:var(--ink);border:1px solid var(--line);border-radius:9px;padding:10px 12px;color:var(--text);font-family:var(--mono);font-size:12px;margin-bottom:10px">
    <button class="btn" style="width:100%;justify-content:center" onclick="submitGoogleCreds('${containerId}')">${ic('check','#fff',15)} Save &amp; load map</button>
  </div>`;
}
export function submitGoogleCreds(containerId){
  const key=($('#'+containerId+'-ggkey').value||'').trim(), mapId=($('#'+containerId+'-ggmapid').value||'').trim();
  if(!key)return;
  saveGoogleCreds(key,mapId);
  googleAuthError=null;
  if(state.view==='routes')renderRoutes(); else renderAreas();
}

/* ========== MAP (home) ========== */
export let map;
let mapColorScheme=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
export {mapColorScheme};
let searchRadiusCircle=null, mapNoWebOnly=false, mapSearchCollapsed=false;
export const setMapNoWebOnly=v=>{mapNoWebOnly=v;};
export function renderAreas(){
  $('#v-areas').innerHTML=`<div class="maplayout"><div id="map"></div>
    <div class="mapsearch-panel${mapSearchCollapsed?' collapsed':''}" id="mapsearchpanel">
      <div class="ph">
        <div class="ph-row">
          <div><div class="t">Find businesses</div><div class="s">Search Google Places for an area — pans the map there for you</div></div>
          <button class="msf-collapse" id="mapsearchcollapsebtn" onclick="toggleMapSearchPanel()" title="${mapSearchCollapsed?'Expand':'Collapse'}">${ic('chevron','currentColor',18)}</button>
        </div>
      </div>
      <div class="msf-body" id="mapsearchbody">
      <div>
        <div class="msf-lbl">Business type</div>
        <input id="mapSearchCat" type="text" onkeydown="if(event.key==='Enter')searchMapArea()">
      </div>
      <div>
        <div class="msf-lbl">Location <span style="text-transform:none;font-weight:400;opacity:.7">— optional</span></div>
        <input id="mapSearchLoc" type="text" onkeydown="if(event.key==='Enter')searchMapArea()">
      </div>
      <div>
        <div class="msf-lbl">Radius</div>
        <div class="msf-row">
          <input id="mapSearchRadius" type="number" value="5" min="0.1" max="50" step="0.5">
          <span class="msf-unit">km</span>
        </div>
      </div>
      <label class="msf-check"><input type="checkbox" id="mapNoWeb" onchange="setMapNoWebOnly(this.checked)"${mapNoWebOnly?' checked':''}> No website only</label>
      <button class="btn" onclick="searchMapArea()" id="mapsearchbtn">${ic('search','#fff',14)} Search this area</button>
      <div id="mapsearchstatus" class="msf-status"></div>
      <div class="baseseg" id="baseseg" title="${GOOGLE_MAP_ID?'':'Dark mode needs a custom Map ID — Google\'s demo Map ID is light-only. Add one via Connect Google Maps.'}">
        <button data-scheme="light" class="${mapColorScheme==='light'?'on':''}" onclick="toggleColorScheme('light')">Light</button>
        <button data-scheme="dark" class="${mapColorScheme==='dark'?'on':''}" onclick="toggleColorScheme('dark')">Dark</button>
      </div>
      </div>
    </div>
  </div>`;
  setTimeout(initMap,60);
}
export function toggleMapSearchPanel(){
  mapSearchCollapsed=!mapSearchCollapsed;
  const panel=$('#mapsearchpanel'), btn=$('#mapsearchcollapsebtn');
  if(panel)panel.classList.toggle('collapsed',mapSearchCollapsed);
  if(btn)btn.title=mapSearchCollapsed?'Expand':'Collapse';
}
let mapMarkers=[]; // {marker,kind,id} — kept so a pin's popup can be re-opened/anchored by id
export function toggleColorScheme(mode){ // shared by both the main map and routes map
  mapColorScheme=mode;
  document.querySelectorAll('#baseseg button').forEach(b=>b.classList.toggle('on',b.dataset.scheme===mode));
  // colorScheme only takes effect when a vector map is constructed — map.setOptions() can't hot-swap
  // it for maps using a custom Map ID, so rebuild the map in place (keeping the current viewport).
  if(map)initMap({center:map.getCenter(),zoom:map.getZoom()});
}
function initMap(keepView){
  const el=$('#map'); if(!el) return;
  if(!GOOGLE_KEY){el.innerHTML=googleGateHTML('map');return;}
  if(googleAuthError){el.innerHTML=googleGateHTML('map');return;}
  if(!gmapsReady){ensureGoogleMaps(initMap);return;}
  map=new google.maps.Map(el,{
    center:keepView?keepView.center:{lat:43.68,lng:-79.45}, zoom:keepView?keepView.zoom:9.4,
    mapId:GOOGLE_MAP_ID||'DEMO_MAP_ID',
    renderingType:google.maps.RenderingType.VECTOR, // colorScheme (light/dark) only applies to vector maps; the classic constructor defaults to raster otherwise
    colorScheme:mapColorScheme==='dark'?google.maps.ColorScheme.DARK:google.maps.ColorScheme.LIGHT,
    disableDefaultUI:true, clickableIcons:false
  });
  mapMarkers=[];
  drawMarkers();
}
let clusterer=null;
function clearMarkers(){
  if(clusterer){clusterer.clearMarkers();clusterer=null;}
  mapMarkers.forEach(({marker})=>{marker.map=null;});
  mapMarkers=[];
}
// Clusters nearby pins into a single numbered bubble at low zoom, splitting apart as you zoom in
const clusterRenderer={
  render({count,position}){
    const el=document.createElement('div');
    el.className='cluster-marker';
    const size=Math.min(56,32+Math.round(Math.sqrt(count)*6));
    el.style.width=el.style.height=size+'px';
    el.style.fontSize=(count>99?11:13)+'px';
    el.textContent=count>99?'99+':String(count);
    return new google.maps.marker.AdvancedMarkerElement({position,content:el,zIndex:1000+count});
  }
};
function mapBusinesses(){
  const source=livePool.length?livePool:POOL; // live Google Places results take over once fetched
  const leads=visibleLeads().map(l=>({kind:'lead',b:l}));
  const pros=source.filter(p=>!addedProspects.has(p.id)).map(p=>({kind:'prospect',b:p}));
  return [...leads,...pros];
}
export function drawMarkers(){
  if(!map)return;
  closeBizPanel();
  clearMarkers();
  const items=mapBusinesses();
  const markers=[];
  items.forEach(({kind,b})=>{
    const el=document.createElement('div'); el.className='biz-marker';
    if(kind==='lead'){
      const s=stageOf(b.stage), sz=b.hot?18:15;
      el.innerHTML=`<div class="pin" style="--pc:${s.color}">${b.hot?'<span class="pulse"></span>':''}<span class="dot" style="width:${sz}px;height:${sz}px;background:${s.color}"></span></div>`;
    }else{
      el.innerHTML=`<div class="pin"><span class="pdot"></span></div>`;
    }
    const marker=new google.maps.marker.AdvancedMarkerElement({position:{lat:b.lat,lng:b.lng},content:el});
    marker.addListener('gmp-click',()=>showBizPanel(kind,b.id,marker));
    mapMarkers.push({marker,kind,id:b.id});
    markers.push(marker);
  });
  if(window.markerClusterer){
    clusterer=new markerClusterer.MarkerClusterer({map,markers,renderer:clusterRenderer});
  }else{
    markers.forEach(m=>{m.map=map;}); // clustering lib failed to load — fall back to plain pins
  }
  if(pendingMapFocus){
    const id=pendingMapFocus; setPendingMapFocus(null);
    if(mapMarkers.some(m=>m.kind==='lead'&&m.id===id))showBizPanel('lead',id);
  }
}
function drawSearchRadius(lat,lng,radius){
  if(searchRadiusCircle)searchRadiusCircle.setMap(null);
  searchRadiusCircle=new google.maps.Circle({
    map,center:{lat,lng},radius,clickable:false,
    strokeColor:'#4D9FFF',strokeOpacity:.7,strokeWeight:1.5,
    fillColor:'#4D9FFF',fillOpacity:.08
  });
}
async function geocodeLocation(address){
  // Proxied server-side (see /api/geocode) rather than using google.maps.Geocoder client-side,
  // since that would need the Geocoding API enabled on the same key the Maps JS script loads with.
  const res=await apiFetch('/api/geocode?address='+encodeURIComponent(address));
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||(res.status+' '+res.statusText));
  return data;
}
export async function searchMapArea(){
  if(!map)return;
  if(!GOOGLE_KEY){$('#mapsearchstatus').textContent='No Google API key configured — see Connect Google Maps.';return;}
  const query=$('#mapSearchCat').value.trim();
  const locQuery=$('#mapSearchLoc').value.trim();
  const radiusKm=+$('#mapSearchRadius').value;
  const noweb=$('#mapNoWeb').checked;
  if(!query){$('#mapsearchstatus').textContent='Type what kind of business to search for.';return;}
  if(!radiusKm||radiusKm<=0){$('#mapsearchstatus').textContent='Enter a radius greater than 0.';return;}
  const radius=Math.min(radiusKm,50)*1000; // Places caps location-biased search well under 50km anyway
  const btn=$('#mapsearchbtn'), status=$('#mapsearchstatus');
  btn.disabled=true; btn.style.opacity=.6;
  let lat,lng;
  if(locQuery){
    // Geocode the typed place and pan/zoom there so the user never has to drag the map to it themselves
    status.textContent=`Locating "${locQuery}"…`;
    try{
      const geo=await geocodeLocation(locQuery);
      lat=geo.lat; lng=geo.lng;
      if(geo.viewport)map.fitBounds(new google.maps.LatLngBounds(geo.viewport.southwest,geo.viewport.northeast));
      else{map.panTo({lat,lng});map.setZoom(12);}
    }catch(err){
      status.textContent=`Couldn't find "${locQuery}" — ${err.message}`;
      btn.disabled=false; btn.style.opacity=1;
      return;
    }
  }else{
    const c=map.getCenter(); lat=c.lat(); lng=c.lng();
  }
  status.textContent=`Searching "${query}" within ${radiusKm} km of ${locQuery||"where you're looking"}…`;
  try{
    let places=await searchPlaces(query,{lat,lng,radius});
    if(noweb)places=places.filter(p=>!p.websiteUri);
    const seen=new Set(livePool.map(p=>p.id));
    let added=0;
    places.forEach(p=>{
      if(!p.id)return;
      const gid='g_'+p.id;
      if(seen.has(gid)||addedProspects.has(gid))return;
      const biz=placeToBusiness(p,query); // if Google's own type data is ambiguous, fall back to what was typed
      if(!biz.lat||!biz.lng)return;
      seen.add(gid);
      livePool.push(biz);
      added++;
    });
    drawSearchRadius(lat,lng,radius);
    drawMarkers();
    status.textContent=`${added} new result${added===1?'':'s'} found within ${radiusKm} km`+(added?'':' (or already on your map)')+(noweb?' · no website only':'');
  }catch(err){
    status.textContent='Search failed — '+err.message;
  }finally{
    btn.disabled=false; btn.style.opacity=1;
  }
}

/* ========== BUSINESS POPUP ========== */
let bizInfoWindow=null;
export function showBizPanel(kind,id,marker){
  const b=kind==='lead'?leadById(id):prospectById(id);
  if(!b)return;
  if(!marker){
    const found=mapMarkers.find(m=>m.kind===kind&&m.id===id);
    marker=found&&found.marker;
  }
  map.panTo({lat:b.lat,lng:b.lng});
  if(map.getZoom()<14)map.setZoom(14);
  const inCRM=kind==='lead';
  const so=b.socials||{};
  const pending=!b._enrichChecked; // haven't auto-enriched this one yet
  const enrichNote=pending
    ? `${ic('spark','#A855F7',12)} ${b.web?'Scraping '+b.web.replace('https://',''):'Searching for '+b.name}…`
    : `${ic(b._enrichOk?'check':'link',b._enrichOk?'#22C55E':'#5C6E8A',12)} ${b._enrichNote||'From their site, or a web search if they have none'} · <a onclick="reEnrich('${kind}','${b.id}')">Re-enrich</a>`;
  const html=`<div class="biz-popup" id="bizpopup">
    <div class="bd-hero">
      <div class="bd-cat">${b.cat} · ${b.city}</div>
      <h2>${b.name}${b.hot?' 🔥':''}</h2>
      <div class="bd-meta">
        ${inCRM?pill(b.stage):'<span class="pill" style="background:#94A6BF1a;color:#94A6BF"><span class="d" style="background:#94A6BF"></span>Prospect</span>'}
        ${b.website?'':'<span class="nowww">no website</span>'}
        <span class="rate">★ ${b.rating} · ${b.reviewCount} reviews</span>
      </div>
    </div>
    <div class="bd-section">
      <div class="lbl">Business details <span class="srctag places">${ic('pin','#4D9FFF',11)} Google Places</span></div>
      ${contactRow('link','Website',b.web?b.web.replace('https://',''):null,b.web)}
      ${contactRow('phone','Phone',b.phone,'tel:'+b.phone.replace(/[^0-9]/g,''))}
      ${contactRow('pin','Address',b.address,'https://maps.google.com/?q='+encodeURIComponent(b.name+' '+b.city))}
    </div>
    <div class="bd-section">
      <div class="lbl">Email &amp; socials <span class="srctag enriched">${ic('spark','#A855F7',11)} Enriched</span></div>
      ${contactRow('mail','Email',b.email,'mailto:'+b.email)}
      <div class="social-chips" style="margin-top:10px">
        ${socialChip('instagram','Instagram',so.instagram,'https://instagram.com/'+(so.instagram||'').replace('@',''),so.instagramSource==='search')}
        ${socialChip('facebook','Facebook',so.facebook,'https://facebook.com'+(so.facebook||''),so.facebookSource==='search')}
        ${socialChip('globe','Google',so.google,'https://maps.google.com/?q='+encodeURIComponent(b.name))}
      </div>
      <div class="enrichnote">${enrichNote}</div>
    </div>
    <div class="bd-cta">
      ${inCRM
        ? `<div class="incrm">${ic('check','#22C55E',16)} Already in your CRM</div>
           <button class="btn ghost" style="width:100%;justify-content:center;margin-top:8px" onclick="openLead('${b.id}')">Open full record</button>`
        : `<button class="btn" onclick="addProspectToCRM('${b.id}')">${ic('plus','#fff',16)} Add ${b.name.length>18?'to CRM':b.name+' to CRM'}</button>
           <div style="font-size:11px;color:var(--dim);text-align:center;margin-top:8px">Creates a New lead${b.website?'':' · flagged as a no-website opportunity'}</div>`}
    </div>
  </div>`;
  if(!bizInfoWindow)bizInfoWindow=new google.maps.InfoWindow();
  bizInfoWindow.setContent(html);
  if(marker){
    bizInfoWindow.open({anchor:marker,map});
  }else{
    bizInfoWindow.setPosition({lat:b.lat,lng:b.lng});
    bizInfoWindow.open({map});
  }
  // Auto-find socials the first time this business's popup is opened, instead of
  // making the user click "Re-enrich" — the link stays for a manual retry afterward.
  if(pending)reEnrich(kind,id);
}
export function closeBizPanel(){if(bizInfoWindow)bizInfoWindow.close();}
