# Covebay Digital Build — Handoff Brief for Claude Code

**Project:** DFL Importers, Covebay brand presence for the Americas F&B Show, Miami (Sept 14–16, 2026)
**Status:** Two working HTML prototypes, ready to become a real deployed site.

---

## What exists right now

Two self-contained HTML files (no build step, no dependencies beyond a Google Fonts CDN link):

1. **`covebay-card.html`** — the digital business card
2. **`covebay-experience.html`** — the "Covebay Experience" landing page

Both are single-file prototypes with embedded (base64) logo images, inline CSS, and inline JS. They're meant as a working spec, not final production code — restructure as needed (separate CSS/JS files, components, etc.) once this becomes a real repo.

## Known issue to fix, not a bug in the code

The YouTube embed on `covebay-experience.html` will fail/error when the file is opened directly from disk (`file://`). This is expected — browsers restrict third-party iframe embeds on the `file://` origin. It will work correctly once served over `http(s)`, including from a local dev server (`python -m http.server`, `npx serve`, VS Code Live Server, etc.) or once deployed to GitHub Pages. No code change needed for this specifically — just confirm it once running on a real server.

## The intended user flow

1. Staffer's NFC tag or phone-case QR sticker encodes a URL like:
   `https://[domain]/?name=Brandon+Lee&role=Purchasing&phone=13055551234&email=brandon@dflimporters.com`
2. Visitor lands on `covebay-card.html`, sees that staffer's personalized card (name, role, tap-to-call/email), can hit **Save my contact** to download a `.vcf`.
3. Visitor fills in their own details (name, company, email, buyer/supplier toggle, interest) and submits.
4. Page shows a thank-you, then auto-redirects (after ~1.8s) to `covebay-experience.html`, carrying the visitor's first name and the staffer's name forward as URL params so the Experience page can show a personalized welcome strip.
5. Experience page: video, testimonials, DFL-at-a-glance stats, catalogue (online + PDF), closing CTA.

## What's still needed to go live

**Infrastructure**
- [ ] Register the Covebay-branded domain (separate from `dflhq.com` — intentionally kept apart)
- [ ] Create a new private GitHub repo, separate from the existing `dflhq` build (do not reuse or link that repo)
- [ ] Set up GitHub Pages hosting, point the new domain at it
- [ ] Wire the lead form on `covebay-card.html` to Supabase — the `submitForm()` JS function has a comment marking exactly where the insert call goes. Fields to capture: visitor name, company, email, role (buyer/supplier), interest, plus which staffer's card they came from (`staffName`)

**Content to swap in (currently placeholder/sample)**
- [ ] **New Covebay logo with tagline** — Joel has an updated logo asset to provide; swap into both files (currently base64-embedded — either keep that pattern or move to a linked asset file, whichever fits the repo structure better)
- [ ] **Testimonials** (3 sample quotes on the Experience page, clearly marked "sample content") — replace once real quotes come in from category managers and Brandon (supplier-side reviews of DFL)
- [ ] **DFL-at-a-glance stats** (currently sample numbers: 35% revenue share, 180+ containers/year, 340+ active accounts) — Joel is collating the real figures
- [ ] **Catalogue** — currently two placeholder links: `catalogue.html` (online view — page doesn't exist yet, needs building once product mockups are ready) and `assets/covebay-catalogue-2026.pdf` (download — file doesn't exist yet). Both are pending the in-progress Covebay product/packaging mockups.
- [ ] **Real staff roster** — for generating each staffer's personalized card URL/QR code/NFC tag. Not needed to build anything further right now, but will be needed before physical card production.

**Nice-to-haves worth considering during rebuild**
- Consider a short staff-code lookup (e.g. `?rep=brandon`) instead of raw name/role/phone/email in the URL, if the querystring gets unwieldy for QR code density or if staff info needs central editing without re-issuing NFC tags
- Basic form validation (currently none) before wiring to Supabase
- Analytics/view tracking if useful for post-show reporting (e.g. simple page-view logging to Supabase alongside lead capture)

## Design language (already implemented, keep consistent if extending)

- **Brand hierarchy:** Covebay leads (primary logo, primary color story); DFL Importers is present but secondary (small logo in header/footer only)
- **Colors:** Covebay blue (`#1C8FDE` / `#0C5FA0` deep) to green (`#2FA84A` / `#1E7A36` deep) gradient for hero/CTA sections; orange (`#F5A623`) for primary action buttons; light neutral background (`#F4F8FB`) for content sections
- **Type:** Inter, weights 400–800
- **Responsive:** mobile-first (this is primarily a QR/NFC scan destination), with tablet (700px+) and desktop (1100px+) breakpoints already built in — wider layouts use grids for testimonials/stats rather than the mobile horizontal-scroll/stacked pattern
- **Bilingual:** EN/ES toggle via a `data-i18n` attribute pattern + JS dictionary object at the bottom of each file — any new copy should follow the same pattern so the toggle keeps working

---

*Questions on scope or priority should go back to Joel — this brief reflects the state of the build as of the last working session, not final sign-off on every content placeholder.*
