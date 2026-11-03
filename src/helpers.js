// Formatting, DOM, scoring, and business-shape helpers shared across feature modules.
import {ic} from './icons.js';
import {stageOf,LEADS,REPS,POOL,livePool,state,gapOf,STREETS,FSA,PLET,REVIEW_THEMES,REVIEW_AUTHORS,REVIEW_TIMES} from './state.js';

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
// Every reason a business gets flagged as a prospect. Returns [{type,tag,sev}] — `tag` is the
// human string shown on the row, `sev` is this gap's weight in the score (0..1, summed then
// capped). Thresholds: rating < 4.0 (needs ≥5 reviews to be meaningful), < 15 reviews, a Google
// businessStatus that isn't OPERATIONAL, or (for businesses that DO have a site) a weak one per
// b.siteAudit — see api/lib/siteAudit.js. A business with an empty array isn't a lead.
export function detectGaps(b){
  const g=[], rc=b.reviewCount||0;
  if(!b.website) g.push({type:'no_website',tag:'No website',sev:.70});
  else if(b.siteAudit&&!b.siteAudit.error&&b.siteAudit.issues&&b.siteAudit.issues.length){
    const n=b.siteAudit.issues.length;
    g.push({type:'weak_site',tag:b.siteAudit.issues.slice(0,2).join(', ')+(n>2?` +${n-2} more`:''),sev:Math.min(.15+.10*n,.55)});
  }
  if(b.rating && rc>=5 && b.rating<4.0) g.push({type:'low_rating',tag:b.rating+'★',sev:.28});
  if(rc<15) g.push({type:'few_reviews',tag:rc+' review'+(rc===1?'':'s'),sev:.16});
  if(b.status && b.status!=='OPERATIONAL')
    g.push({type:'odd_status',tag:b.status==='CLOSED_TEMPORARILY'?'Temporarily closed':b.status==='CLOSED_PERMANENTLY'?'Permanently closed':'Status unclear',sev:.60});
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
  if(!gaps.some(g=>g.type==='low_rating')&&b.rating) parts.push(b.rating+'★');
  if(!gaps.some(g=>g.type==='few_reviews')) parts.push((b.reviewCount||0)+' reviews');
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
  if(/landscap|lawn/.test(joined))return 'Landscaping';
  if(/gym|fitness/.test(joined))return 'Fitness';
  if(/pet_grooming|pet_groomer/.test(joined))return 'Pet Grooming';
  if(/nail_salon/.test(joined))return 'Nail Salon';
  return 'Other';
}

/* ---- synthetic enrichment (used when a business lacks real data) ---- */
export function slug(n){return n.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'').slice(0,22);}
export function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
export function postalFor(city,h){const fsa=FSA[city]||'M5';const a=PLET[h%PLET.length];const l2=PLET[(h>>4)%PLET.length];return `${fsa}${a} ${h%10}${l2}${(h>>3)%10}`;}
export function generateSampleReviews(b){
  const t=REVIEW_THEMES[b.cat]||{pros:['friendly service','good value'],cons:['could improve online booking']};
  const h=hash(b.name), n=4, pos=Math.round(n*(b.rating/5)), out=[];
  for(let i=0;i<n;i++){
    const hi=i<pos, pro=t.pros[(h+i)%t.pros.length], con=t.cons[(h+i)%t.cons.length];
    out.push({
      author:REVIEW_AUTHORS[(h+i)%REVIEW_AUTHORS.length],
      rating:hi?(b.rating>=4.5?5:4):Math.max(2,Math.round(b.rating)-1),
      text:hi?`Really happy with ${b.name} — the ${pro} stood out. Would recommend.`
             :`Decent overall, but ${con}. Hope they sort it out.`,
      time:REVIEW_TIMES[(h+i)%REVIEW_TIMES.length]
    });
  }
  return out;
}
export function enrich(b){
  const sg=slug(b.name), h=hash(b.name);
  b.email=b.email||('info@'+sg+'.ca');
  b.province=b.province||'ON';
  b.postal=b.postal||postalFor(b.city,h);
  b.street=b.street||((h%900+100)+' '+STREETS[h%STREETS.length]);
  b.address=b.address||(b.street+', '+b.city+', '+b.province+' '+b.postal);
  b.web=b.website?('https://'+sg+'.ca'):null;
  b.socials=b.socials||{
    instagram:'@'+sg,
    facebook:(h%3!==0)?'/'+sg:null,
    google:'Google Business Profile'
  };
  b.score=b.score||scoreFor(b);
  b.reviews=b.reviews||generateSampleReviews(b); // array of {author,rating,text,time} — Places `reviews` shape
  return b;
}

/* ---- Google Places → internal business shape ---- */
export function comp(p,type){const c=(p.addressComponents||[]).find(x=>(x.types||[]).includes(type));return c?(c.shortText||c.longText||''):'';}
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
    province:comp(p,'administrative_area_level_1')||'ON',
    postal:comp(p,'postal_code')||'',
    street, address:p.formattedAddress||'',
    lat:loc.latitude, lng:loc.longitude,
    phone:p.nationalPhoneNumber||'',
    website:!!p.websiteUri, web:p.websiteUri||null,
    rating:p.rating||0, reviewCount:p.userRatingCount||0,
    status:p.businessStatus||'',                  // OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY
    value:1400+((p.userRatingCount||0)>150?400:200),
    email:null,                                   // Places doesn't return email — enrich later
    socials:{instagram:null,facebook:null,google:p.googleMapsUri?'Google Business Profile':null},
    reviews:[],                                   // fetch via Place Details later
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
