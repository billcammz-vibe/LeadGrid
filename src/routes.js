// Routes view: nearest-neighbour field route for a rep, drawn on its own map.
import {$,haversine,repById} from './helpers.js';
import {LEADS,REPS,state,GOOGLE_KEY,GOOGLE_MAP_ID} from './state.js';
import {gmapsReady,googleAuthError,mapColorScheme,ensureGoogleMaps,googleGateHTML} from './maps.js';
import {openLead} from './drawer.js';

let routemap;
export function renderRoutes(){
  const rep=state.rep==='all'?'r1':state.rep;
  const stops=optimizeRoute(LEADS.filter(l=>l.rep===rep&&!['won','lost'].includes(l.stage)));
  let dist=0,legs=[];
  for(let i=1;i<stops.length;i++){const d=haversine(stops[i-1],stops[i]);dist+=d;legs.push(d);}
  const drive=Math.round(dist/40*60+stops.length*15);
  $('#v-routes').innerHTML=`<div class="viewhead"><div><div class="t">Routes</div><div class="s">Optimized field route for ${repById(rep).name}</div></div>
    <div class="seg">${REPS.map(r=>`<button class="${rep===r.id?'on':''}" onclick="state.rep='${r.id}';renderRoutes()">${r.init}</button>`).join('')}</div></div>
    <div class="routelayout">
      <div class="routepanel">
        <div class="routestats">
          <div class="rs"><div class="v">${stops.length}</div><div class="l">stops</div></div>
          <div class="rs"><div class="v">${dist.toFixed(1)}<small style="font-size:12px"> km</small></div><div class="l">drive</div></div>
          <div class="rs"><div class="v">${Math.floor(drive/60)}h ${drive%60}m</div><div class="l">est. day</div></div>
        </div>
        <div class="stops">${stops.length?'<div style="position:relative"><div class="stopline"></div>'+stops.map((l,i)=>`<div class="stop" onclick="panRouteTo(${l.lat},${l.lng},'${l.id}')"><span class="num">${i+1}</span><div class="si"><b>${l.name}</b><small>${l.city} · ${l.cat}${l.website?'':' · no website'}</small></div><div class="st">${i===0?'start':legs[i-1].toFixed(1)+' km'}</div></div>`).join('')+'</div>':'<div class="empty">No open leads for this rep.</div>'}</div>
      </div>
      <div id="routemap"></div>
    </div>`;
  setTimeout(()=>initRouteMap(stops),60);
}
export function panRouteTo(lat,lng,id){
  if(routemap){routemap.panTo({lat,lng});routemap.setZoom(14);}
  openLead(id);
}
function optimizeRoute(leads){
  if(leads.length<2)return leads;
  const start={lat:43.5890,lng:-79.6441}; // agency base (Mississauga)
  let remaining=[...leads],route=[],cur=start;
  while(remaining.length){
    remaining.sort((a,b)=>haversine(cur,a)-haversine(cur,b));
    const next=remaining.shift();route.push(next);cur=next;
  }
  return route;
}
function initRouteMap(stops){
  routemap=null;
  const el=$('#routemap'); if(!el)return;
  if(!stops.length)return;
  if(!GOOGLE_KEY){el.innerHTML=googleGateHTML('routemap');return;}
  if(googleAuthError){el.innerHTML=googleGateHTML('routemap');return;}
  if(!gmapsReady){ensureGoogleMaps(()=>initRouteMap(stops));return;}
  routemap=new google.maps.Map(el,{
    center:{lat:stops[0].lat,lng:stops[0].lng}, zoom:10,
    mapId:GOOGLE_MAP_ID||'DEMO_MAP_ID',
    renderingType:google.maps.RenderingType.VECTOR,
    colorScheme:mapColorScheme==='dark'?google.maps.ColorScheme.DARK:google.maps.ColorScheme.LIGHT,
    disableDefaultUI:true, clickableIcons:false
  });
  new google.maps.Polyline({
    path:stops.map(l=>({lat:l.lat,lng:l.lng})), map:routemap, strokeOpacity:0,
    icons:[{icon:{path:'M 0,-1 0,1',strokeOpacity:1,strokeColor:'#2F6BFF',scale:3},offset:'0',repeat:'12px'}]
  });
  const bounds=new google.maps.LatLngBounds();
  stops.forEach((l,i)=>{
    bounds.extend({lat:l.lat,lng:l.lng});
    const pinEl=document.createElement('div');
    pinEl.innerHTML=`<div class="rpin">${i+1}</div>`;
    const marker=new google.maps.marker.AdvancedMarkerElement({map:routemap,position:{lat:l.lat,lng:l.lng},content:pinEl});
    const info=new google.maps.InfoWindow({content:'<b style="font-family:var(--disp)">'+l.name+'</b>'});
    marker.addListener('gmp-click',()=>info.open({anchor:marker,map:routemap}));
  });
  routemap.fitBounds(bounds,44);
}
// routemap is read by the resize handler in main.js
export const getRouteMap=()=>routemap;
