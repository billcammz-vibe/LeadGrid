// Supabase client + the shared error toast + the authed fetch wrapper for our /api/* proxies.
const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||'';
const SUPABASE_ANON_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||'';
export const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);  // anon key is safe client-side — every table is RLS-gated to "authenticated only"

export function dbError(msg){
  console.error(msg);
  let t=document.querySelector('#dbtoast');
  if(!t){t=document.createElement('div');t.id='dbtoast';t.className='dbtoast';document.body.appendChild(t);}
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer=setTimeout(()=>t.classList.remove('show'),5000);
}

// Attaches the current session's access token so the api/* proxies (which spend real API
// budget) can verify the caller is actually logged in — see api/lib/requireAuth.js.
export async function apiFetch(url,opts){
  opts=opts||{};
  const{data}=await sb.auth.getSession();
  const token=data&&data.session&&data.session.access_token;
  opts.headers=Object.assign({},opts.headers,token?{Authorization:'Bearer '+token}:{});
  return fetch(url,opts);
}
