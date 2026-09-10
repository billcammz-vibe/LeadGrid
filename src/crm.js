// CRM view: table + kanban of the current rep's leads.
import {$,visibleLeads,money,repById,scorePill,socialIcons} from './helpers.js';
import {STAGES,stageOf,state,crmView,crmFilter} from './state.js';
import {ic} from './icons.js';

export function renderCRM(){
  const ls=visibleLeads().filter(l=>crmFilter==='all'||l.stage===crmFilter);
  const filters=`<div class="seg"><button class="${crmView==='table'?'on':''}" onclick="setCrmView('table');renderCRM()">Table</button><button class="${crmView==='pipe'?'on':''}" onclick="setCrmView('pipe');renderCRM()">Pipeline</button></div>
    <div style="flex:1"></div>
    ${['all',...STAGES.map(s=>s.id)].map(f=>`<button class="chip ${crmFilter===f?'on':''}" onclick="setCrmFilter('${f}');renderCRM()">${f==='all'?'All':stageOf(f).name}</button>`).join('')}`;

  let body;
  if(crmView==='table'){
    const rows=[...ls].sort((a,b)=>b.score-a.score);
    body=`<div class="tblwrap"><table class="tbl crm-tbl"><thead><tr>
      <th>Business name</th><th>Address</th><th>City</th><th>Prov.</th><th>Website</th><th>Email</th><th>Postal</th><th>Phone</th><th>Socials</th><th>Reviews</th><th>Sales score</th><th></th>
    </tr></thead><tbody>
      ${rows.map(l=>`<tr onclick="openLead('${l.id}')">
        <td><div class="biz"><b><span class="sdot" style="background:${stageOf(l.stage).color}" title="${stageOf(l.stage).name}"></span>${l.name} ${l.hot?'🔥':''}</b>${l.website?'':'<small><span class="nowww">no website</span></small>'}</div></td>
        <td class="nowrap">${l.street}</td>
        <td>${l.city}</td>
        <td class="mono dim">${l.province}</td>
        <td>${l.web?`<a class="tlink" href="${l.web}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${l.web.replace('https://','')}</a>`:'<span class="nowww">no site</span>'}</td>
        <td>${l.email?`<a class="tlink" href="mailto:${l.email}" onclick="event.stopPropagation()">${l.email}</a>`:'<span style="color:var(--dim)">—</span>'}</td>
        <td class="mono">${l.postal}</td>
        <td class="mono nowrap">${l.phone}</td>
        <td>${socialIcons(l)}</td>
        <td class="mono nowrap">★ ${l.rating} · ${l.reviewCount}</td>
        <td>${scorePill(l.score)}</td>
        <td><button class="rowdel" title="Delete lead" onclick="event.stopPropagation();askDeleteLead('${l.id}')">${ic('trash','',15)}</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }else{
    body=`<div class="kanban">${STAGES.map(s=>{const col=ls.filter(l=>l.stage===s.id);return `<div class="kcol"><div class="khead"><span style="color:${s.color}">${s.name}</span><span class="c">${col.length}</span></div>
      ${col.map(l=>`<div class="kcard" onclick="openLead('${l.id}')"><b>${l.name}</b><small>${l.city}</small><span class="kv">${money(l.value)} · ${repById(l.rep).init}</span></div>`).join('')||'<div style="color:var(--dim);font-size:11px;padding:8px 4px">Empty</div>'}
    </div>`;}).join('')}</div>`;
  }
  $('#v-crm').innerHTML=`<div class="viewhead"><div><div class="t">CRM</div><div class="s">${ls.length} leads${state.rep!=='all'?' · '+repById(state.rep).name:''}</div></div>
    <button class="btn ghost" onclick="go('finder')">${ic('search')} Find leads</button></div>
    <div class="toolbar">${filters}</div>${body}`;
}
