-- Website quality audit (PageSpeed Insights / Lighthouse: speed, mobile-friendliness, HTTPS,
-- online-booking link) for leads that have a website. See api/lib/siteAudit.js for the shape:
-- {url, speedScore, mobileOk, httpsOk, hasBooking, issues, checkedAt} or {error}. NULL = never
-- checked yet.
alter table leads add column if not exists site_audit jsonb;
