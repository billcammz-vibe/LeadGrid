// Formatting, DOM, scoring, and business-shape helpers shared across feature modules.
import {ic} from './icons.js';
import {stageOf,LEADS,REPS,POOL,livePool,state,gapOf} from './state.js';

export const $=s=>document.querySelector(s);
export const money=n=>'$'+n.toLocaleString();
export const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
export const esc=s=>(''+(s??'')).replace(/&/g,'&amp;').replace(/</g,'&lt;');
export const escAttr=s=>esc(s).replace(/"/g,'&quot;');
export function timeAgo(dateStr){
  if(!dateStr)return'';
  const mins=Math.floor((Date.now()-new Date(dateStr).getTime())/60000);
  if(mins<1)return'just now';
  if(mins<60)return mins+'m ago';
  const hrs=Math.floor(mins/60);
  if(hrs<24)return hrs+'h ago';
  return Math.floor(hrs/24)+'d ago';
}
export const leadById=id=>LEADS.find(l=>l.id===id);
export const repById=id=>REPS.find(r=>r.id===id);
export const visibleLeads=()=>state.rep==='all'?LEADS:LEADS.filter(l=>l.rep===state.rep);
export const prospectById=id=>POOL.find(p=>p.id===id)||livePool.find(p=>p.id===id);
export function pill(stageId){const s=stageOf(stageId);return '<span class="pill" style="background:'+s.color+'1a;color:'+s.color+'"><span class="d" style="background:'+s.color+'"></span>'+s.name+'</span>';}
export function repAv(id){const r=repById(id);return r?'<span class="repav" style="background:'+r.color+'" title="'+r.name+'">'+r.init+'</span>':'—';}
export function scoreColor(s){return s>=75?'#22C55E':s>=58?'#4D9FFF':s>=45?'#F5A524':'#EF4444';}

/* ---- gap detection + lead scoring ---- */
// What makes a business a lead: it has a phone number on its Google profile, plenty of reviews
// (proof it has real demand), and at least one of the reviews Google returned for it complains
// that customers couldn't get a reply, couldn't book, or were never answered — i.e. it is losing
// enquiries it already pays to attract. Heuristic keyword match on the review text (English +
// a few Arabic phrases); the matching reviews are kept on the lead so a human can read them.
export const MIN_REVIEWS=50;
const COMPLAINT_THEMES=[
  {theme:'never answered',res:[
    /\b(no\s?one|nobody)\s+(ever\s+)?(answers?|answered|picks?\s+up|picked\s+up)\b/i,
    /\b(never|not|didn'?t|did\s+not|don'?t|do\s+not|doesn'?t|does\s+not|won'?t|wouldn'?t|couldn'?t|could\s+not|can'?t|cannot)\s+(\w+\s+){0,2}?(answer|answered|answers|pick\s+up|picked\s+up|call\s+back|called\s+back|return(ed)?\s+(my|our|the)\s+(calls?|messages?))\b/i,
    /\b(goes?\s+(straight\s+)?to\s+voicemail|always\s+(busy|engaged)|rings?\s+(out|forever)|no\s+answer|unreachable)\b/i]},
  {theme:"couldn't book",res:[
    /\b(couldn'?t|could\s+not|can'?t|cannot|unable\s+to|wasn'?t\s+able\s+to|impossible\s+to|hard\s+to|difficult\s+to|no\s+way\s+to)\s+(\w+\s+){0,2}?(book|schedule|reserve|get\s+an?\s+appointment|make\s+an?\s+appointment|get\s+through|reach|contact)\b/i]},
  {theme:'no reply',res:[
    /\b(no|zero|never\s+(got|received|had)\s+(a|any))\s+(reply|replies|response|responses|callback|call[\s-]?back)\b/i,
    /\b(never|not|didn'?t|did\s+not|doesn'?t|does\s+not|won'?t|wouldn'?t)\s+(\w+\s+){0,2}?(reply|replied|respond|responded|get\s+back\s+to)\b/i,
    /\b(unresponsive|non[\s-]?responsive|ignored\s+(my|our)|ghosted)\b/i,
    /(\u0645\u0627\s*(\u064a\u0631\u062f\u0648\u0646|\u064a\u0631\u062f\u0648\u0627|\u064a\u0631\u062f|\u0631\u062f\u0648\u0627|\u0631\u062f|\u062c\u0627\u0648\u0628|\u064a\u062c\u0627\u0648\u0628\u0648\u0646|\u064a\u062c\u0627\u0648\u0628)|\u0644\u0627\s*(\u064a\u0631\u062f\u0648\u0646|\u064a\u0631\u062f|\u064a\u062c\u064a\u0628\u0648\u0646|\u064a\u062c\u064a\u0628)|\u0645\u0627\u0641\u064a\s*\u0631\u062f)/]},
];
// Which complaint (if any) a review's text makes. First theme that matches wins.
export function complaintTheme(text){
  const t=''+(text||'');
  if(!t)return null;
  for(const c of COMPLAINT_THEMES){ if(c.res.some(re=>re.test(t)))return c.theme; }
  return null;
}
// Returns [{type,tag,sev}]. A business with an empty array isn't a lead. `b.reviews` holds the
// complaint reviews found at search time ({rating,text,theme,complaint:true,...}) — see
// placeToBusiness(). Closed businesses are never leads.
export function detectGaps(b){
  const g=[], rc=b.reviewCount||0;
  if(b.status && b.status!=='OPERATIONAL')return g;
  const hits=(b.reviews||[]).filter(r=>r&&r.complaint);
  if(b.phone && rc>=MIN_REVIEWS && hits.length){
    const themes=[...new Set(hits.map(h=>h.theme).filter(Boolean))].slice(0,2).join(', ');
    g.push({type:'unanswered',tag:`${hits.length} review${hits.length===1?'':'s'}: ${themes||'no reply'}`,sev:Math.min(.6+.15*(hits.length-1),1)});
  }
  return g;
}
// How much proven demand a business has: rating quality blended with review volume, 0..1.
// A highly-rated, heavily-reviewed business scores near 1; a thin or poorly-rated one near 0.15.
export function demandSignal(b){
  const rq=b.rating?Math.min(b.rating/4.8,1):0.55;                 // unknown rating → neutral
  const vol=Math.min(Math.log10((b.reviewCount||0)+1)/2.2,1);     // ~160 reviews → ~1
  return 0.15+0.85*(0.45*rq+0.55*vol);
}
// Lead score = gap severity × demand signal. A thriving business with a real gap (e.g. no site)
// outranks a struggling one with the same gap. 0 when nothing is flagged. Heuristic — tune freely.
export function scoreFor(b){
  const gaps=b.gaps||detectGaps(b);
  if(!gaps.length)return 0;
  const severity=Math.min(gaps.reduce((s,g)=>s+g.sev,0),1);
  return Math.max(1,Math.min(100,Math.round(100*severity*demandSignal(b))));
}
// One-line "why flagged" string, e.g. "No website · 4.6★ · 82 reviews". Leads with the gap tags,
// then appends rating/review context that isn't already spoken for by a gap.
export function gapSummary(b){
  const gaps=b.gaps||detectGaps(b);
  const parts=gaps.map(g=>g.tag);
  if(b.rating) parts.push(b.rating+'★');
  parts.push((b.reviewCount||0)+' reviews');
  return parts.join(' · ');
}
// Row of coloured pills, one per gap — themed from GAP_TYPES.
export function gapChips(b){
  const gaps=b.gaps||[];
  if(!gaps.length)return '<span style="color:var(--dim)">—</span>';
  return `<div class="gapchips">${gaps.map(g=>{const c=(gapOf(g.type)||{}).color||'#94A6BF';
    return `<span class="pill" style="background:${c}1a;color:${c};font-size:11px"><span class="d" style="background:${c}"></span>${g.tag}</span>`;}).join('')}</div>`;
}
export function scorePill(s){const c=scoreColor(s);return `<span class="scorepill"><span class="sbar"><i style="width:${s}%;background:${c}"></i></span><b style="color:${c}">${s}</b></span>`;}
export function socialIcons(b){const so=b.socials||{},it=[];
  if(so.instagram)it.push(`<a class="sic" href="https://instagram.com/${so.instagram.replace('@','')}" target="_blank" rel="noopener" title="Instagram${so.instagramSource==='search'?' (found via search — unverified)':''}" onclick="event.stopPropagation()">${ic('instagram',so.instagramSource==='search'?'#8B6FB8':'#C084FC',15)}</a>`);
  if(so.facebook)it.push(`<a class="sic" href="https://facebook.com${so.facebook}" target="_blank" rel="noopener" title="Facebook${so.facebookSource==='search'?' (found via search — unverified)':''}" onclick="event.stopPropagation()">${ic('facebook',so.facebookSource==='search'?'#3D6690':'#4D9FFF',15)}</a>`);
  if(so.google)it.push(`<a class="sic" href="https://maps.google.com/?q=${encodeURIComponent(b.name)}" target="_blank" rel="noopener" title="Google" onclick="event.stopPropagation()">${ic('globe','#8DA0BC',15)}</a>`);
  return it.length?`<div class="sics">${it.join('')}</div>`:'<span style="color:var(--dim)">—</span>';}
export function haversine(a,b){const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}

/* ---- category inference from Google Places types ---- */
export function inferCategory(types){
  const joined=(types||[]).join(' ');
  if(/hvac|heating|air_conditioning/.test(joined))return 'HVAC';
  if(/plumb/.test(joined))return 'Plumbing';
  if(/restaurant|cafe|bakery|meal_|bar\b|food/.test(joined))return 'Restaurant';
  if(/car_repair|car_wash|auto/.test(joined))return 'Auto Repair';
  if(/dent/.test(joined))return 'Dental';
  if(/doctor|clinic|hospital|physiotherap|medical/.test(joined))return 'Medical';
  if(/veterinar/.test(joined))return 'Veterinary';
  if(/hair_care|barber|beauty_salon|hair_salon/.test(joined))return 'Hair & Beauty';
  if(/\bspa\b|massage/.test(joined))return 'Spa';
  if(/electrician/.test(joined))return 'Electrical';
  if(/real_estate/.test(joined))return 'Real Estate';
  if(/lawyer|law_firm|attorney/.test(joined))return 'Legal';
  if(/landscap|lawn/.test(joined))return 'Landscaping';
  if(/gym|fitness/.test(joined))return 'Fitness';
  if(/pet_grooming|pet_groomer/.test(joined))return 'Pet Grooming';
  if(/nail_salon/.test(joined))return 'Nail Salon';
  return 'Other';
}

// hash() is used elsewhere (e.g. drawer.js picks a deterministic AI-copy variant from it) — the
// rest of the old synthetic-enrichment fabricator (fake .ca emails/sites, Canadian postal codes,
// made-up reviews) was dead code (nothing called enrich() any more) and Canada-only, so it's gone.
export function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}

/* ---- Google Places → internal business shape ---- */
export function comp(p,type){const c=(p.addressComponents||[]).find(x=>(x.types||[]).includes(type));return c?(c.shortText||c.longText||''):'';}
// Google returns at most 5 "most relevant" reviews per place, so this only ever sees those.
function placeComplaints(p){
  return (p.reviews||[]).map(r=>{
    const text=((r.text&&r.text.text)||'').trim();
    const orig=((r.originalText&&r.originalText.text)||'').trim();
    const rating=r.rating||0;
    const theme=rating<=4?(complaintTheme(text)||complaintTheme(orig)):null;
    return theme?{author:(r.authorAttribution&&r.authorAttribution.displayName)||'A customer',rating,
      time:r.relativePublishTimeDescription||'',text:text||orig,theme,complaint:true}:null;
  }).filter(Boolean);
}
export function placeToBusiness(p,queryCat){
  const loc=p.location||{};
  const num=comp(p,'street_number'), route=comp(p,'route');
  const street=((num?num+' ':'')+route)||((p.formattedAddress||'').split(',')[0]);
  const inferred=inferCategory(p.types);
  const b={
    id:'g_'+(p.id||Math.random().toString(36).slice(2)),
    name:(p.displayName&&p.displayName.text)||'Unknown business',
    // Google's own place types don't reliably distinguish some trades (e.g. HVAC/landscaping
    // both surface as generic "general_contractor"), so fall back to whichever category query
    // actually found this result when Google's type data is inconclusive.
    cat:inferred==='Other'&&queryCat?queryCat:inferred,
    city:comp(p,'locality')||comp(p,'sublocality')||comp(p,'administrative_area_level_2')||'',
    province:comp(p,'administrative_area_level_1')||'',
    postal:comp(p,'postal_code')||'',
    street, address:p.formattedAddress||'',
    lat:loc.latitude, lng:loc.longitude,
    phone:p.nationalPhoneNumber||p.internationalPhoneNumber||'',
    website:!!p.websiteUri, web:p.websiteUri||null,
    rating:p.rating||0, reviewCount:p.userRatingCount||0,
    status:p.businessStatus||'',                  // OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY
    value:1400+((p.userRatingCount||0)>150?400:200),
    email:null,                                   // Places doesn't return email — enrich later
    socials:{instagram:null,facebook:null,google:p.googleMapsUri?'Google Business Profile':null},
    reviews:placeComplaints(p),                   // only the reviews that complain about replies / booking
    hot:false
  };
  b.gaps=detectGaps(b);
  b.gapSummary=gapSummary(b);
  b.demandSignal=demandSignal(b);
  b.score=scoreFor(b);
  return b;
}

/* ---- contact/detail row building blocks (for the lead drawer) ---- */
export function contactRow(icon,key,val,href){
  const v=val?(href?`<a href="${href}" target="_blank" rel="noopener">${val} ${ic('ext','#4D9FFF',12)}</a>`:val):`<span class="v miss">Not listed</span>`;
  return `<div class="crow"><span class="ci">${ic(icon,'#4D9FFF',15)}</span><div class="cc"><div class="k">${key}</div><div class="v">${val?v:'<span class="miss">Not listed</span>'}</div></div></div>`;
}
export function socialChip(icon,label,val,href,unverified){
  if(!val)return `<span class="social-chip off">${ic(icon,'#5C6E8A',15)} No ${label}</span>`;
  const cavat=unverified?' title="Found via web search, not confirmed from their own site — double-check before using."':'';
  return `<a class="social-chip" href="${href||'#'}" target="_blank" rel="noopener"${cavat}>${ic(icon,undefined,15)} ${val}${unverified?' <small style="opacity:.6">· unverified</small>':''}</a>`;
}
