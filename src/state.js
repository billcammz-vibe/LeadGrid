// Shared application state and constants. Everything that more than one feature module needs to
// read or mutate lives here. Collections (LEADS/REPS/EVENTS/POOL/addedProspects) are const arrays/
// sets mutated in place. Values that get *reassigned* are `export let` with a setter — ES module
// live bindings mean importers always see the latest value, but only the owning module (this one)
// is allowed to reassign, so the mutation goes through a setter.

/* ---- pipeline + category constants ---- */
export const STAGES=[
  {id:'new',name:'New',color:'#7C8AA0'},{id:'contacted',name:'Contacted',color:'#F5A524'},
  {id:'replied',name:'Replied',color:'#4D9FFF'},
  {id:'won',name:'Won',color:'#22C55E'},{id:'lost',name:'Lost',color:'#EF4444'}];
export const stageOf=id=>STAGES.find(s=>s.id===id)||STAGES[0];

// The gaps Lead Finder flags a business for. `label` is the filter-chip text; `color` themes the
// per-row pills. Detection logic + per-gap severity weights live in detectGaps() (helpers.js).
export const GAP_TYPES=[
  {type:'no_website',label:'No website',color:'#EF4444'},
  {type:'weak_site',label:'Weak site',color:'#F5A524'},
  {type:'low_rating',label:'Low rating',color:'#F5A524'},
  {type:'few_reviews',label:'Few reviews',color:'#F5A524'},
  {type:'odd_status',label:'Status issue',color:'#EF4444'},
];
export const gapOf=type=>GAP_TYPES.find(g=>g.type===type);

// Full vertical set — kept intact (and still backs CAT_QUERY_TERMS/REVIEW_THEMES below) for when
// this broadens past one vertical. Order sets both the results-list order and which category wins
// when a place matches more than one query — Nail Salon is deliberately last so it never gets
// priority over the others.
export const ALL_CATS=['HVAC','Plumbing','Restaurant','Auto Repair','Dental','Landscaping','Fitness','Pet Grooming','Nail Salon'];
// Active search scope — dental only for now (2026-09-15, per the business owner). Lead Finder
// searches every category in this list behind the scenes (no user-picked type) and labels each
// result from what Google actually returns — see CAT_QUERY_TERMS / inferCategory below. Swap
// back to ALL_CATS (or a bigger subset) to broaden.
export const CATS=['Dental'];
// Area autosuggest — not a restriction (the field is free text; any area works, anywhere Google
// Places has data), just a convenience dropdown. Spans every region this app is actively used in.
export const AREA_SUGGESTIONS=[
  'Mississauga, ON','Oakville, ON','North York, ON','Vaughan, ON','Scarborough, ON','Toronto, ON','Etobicoke, ON','Brampton, ON','Richmond Hill, ON','Markham, ON',
  'Muscat, Oman','Salalah, Oman','Sohar, Oman','Nizwa, Oman','Sur, Oman','Rustaq, Oman',
];
export const CAT_QUERY_TERMS={'Nail Salon':'nail salons','HVAC':'HVAC contractors','Plumbing':'plumbers',
  'Restaurant':'restaurants','Auto Repair':'auto repair shops','Dental':'dentists',
  'Landscaping':'landscaping companies','Fitness':'gyms','Pet Grooming':'pet groomers'};

// Review themes for the "what their reviews say" heuristic (src/outreach.js genReview). Category-
// based, not region-based — applies the same regardless of where the business is.
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
export const AI_SUGG=['Top leads to call today','Which rep is underloaded?','Summarize an area','No-website opportunities'];

/* ---- live collections (mutated in place, never reassigned) ---- */
export const LEADS=[];
export const REPS=[];
export const EVENTS=[];
export const HISTORY=[]; // lead_history rows: {id,leadId,at:Date,kind,body,meta}
export const POOL=[]; // prospects surfaced by search, not yet in CRM
export const addedProspects=new Set();

/* ---- app view state (an object, so property mutation is visible everywhere) ---- */
export const state={view:'dashboard',rep:'all',finderCat:'',finderGap:'',finderSort:'score',finderArea:'',finderScanned:0,finderResults:[],finderAdded:new Set(),calWeekOffset:0};

/* ---- other reassignable cross-module runtime values ---- */
export let livePool=[];              // businesses fetched live from Google Places (Lead Finder)
export const setLivePool=v=>{livePool=v;};

export let crmView='table';
export const setCrmView=v=>{crmView=v;};
export let crmFilter='all';
export const setCrmFilter=v=>{crmFilter=v;};

export let currentUserName='there';
export const setCurrentUserName=v=>{currentUserName=v;};
