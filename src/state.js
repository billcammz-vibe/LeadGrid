// Shared application state and constants. Everything that more than one feature module needs to
// read or mutate lives here. Collections (LEADS/REPS/EVENTS/POOL/addedProspects) are const arrays/
// sets mutated in place. Values that get *reassigned* are `export let` with a setter — ES module
// live bindings mean importers always see the latest value, but only the owning module (this one)
// is allowed to reassign, so the mutation goes through a setter.

/* ---- pipeline + category constants ---- */
export const STAGES=[
  {id:'new',name:'New',color:'#7C8AA0'},{id:'contacted',name:'Contacted',color:'#F5A524'},
  {id:'qualified',name:'Qualified',color:'#4D9FFF'},{id:'proposal',name:'Proposal',color:'#A855F7'},
  {id:'won',name:'Won',color:'#22C55E'},{id:'lost',name:'Lost',color:'#EF4444'}];
export const stageOf=id=>STAGES.find(s=>s.id===id);
export const CATS=['HVAC','Plumbing','Restaurant','Auto Repair','Dental','Landscaping','Fitness','Pet Grooming','Nail Salon'];
// Lead Finder searches every category behind the scenes (no user-picked type) and labels each
// result from what Google actually returns — see CAT_QUERY_TERMS / inferCategory below.
// Order here sets both the results-list order and which category wins when a place matches more
// than one query — Nail Salon is deliberately last so it never gets priority over the others.
export const AREA_SUGGESTIONS=['Mississauga, ON','Oakville, ON','North York, ON','Vaughan, ON','Scarborough, ON','Toronto, ON','Etobicoke, ON','Brampton, ON','Richmond Hill, ON','Markham, ON'];
export const CAT_QUERY_TERMS={'Nail Salon':'nail salons','HVAC':'HVAC contractors','Plumbing':'plumbers',
  'Restaurant':'restaurants','Auto Repair':'auto repair shops','Dental':'dentists',
  'Landscaping':'landscaping companies','Fitness':'gyms','Pet Grooming':'pet groomers'};

/* ---- synthetic-enrichment lookup tables ---- */
export const STREETS=['Lakeshore Rd','Dundas St W','Hurontario St','Yonge St','Queen St E','Bloor St W','Danforth Ave','Eglinton Ave','Kingston Rd','Rutherford Rd'];
export const FSA={'Mississauga':'L5','Oakville':'L6','North York':'M2','Vaughan':'L4','Toronto':'M5','Scarborough':'M1'};
export const PLET='ABCEGHJKLMNPRSTVXY'; // letters valid in Canadian postal codes
// Review themes + sample-review generator source. Mirrors the shape of the Google Places `reviews`
// array so real review objects drop straight into b.reviews later.
export const REVIEW_THEMES={
  'Nail Salon':{pros:['clean, relaxing space','friendly, skilled technicians','great nail art'],cons:['occasional wait times','phone-only booking']},
  'HVAC':{pros:['fast response times','honest, upfront pricing','knowledgeable techs'],cons:['scheduling delays in peak season']},
  'Plumbing':{pros:['quick emergency service','fair quotes','tidy workmanship'],cons:['sometimes hard to reach by phone']},
  'Restaurant':{pros:['great food','generous portions','warm service'],cons:['long weekend waits','no online ordering']},
  'Auto Repair':{pros:['trustworthy diagnosis','fair pricing'],cons:['communication could be smoother']},
  'Dental':{pros:['gentle, caring staff','modern, clean office'],cons:['wait times','billing questions']},
  'Landscaping':{pros:['reliable crews','tidy, detailed work'],cons:['scheduling flexibility']},
  'Fitness':{pros:['motivating trainers','clean equipment'],cons:['peak-hour crowding']},
  'Pet Grooming':{pros:['gentle with anxious pets','great haircuts','clean, calm space'],cons:['limited weekend slots','booking can be slow']}
};
export const REVIEW_AUTHORS=['Sarah M.','Jason T.','Priya K.','Mike D.','Amanda R.','Carlos V.','Nina P.','Dave L.','Grace W.','Tom H.'];
export const REVIEW_TIMES=['2 days ago','1 week ago','3 weeks ago','1 month ago','2 months ago'];
export const AI_SUGG=['Top leads to call today','Which rep is underloaded?','Summarize Mississauga','No-website opportunities'];

/* ---- live collections (mutated in place, never reassigned) ---- */
export const LEADS=[];
export const REPS=[];
export const EVENTS=[];
export const POOL=[]; // prospects on the map, not yet in CRM
export const addedProspects=new Set();

/* ---- app view state (an object, so property mutation is visible everywhere) ---- */
export const state={view:'areas',rep:'all',finderCat:'',finderArea:'',finderResults:[],finderAdded:new Set(),calWeekOffset:0};

/* ---- Google Maps / Places credentials (reassignable) ---- */
export let GOOGLE_KEY=localStorage.getItem('lg_google_key')||import.meta.env.VITE_GOOGLE_API_KEY||'';       // Maps JS key — client-side by necessity, protected by HTTP referrer restriction
export let GOOGLE_MAP_ID=localStorage.getItem('lg_google_mapid')||import.meta.env.VITE_GOOGLE_MAP_ID||'';   // optional; falls back to DEMO_MAP_ID
export function saveGoogleCreds(key,mapId){
  GOOGLE_KEY=(key||'').trim();
  GOOGLE_MAP_ID=(mapId||'').trim();
  if(GOOGLE_KEY)localStorage.setItem('lg_google_key',GOOGLE_KEY);else localStorage.removeItem('lg_google_key');
  if(GOOGLE_MAP_ID)localStorage.setItem('lg_google_mapid',GOOGLE_MAP_ID);else localStorage.removeItem('lg_google_mapid');
}

/* ---- other reassignable cross-module runtime values ---- */
export let livePool=[];              // businesses fetched live from Google Places
export const setLivePool=v=>{livePool=v;};

export let crmView='table';
export const setCrmView=v=>{crmView=v;};
export let crmFilter='all';
export const setCrmFilter=v=>{crmFilter=v;};

export let currentUserName='there';
export const setCurrentUserName=v=>{currentUserName=v;};

export let pendingMapFocus=null; // lead id to pan to + open once drawMarkers next runs — set by viewLeadOnMap
export const setPendingMapFocus=v=>{pendingMapFocus=v;};
