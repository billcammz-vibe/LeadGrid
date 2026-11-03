// Dashboard view: KPIs, funnel, and a recent-activity feed off the real lead_history log.
import {$,visibleLeads,leadById,timeAgo,money,cap,esc} from './helpers.js';
import {STAGES,currentUserName} from './state.js';
import {recentHistory,HISTORY_KINDS} from './history.js';
import {ic} from './icons.js';

export function renderDash(){
  const ls=visibleLeads();
  const open=ls.filter(l=>!['won','lost'].includes(l.stage));
  const pipeVal=open.reduce((s,l)=>s+l.value,0);
  const won=ls.filter(l=>l.stage==='won');
  const wonVal=won.reduce((s,l)=>s+l.value,0);
  const closed=ls.filter(l=>['won','lost'].includes(l.stage)).length;
  const conv=closed?Math.round(won.length/closed*100):0;
  const noWww=ls.filter(l=>!l.website).length;

  const counts=STAGES.map(s=>({s,n:ls.filter(l=>l.stage===s.id).length}));
  const maxc=Math.max(...counts.map(c=>c.n),1);

  // Recent activity straight off the lead_history log.
  const feed=recentHistory(8).map(h=>{
    const l=leadById(h.leadId), k=HISTORY_KINDS[h.kind]||{color:'#7C8AA0'};
    return {t:`<b>${l?esc(l.name):'A lead'}</b> — ${esc(h.body)}`,c:k.color,ago:timeAgo(h.at)};
  });

  $('#v-dashboard').innerHTML=`
    <div class="viewhead"><div><div class="t">Good morning, ${cap(currentUserName)}</div><div class="s">${open.length} open leads in your pipeline · ${money(pipeVal)} in play</div></div>
    <button class="btn" onclick="go('finder')">${ic('plus','#fff')} Find new leads</button></div>
    <div class="kpis">
      <div class="kpi"><div class="lab">Open pipeline</div><div class="val">${money(pipeVal)}</div></div>
      <div class="kpi"><div class="lab">Won this month</div><div class="val">${money(wonVal)} <small>/ ${won.length} deals</small></div></div>
      <div class="kpi"><div class="lab">Win rate</div><div class="val">${conv}%</div><div class="delta ${conv>=50?'up':'down'}">${conv>=50?'▲ healthy':'▼ needs work'}</div></div>
      <div class="kpi"><div class="lab">No-website leads</div><div class="val">${noWww}</div><div class="delta up">high-intent</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Pipeline by stage <span class="link" onclick="go('crm')">Open CRM →</span></h3>
        <div class="funnel">${counts.map(c=>`<div class="fstage"><span class="nm">${c.s.name}</span><div class="bar"><div class="fill" style="width:${c.n/maxc*100}%;background:${c.s.color}"></div></div><span class="n">${c.n}</span></div>`).join('')}</div>
      </div>
      <div class="card"><h3>Recent activity</h3>
        <div class="feed">${feed.length?feed.map(f=>`<div class="fitem"><span class="dot" style="background:${f.c}"></span><div class="tx">${f.t}<div><time>${f.ago}</time></div></div></div>`).join(''):'<div style="color:var(--dim);font-size:13px">No activity yet.</div>'}</div>
      </div>
    </div>`;
}
