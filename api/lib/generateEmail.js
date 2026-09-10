// Server-side only: drafts a personalized outreach email for one flagged lead via Claude.
// Never cached — every call (including "Regenerate") should produce fresh copy. The API key
// stays server-side; the browser only ever hits /api/generate-email. Returns { subject, body,
// angle, model }.
const Anthropic = require('@anthropic-ai/sdk');
const AnthropicClient = Anthropic.default || Anthropic;

const MODEL = 'claude-sonnet-5';

// Who the email is from — edit here (or lift to env vars) to rebrand.
const SENDER = {
  name: 'John Albano',
  company: 'OmniGrid Digital',
  site: 'omnigriddigital.ca',
  city: 'Toronto',
};

// Mirrors detectGaps() severity in src/helpers.js — used only to pick the primary gap to pitch on.
const GAP_SEV = { no_website: 0.70, odd_status: 0.60, low_rating: 0.28, few_reviews: 0.16 };

// A distinct pitch angle per primary gap. The low_rating angle is deliberately tactful — never
// criticise their rating.
const ANGLES = {
  no_website:
    'Primary gap: NO WEBSITE. Lead with — people find them on Google but have no way to book, ' +
    'check hours, or judge them beyond the listing, so some go to a competitor who looks more ' +
    'polished. Ask: offer a free one-page mockup so they can see it, no obligation.',
  few_reviews:
    'Primary gap: FEW REVIEWS despite a good rating. Lead with — the rating is strong but too few ' +
    'people see it to build trust; a simple site plus a review-ask flow turns Google traffic into ' +
    'booked customers and more reviews.',
  low_rating:
    'Primary gap: RATING BELOW 4.0 — be tactful, do not criticise it. Lead with — helping more of ' +
    'their happy customers actually leave a review, plus a site that shows their best work and ' +
    'makes booking easy, so the online picture matches the real business.',
  odd_status:
    'Primary gap: GOOGLE LISTING STATUS PROBLEM (marked closed / unclear). Lead with — customers ' +
    'searching for them may think they have shut down; fixing the listing and adding a basic ' +
    'always-on site recovers that lost traffic.',
};

function primaryGap(gaps) {
  if (!Array.isArray(gaps) || !gaps.length) return null;
  return [...gaps].sort((a, b) => (GAP_SEV[b.type] || 0) - (GAP_SEV[a.type] || 0))[0];
}

async function generateEmailDraft({ lead, variant = 0 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY not configured on the server'), { status: 500 });
  if (!lead || !lead.name) throw Object.assign(new Error('Missing lead'), { status: 400 });

  const gap = primaryGap(lead.gaps);
  const angleKey = gap ? gap.type : (lead.website ? 'few_reviews' : 'no_website');
  const angle = ANGLES[angleKey] || ANGLES.no_website;

  const facts = [
    `Business: ${lead.name}`,
    `Category: ${lead.cat || 'local business'}`,
    lead.city ? `Location: ${lead.city}${lead.province ? ', ' + lead.province : ''}` : null,
    `Google rating: ${lead.rating ? lead.rating + '★' : 'no rating yet'}` +
      (lead.reviewCount != null ? ` from ${lead.reviewCount} reviews` : ''),
    `Website: ${lead.website ? (lead.web || 'yes') : 'none'}`,
    lead.gapSummary ? `Flagged for: ${lead.gapSummary}` : null,
  ].filter(Boolean).join('\n');

  const system =
    `You write short, specific B2B outreach emails for ${SENDER.company}, a ${SENDER.city} digital ` +
    `agency that builds booking-ready websites and review / follow-up automation for local ` +
    `businesses. You are writing to a business found on Google Places.\n\n` +
    `RULES:\n` +
    `- Body is 110-150 words. Plain text only: no markdown, no bullet lists, no headings.\n` +
    `- Name the business, its category, and its city naturally within the first two sentences.\n` +
    `- Use the specific gap below as the reason for reaching out; use the rating / review count as ` +
    `a credibility hook where it helps.\n` +
    `- Make exactly one ask: either a quick 10-minute call this week OR a free mockup — never both.\n` +
    `- Never invent facts, names, numbers, or claims. Use only what is given below.\n` +
    `- No "I hope this email finds you well", no hype words ("game-changer", "revolutionary"), no emoji.\n` +
    `- Sign off exactly as:\n${SENDER.name}\n${SENDER.company}\n${SENDER.site}\n\n` +
    `ANGLE FOR THIS LEAD:\n${angle}\n\n` +
    `OUTPUT FORMAT — respond with exactly this and nothing else:\n` +
    `Subject: <specific subject line, under 60 characters>\n` +
    `\n` +
    `<the email body>`;

  const userMsg =
    `Draft the outreach email.\n\n${facts}` +
    (variant > 0
      ? `\n\nThis is regeneration #${variant} — use a clearly different opening line, subject, and ` +
        `structure than an obvious first attempt.`
      : '');

  const client = new AnthropicClient({ apiKey: key });

  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
  } catch (err) {
    throw Object.assign(new Error(err && err.message ? err.message : 'Claude request failed'), {
      status: (err && err.status) || 502,
    });
  }

  if (msg.stop_reason === 'refusal') {
    throw Object.assign(new Error('Claude declined to draft this email'), { status: 422 });
  }

  const text = (msg.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Parse "Subject: ...\n\n<body>"; tolerate a missing prefix.
  let subject = `Quick idea for ${lead.name}`;
  let body = text;
  const m = text.match(/^\s*subject:\s*(.+?)\s*\n+([\s\S]*)$/i);
  if (m) { subject = m[1].trim(); body = m[2].trim(); }

  return { subject, body, angle: angleKey, model: MODEL };
}

module.exports = { generateEmailDraft };
