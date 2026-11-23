// Server-side only: the Client Hunter pipeline, one stage per call so each fits a serverless
// time limit. The browser (src/hunter.js) drives the stages in order:
//   scout (x8, live web search) -> teardown (opens every proof link, removes weak leads) ->
//   judge (x3: budget / fit / timing) -> vote (x12, independent) -> final (x12) -> ruling
//   (Teardown rules on any "no") -> draft (first messages for the winners).
// Nothing is ever sent or posted — this only reads public pages and drafts text. The Anthropic key
// stays server-side. Every stage returns plain JSON.
const dns = require('node:dns').promises;
const net = require('node:net');
const Anthropic = require('@anthropic-ai/sdk');
const AnthropicClient = Anthropic.default || Anthropic;

const MODEL = 'claude-sonnet-5';
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };

/* ------------------------------------------------------------------ roles */

const SCOUTS = [
  { id: 1, name: 'New openings', focus:
    'Businesses that opened in the last 30 days ("now open", "grand opening", new listings, local news). New businesses need everything set up.' },
  { id: 2, name: 'Asking for help', focus:
    'Public posts from the last 30 days where someone asks for exactly what the user offers (forums, Reddit, public groups, social posts).' },
  { id: 3, name: 'Bad reviews', focus:
    '1 to 3 star public reviews that name a problem the user can fix, such as no online booking, slow replies, a confusing website or missed calls.' },
  { id: 4, name: 'Old websites', focus:
    'Sites that clearly need work: not mobile friendly, an old copyright year, broken pages, no way to book or buy, very slow.' },
  { id: 5, name: 'Freelance jobs', focus:
    'Freelance briefs and contract posts the user could take on.' },
  { id: 6, name: 'Hiring now', focus:
    "Job ads for a role the user's service could replace. A business that is hiring has already set the budget aside." },
  { id: 7, name: 'Growing fast', focus:
    'A second location, new funding, an award or press coverage. Growth brings new problems to solve.' },
  { id: 8, name: 'No replies', focus:
    'Reviews, comments or messages left unanswered for weeks, a sign the team is stretched.' },
];

const JUDGES = {
  budget: 'BUDGET: can they pay? Look at their prices, staff, premises and size.',
  fit: "FIT: does their problem match the user's offer and ideal client?",
  timing: 'TIMING: do they need it now? How fresh is the signal, and how painful is the problem?',
};

// Fixed reason codes so the UI can report "the most common reason the Teardown removed leads".
const REMOVAL_CODES = {
  not_real: "the business isn't real, is closed, or the link is dead",
  proof_mismatch: "the proof didn't show what the scout claimed",
  stale: 'the signal was more than 60 days old',
  chain: "it was a large chain or franchise that won't hire someone like you",
  already_served: 'someone is already doing this job well for them',
  duplicate: 'it duplicated another lead',
  cant_afford: "it clearly couldn't afford your price",
  unverifiable: "the proof link couldn't be opened to check",
};

/* ---------------------------------------------------------------- helpers */

const httpErr = (message, status) => Object.assign(new Error(message), { status });
const today = () => new Date().toISOString().slice(0, 10);
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function briefText(brief) {
  const b = brief || {};
  return [
    'THE BRIEF',
    `- Offer: ${clip(b.offer, 600)}`,
    `- Price range: ${clip(b.price, 120)}`,
    `- Ideal client: ${clip(b.idealClient, 400)}`,
    `- Area: ${clip(b.area, 200)}`,
    `- Proof (past result / example): ${clip(b.proof, 600) || 'none given'}`,
    `- The user's name: ${clip(b.senderName, 80) || 'the user'}${b.senderCompany ? ' of ' + clip(b.senderCompany, 80) : ''}`,
  ].join('\n');
}

function requireBrief(brief) {
  if (!brief || !clip(brief.offer, 5) || !clip(brief.idealClient, 3) || !clip(brief.area, 2)) {
    throw httpErr('The brief needs an offer, an ideal client and an area', 400);
  }
}

// Pulls the first JSON object out of a model reply (fenced or bare).
function parseJson(text) {
  const t = String(text || '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced && fenced[1], t];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try { return JSON.parse(c.slice(start, end + 1)); } catch { /* try next */ }
  }
  throw httpErr('Claude returned a reply that was not valid JSON', 502);
}

function normUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = '';
    [...x.searchParams.keys()].filter((k) => /^utm_|^fbclid$|^gclid$/i.test(k)).forEach((k) => x.searchParams.delete(k));
    return (x.protocol + '//' + x.host.toLowerCase() + x.pathname.replace(/\/+$/, '') + x.search);
  } catch {
    return null;
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _client;
let _clientKey;
function client() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpErr('ANTHROPIC_API_KEY not configured on the server', 500);
  // Rebuilt whenever the key changes, so rotating the key never leaves a stale client behind.
  if (!_client || _clientKey !== key) { _client = new AnthropicClient({ apiKey: key }); _clientKey = key; }
  return _client;
}

// One Claude call, optionally with web search. Handles `pause_turn` (a long search turn the API
// hands back to be continued). Returns the final text plus every URL the search actually returned,
// so scouts can't cite a link that never came out of a real search.
async function ask({ system, user, search = false, maxTokens = 2500, effort = 'low' }) {
  const messages = [{ role: 'user', content: user }];
  const seen = new Set();
  let msg;
  for (let turn = 0; turn < 4; turn++) {
    try {
      msg = await client().messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort },
        system,
        messages,
        ...(search ? { tools: [WEB_SEARCH_TOOL] } : {}),
      });
    } catch (err) {
      throw httpErr(err && err.message ? err.message : 'Claude request failed', (err && err.status) || 502);
    }
    for (const block of msg.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        block.content.forEach((r) => { const n = r && r.url && normUrl(r.url); if (n) seen.add(n); });
      }
    }
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    break;
  }
  if (msg.stop_reason === 'refusal') throw httpErr('Claude declined this step', 422);
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, seen };
}

/* ------------------------------------------------------- safe page fetching */

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIp(mapped[1]) : false;
}

// The model chooses these URLs, so never let it point the server at internal addresses.
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('bad url'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private host');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
  return u;
}

async function readCapped(res, cap) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) return (await res.text()).slice(0, cap);
  const dec = new TextDecoder();
  let out = '';
  while (out.length < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return out.slice(0, cap);
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Opens one page the way a visitor would. A site that refuses (401/403/429/…) is reported as
// "blocked" and left alone — we never retry with a different identity or try to get around it.
async function openPage(url) {
  try {
    let cur = await assertPublicUrl(url);
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(cur, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadGridBot/1.0)', Accept: 'text/html,*/*;q=0.8' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        cur = await assertPublicUrl(new URL(res.headers.get('location'), cur).toString());
        continue;
      }
      if (res.status >= 200 && res.status < 300) {
        const text = htmlToText(await readCapped(res, 400000)).slice(0, 1800);
        return { url, ok: true, status: res.status, text };
      }
      const blocked = [401, 403, 406, 429, 451, 999].includes(res.status);
      return { url, ok: false, status: res.status, blocked };
    }
    return { url, ok: false, status: 0, error: 'too many redirects' };
  } catch (err) {
    return { url, ok: false, status: 0, error: err && err.message ? err.message : 'failed' };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/* ------------------------------------------------------------------ stages */

async function scoutStage({ brief, scoutId, avoid = [], lessons = '' }) {
  requireBrief(brief);
  const scout = SCOUTS.find((s) => s.id === Number(scoutId));
  if (!scout) throw httpErr('Unknown scout', 400);

  const system =
    `You are Scout ${scout.id} ("${scout.name}") on a team of 12 Claudes finding the user's next paying ` +
    `client. Today is ${today()}. Use web search to find up to 5 real leads for exactly this signal:\n` +
    `${scout.focus}\n\n` +
    `RULES:\n` +
    `- Search the live web. Never invent a business, link, review, quote, name or number.\n` +
    `- Every lead must be a real business or person you found in search results, with a working link.\n` +
    `- Use public business information only. The contact must be a public business route (contact ` +
    `page URL, business email, or business social account). Never a home address or personal phone number.\n` +
    `- "proof" urls MUST be pages that appeared in your search results this turn. Give the date of the signal ` +
    `(YYYY-MM-DD, or YYYY-MM if only the month is known).\n` +
    `- Prefer fresh signals (last 30 days) and small-to-mid businesses that could afford the user's price.\n` +
    `- Fewer, real leads beat more, weak ones. Return an empty list if you find none.\n\n` +
    `Reply with ONLY this JSON:\n` +
    `{"leads":[{"name":"","link":"https://...","need":"what they need, one line","proof":[{"url":"https://...","shows":"what it shows","date":"YYYY-MM-DD"}],"contact":"public contact route"}]}`;

  const extra =
    (avoid.length ? `\n\nAlready found (do not return these again):\n${avoid.slice(0, 60).map((a) => '- ' + clip(a, 120)).join('\n')}` : '') +
    (lessons ? `\n\nThe Teardown critic removed earlier leads. Learn from this and search differently:\n${clip(lessons, 1200)}` : '');

  const { text, seen } = await ask({
    system, search: true, maxTokens: 3000, effort: 'medium',
    user: `${briefText(brief)}\n\nFind leads for your signal.${extra}`,
  });

  let parsed;
  try { parsed = parseJson(text); } catch { return { scoutId: scout.id, scout: scout.name, leads: [], dropped: 0, note: 'Scout returned no usable list' }; }
  const raw = Array.isArray(parsed.leads) ? parsed.leads : [];

  let dropped = 0;
  const leads = [];
  for (const l of raw.slice(0, 5)) {
    const link = normUrl(l && l.link);
    const proof = (Array.isArray(l && l.proof) ? l.proof : [])
      .map((p) => ({ url: p && normUrl(p.url), shows: clip(p && p.shows, 240), date: clip(p && p.date, 20) }))
      .filter((p) => p.url && seen.has(p.url));
    const contact = clip(l && l.contact, 200);
    const looksLikePhone = /^[+\d][\d\s().-]{6,}$/.test(contact);
    if (!l || !clip(l.name, 2) || !link || !clip(l.need, 3) || !proof.length || !contact || looksLikePhone) { dropped++; continue; }
    leads.push({
      id: `s${scout.id}-${leads.length + 1}`,
      scoutId: scout.id,
      scout: scout.name,
      name: clip(l.name, 120),
      link: link.slice(0, 500),
      need: clip(l.need, 240),
      proof,
      contact,
    });
  }
  return { scoutId: scout.id, scout: scout.name, leads, dropped };
}

async function teardownStage({ brief, leads }) {
  requireBrief(brief);
  if (!Array.isArray(leads) || !leads.length) return { verdicts: [] };
  const batch = leads.slice(0, 10);

  // Open every proof link (and the business's own page) ourselves.
  const opened = await mapLimit(batch, 4, async (l) => {
    const urls = [...new Set([...(l.proof || []).map((p) => p.url), l.link].filter(Boolean))].slice(0, 4);
    return Promise.all(urls.map(openPage));
  });

  const verdicts = [];
  const forClaude = [];
  batch.forEach((l, i) => {
    const pages = opened[i];
    const proofUrls = new Set((l.proof || []).map((p) => p.url));
    const proofOpened = pages.some((p) => p.ok && proofUrls.has(p.url));
    if (!proofOpened) {
      const blocked = pages.some((p) => proofUrls.has(p.url) && p.blocked);
      verdicts.push({ id: l.id, keep: false, code: 'unverifiable',
        reason: blocked ? 'Every proof link blocked automated access, so it could not be checked.' : 'None of the proof links could be opened.' });
      return;
    }
    forClaude.push({ lead: l, pages });
  });

  if (forClaude.length) {
    const system =
      `You are the Teardown: your only job is to BREAK leads. Today is ${today()}. For each lead you are ` +
      `given the scout's claim and the text actually fetched from its proof links. Remove a lead if:\n` +
      Object.entries(REMOVAL_CODES).filter(([c]) => c !== 'unverifiable').map(([c, d]) => `- ${c}: ${d}`).join('\n') +
      `\nBe sceptical: keep a lead only when the fetched text really supports the claim and the signal is ` +
      `within 60 days. A proof link marked [could not be opened] is no evidence on its own.\n\n` +
      `Reply with ONLY this JSON, one entry per lead id: ` +
      `{"verdicts":[{"id":"","keep":true,"code":"none or one of: ${Object.keys(REMOVAL_CODES).filter((c) => c !== 'unverifiable').join(', ')}","reason":"one line"}]}`;
    const body = forClaude.map(({ lead: l, pages }) =>
      `LEAD ${l.id}: ${l.name} (${l.link})\nClaimed need: ${l.need}\nContact: ${l.contact}\nScout: ${l.scout}\n` +
      (l.proof || []).map((p) => `Proof claimed: ${p.url} — "${p.shows}" (${p.date})`).join('\n') + '\n' +
      pages.map((p) => `Fetched ${p.url}: ${p.ok ? `[opened] ${p.text || '(no text)'}` : '[could not be opened]'}`).join('\n')
    ).join('\n\n---\n\n');
    const { text } = await ask({ system, user: `${briefText(brief)}\n\n${body}`, maxTokens: 2500 });
    const parsed = parseJson(text);
    const byId = new Map((parsed.verdicts || []).map((v) => [String(v.id), v]));
    forClaude.forEach(({ lead }) => {
      const v = byId.get(lead.id);
      if (!v) { verdicts.push({ id: lead.id, keep: false, code: 'proof_mismatch', reason: 'The Teardown gave no verdict for this lead.' }); return; }
      const code = REMOVAL_CODES[v.code] ? v.code : null;
      verdicts.push({ id: lead.id, keep: v.keep === true, code: v.keep === true ? null : (code || 'proof_mismatch'), reason: clip(v.reason, 240) });
    });
  }
  return { verdicts, codes: REMOVAL_CODES };
}

async function judgeStage({ brief, leads, judge }) {
  requireBrief(brief);
  if (!JUDGES[judge]) throw httpErr('Unknown judge', 400);
  if (!Array.isArray(leads) || !leads.length) return { judge, scores: [] };
  const system =
    `You are the ${judge.toUpperCase()} judge. Score every surviving lead from 1 to 10 on one question only — ` +
    `${JUDGES[judge]}\nUse only the evidence given. One line of reasoning per lead.\n` +
    `Reply with ONLY this JSON: {"scores":[{"id":"","score":7,"why":"one line"}]}`;
  const { text } = await ask({ system, user: `${briefText(brief)}\n\n${packText(leads)}`, maxTokens: 3000 });
  const parsed = parseJson(text);
  const byId = new Map((parsed.scores || []).map((s) => [String(s.id), s]));
  const scores = leads.map((l) => {
    const s = byId.get(l.id);
    const n = s ? Math.round(Number(s.score)) : NaN;
    return { id: l.id, score: Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1, why: s ? clip(s.why, 240) : 'No score returned.' };
  });
  return { judge, scores };
}

function packText(leads) {
  return leads.map((l) =>
    `LEAD ${l.id}: ${l.name} (${l.link})\nNeed: ${l.need}\nContact: ${l.contact}\nFound by: ${l.scout || 'a scout'}\n` +
    (l.proof || []).map((p) => `Proof: ${p.url} — ${p.shows} (${p.date})`).join('\n') +
    (l.teardown ? `\nTeardown notes: ${l.teardown}` : '') +
    (l.judgeNotes ? `\nJudge scores: ${l.judgeNotes}` : '')
  ).join('\n\n---\n\n');
}

async function voteStage({ brief, leads, voter }) {
  requireBrief(brief);
  if (!Array.isArray(leads) || !leads.length) return { voter: voter && voter.id, ranking: [], why: '' };
  const pack = shuffle(leads); // each ballot sees the leads in its own random order
  const ids = new Set(leads.map((l) => l.id));
  const system =
    `You are ${clip(voter && voter.label, 60) || 'a team member'} on a team of 12 Claudes choosing the user's ` +
    `best next paying client. You vote ALONE and have not seen any other ballot. Rank your top 3 leads ` +
    `(best first) from the pack — the ones most likely to actually pay the user. Weigh the proof, the ` +
    `Teardown's notes and the judges' scores, but use your own judgment. If there are fewer than 3 leads, ` +
    `rank them all.\nReply with ONLY this JSON: {"ranking":["id","id","id"],"why":"one sentence"}`;
  const { text } = await ask({ system, user: `${briefText(brief)}\n\n${packText(pack)}`, maxTokens: 600 });
  const parsed = parseJson(text);
  let ranking = [...new Set((Array.isArray(parsed.ranking) ? parsed.ranking : []).map(String))].filter((id) => ids.has(id)).slice(0, 3);
  // A scout may not rank its own lead first: move it down a place.
  const own = new Set(leads.filter((l) => voter && voter.scoutId && l.scoutId === voter.scoutId).map((l) => l.id));
  if (ranking.length > 1 && own.has(ranking[0])) ranking = [ranking[1], ranking[0], ...ranking.slice(2)];
  return { voter: voter && voter.id, ranking, why: clip(parsed.why, 300) };
}

async function finalStage({ brief, leads, voter }) {
  requireBrief(brief);
  const system =
    `You are ${clip(voter && voter.label, 60) || 'a team member'} on a team of 12 Claudes. The team has chosen ` +
    `these leads as the user's top picks. Answer for yourself, alone: "Would you stake your name on these ` +
    `${leads.length} paying?" Say "no" if any one of them is unlikely to pay, and name which lead and why. ` +
    `Say "yes" only if you would genuinely stake your name on all of them.\n` +
    `Reply with ONLY this JSON: {"answer":"yes or no","leadId":"id of the weak lead, or empty if yes","reason":"required if no"}`;
  const { text } = await ask({ system, user: `${briefText(brief)}\n\n${packText(leads)}`, maxTokens: 500 });
  const parsed = parseJson(text);
  const no = String(parsed.answer).toLowerCase().startsWith('n');
  const ids = new Set(leads.map((l) => l.id));
  return {
    voter: voter && voter.id,
    answer: no ? 'no' : 'yes',
    leadId: no && ids.has(String(parsed.leadId)) ? String(parsed.leadId) : '',
    reason: no ? (clip(parsed.reason, 300) || 'No reason given.') : '',
  };
}

async function rulingStage({ brief, leads, objections }) {
  requireBrief(brief);
  if (!Array.isArray(objections) || !objections.length) return { rulings: [] };
  const system =
    `You are the Teardown. Some team members said "no" to a lead in the top picks. For each objection, ` +
    `decide if you AGREE with the reason (it is a real problem that would stop this lead paying) or not. ` +
    `Be rigorous: agree only when the reason is supported by the evidence.\n` +
    `Reply with ONLY this JSON: {"rulings":[{"leadId":"","agree":true,"why":"one line"}]} — one entry per lead that was objected to.`;
  const grouped = {};
  objections.forEach((o) => { (grouped[o.leadId] = grouped[o.leadId] || []).push(clip(o.reason, 300)); });
  const body = Object.entries(grouped).map(([id, rs]) => `OBJECTIONS to ${id}:\n${rs.map((r) => '- ' + r).join('\n')}`).join('\n\n');
  const { text } = await ask({ system, user: `${briefText(brief)}\n\n${packText(leads)}\n\n${body}`, maxTokens: 800 });
  const parsed = parseJson(text);
  const valid = new Set(Object.keys(grouped));
  return {
    rulings: (parsed.rulings || [])
      .filter((r) => valid.has(String(r.leadId)))
      .map((r) => ({ leadId: String(r.leadId), agree: r.agree === true, why: clip(r.why, 240) })),
  };
}

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

async function draftStage({ brief, leads }) {
  requireBrief(brief);
  if (!Array.isArray(leads) || !leads.length) return { drafts: [] };
  const who = clip(brief.senderName, 80) || 'the user';
  const system =
    `Write a first outreach message for each lead, written as ${who}${brief.senderCompany ? ' of ' + clip(brief.senderCompany, 80) : ''}. ` +
    `For each: under 90 words, plain text, no markdown, no emoji, no hype. Mention the specific thing that was ` +
    `spotted (from the proof), offer ONE useful idea for free, and end with ONE easy question. No hard sell. ` +
    `Never invent facts, numbers or claims — use only what is given. Do not claim results the brief does not state.\n` +
    `Reply with ONLY this JSON: {"drafts":[{"id":"","message":""}]}`;
  const base = `${briefText(brief)}\n\n${packText(leads)}`;
  let drafts = [];
  let note = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text } = await ask({ system, user: base + note, maxTokens: 1500 });
    const parsed = parseJson(text);
    const byId = new Map((parsed.drafts || []).map((d) => [String(d.id), clip(d.message, 900)]));
    drafts = leads.map((l) => ({ id: l.id, message: byId.get(l.id) || '' }));
    const bad = drafts.filter((d) => !d.message || words(d.message) >= 90);
    if (!bad.length) break;
    note = `\n\nYour last attempt had messages that were missing or 90+ words (${bad.map((d) => d.id).join(', ')}). ` +
      `Rewrite ALL of them so each is under 90 words.`;
  }
  return { drafts: drafts.map((d) => ({ ...d, words: words(d.message) })) };
}

const STAGES = {
  scout: scoutStage,
  teardown: teardownStage,
  judge: judgeStage,
  vote: voteStage,
  final: finalStage,
  ruling: rulingStage,
  draft: draftStage,
};

async function runHuntStage(body) {
  const fn = STAGES[body && body.stage];
  if (!fn) throw httpErr('Unknown stage', 400);
  return fn(body);
}

module.exports = { runHuntStage, SCOUTS, REMOVAL_CODES };
