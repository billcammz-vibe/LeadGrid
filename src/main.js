// Entry point. Because the markup drives everything through inline on* handlers (which run in
// global scope), every function an on* attribute names is exposed on `window` here. Also sets up
// the static event listeners, icon placeholders, and the Supabase auth gate that boots the app.
import {$} from './helpers.js';
import {ic} from './icons.js';
import {state,LEADS,REPS,EVENTS,setCurrentUserName} from './state.js';
import {sb} from './sb.js';
import {setCrmView,setCrmFilter} from './state.js';
import {loadAllData,reEnrich,setStage,deleteLead} from './data.js';
import {go,render,updateBadges,renderRepFilter} from './router.js';
import {renderCRM} from './crm.js';
import {renderCal} from './calendar.js';
import {runFinder,addFromFinder,setFinderCat,setFinderGap,setFinderSort,renderAreaSuggest,pickArea,hideAreaSuggest} from './finder.js';
import {openLead,closeDrawer,openConfirm,closeConfirm,doConfirm,askDeleteLead} from './drawer.js';
import {regenAI,sendGmail,sendDefault,copyEmail} from './outreach.js';
import {openMeetingModal,onMeetLeadChange,closeMeetingModal,saveMeetingModal,askDeleteMeeting} from './calendar.js';
import {openRepModal,closeRepModal,saveRepModal,deleteRepFromModal} from './reps.js';
import {openAI,closeAI,aiSend} from './assistant.js';

/* ---- sidebar collapse (desktop) ---- */
// When collapsed, the sidebar shrinks to an icon-only rail; the label text is moved to each nav
// link's title so it still shows on hover. State persists in localStorage.
function applyNavCollapsed(collapsed){
  const app=document.getElementById('app'), btn=document.getElementById('navtoggle');
  app.classList.toggle('nav-collapsed',collapsed);
  if(btn)btn.title=collapsed?'Expand sidebar':'Collapse sidebar';
  document.querySelectorAll('#nav a[data-view], #nav a[onclick]').forEach(a=>{
    const label=a.querySelector('span:not(.badge)');
    if(label)a.title=collapsed?label.textContent:'';
  });
}
export function toggleNav(){
  const collapsed=!document.getElementById('app').classList.contains('nav-collapsed');
  localStorage.setItem('lg_nav_collapsed',collapsed?'1':'0');
  applyNavCollapsed(collapsed);
}
if(localStorage.getItem('lg_nav_collapsed')==='1')applyNavCollapsed(true);

/* ---- expose everything the inline on* handlers reference ---- */
export function logout(){sb.auth.signOut();}
Object.assign(window,{
  $,state,go,render,updateBadges,
  setCrmView,setCrmFilter,renderCRM,
  openLead,closeDrawer,openConfirm,closeConfirm,doConfirm,askDeleteLead,setStage,deleteLead,
  reEnrich,
  regenAI,sendGmail,sendDefault,copyEmail,
  runFinder,addFromFinder,setFinderCat,setFinderGap,setFinderSort,renderAreaSuggest,pickArea,hideAreaSuggest,
  renderCal,openMeetingModal,onMeetLeadChange,closeMeetingModal,saveMeetingModal,askDeleteMeeting,
  openRepModal,closeRepModal,saveRepModal,deleteRepFromModal,
  openAI,closeAI,aiSend,
  logout,doLogin,toggleNav,
});

/* ---- static wiring ---- */
document.querySelectorAll('#nav a[data-view]').forEach(a=>a.addEventListener('click',()=>go(a.dataset.view)));
$('#repfilter').addEventListener('change',e=>{state.rep=e.target.value;render(state.view);});
$('#globalsearch').addEventListener('keydown',e=>{if(e.key==='Enter'){const q=e.target.value.toLowerCase();const hit=LEADS.find(l=>l.name.toLowerCase().includes(q));if(hit)openLead(hit.id);}});
const style=document.createElement('style');style.textContent='@keyframes pulse{0%{box-shadow:0 0 0 3px currentColor}70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 3px transparent}}';document.head.appendChild(style);
document.querySelectorAll('[data-ic]').forEach(el=>{el.outerHTML=ic(el.dataset.ic,el.dataset.c,el.dataset.s?+el.dataset.s:undefined);});

/* ========== AUTH GATE ========== */
function displayName(user){
  if(!user)return'';
  return (user.user_metadata&&user.user_metadata.full_name)||(user.email||'').split('@')[0]||'there';
}
function updateSidebarIdentity(user){
  const name=displayName(user);
  setCurrentUserName(name);
  $('#sfName').textContent=name;
  $('#sfEmail').textContent=user.email||'';
  $('#sfAvatar').textContent=name.slice(0,2).toUpperCase();
}
function showLogin(){$('#loginscreen').classList.add('open');$('#app').style.display='none';}
function hideLogin(){$('#loginscreen').classList.remove('open');$('#app').style.display='';}
async function doLogin(){
  const email=$('#loginEmail').value.trim(), password=$('#loginPassword').value;
  const btn=$('#loginBtn'), err=$('#loginError');
  err.style.display='none';
  if(!email||!password){err.textContent='Enter your email and password.';err.style.display='block';return;}
  btn.disabled=true;btn.style.opacity=.6;btn.textContent='Signing in…';
  const{error}=await sb.auth.signInWithPassword({email,password});
  btn.disabled=false;btn.style.opacity=1;btn.textContent='Sign in';
  if(error){err.textContent=error.message||'Sign in failed.';err.style.display='block';}
}
/* ---- local dev bypass: skip the login screen when running `vite` ---- */
// Production builds keep the real gate. In dev we silently grab a session so the app
// boots straight to the workspace — the onAuthStateChange handler below does the rest.
// Needs "Anonymous sign-ins" enabled in the Supabase dashboard (Authentication >
// Sign In / Providers); set VITE_DEV_EMAIL / VITE_DEV_PASSWORD in .env.local to sign
// in as a real user instead.
if(import.meta.env.DEV){
  sb.auth.getSession().then(async({data})=>{
    if(data&&data.session)return;
    const email=import.meta.env.VITE_DEV_EMAIL, password=import.meta.env.VITE_DEV_PASSWORD;
    const{error}=(email&&password)
      ? await sb.auth.signInWithPassword({email,password})
      : await sb.auth.signInAnonymously();
    if(error){
      console.warn('[dev] auto sign-in failed — showing the login screen:',error.message);
      const err=$('#loginError');
      if(err){err.textContent='Dev auto sign-in failed: '+error.message;err.style.display='block';}
    }
  });
}

let _appReady=false;
sb.auth.onAuthStateChange(async(event,session)=>{
  if(session&&session.user){
    updateSidebarIdentity(session.user);
    if(_appReady)return;                // ignore token-refresh events once already booted
    _appReady=true;
    hideLogin();
    await loadAllData();
    renderRepFilter();
    go('dashboard');
  }else{
    _appReady=false;
    LEADS.length=0;REPS.length=0;EVENTS.length=0;
    $('#loginEmail').value='';$('#loginPassword').value='';
    showLogin();
  }
});
