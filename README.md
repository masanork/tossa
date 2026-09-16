# tossa

[English](README.md) | [日本語](README.ja.md)

> An ultra-lightweight community information platform for sharing and verifying real-time local updates.  
> Seamlessly bridges everyday municipal and commercial updates with emergency crisis communications through an organically emergent vocabulary.  
> Cloudflare-native architecture featuring automated EXIF GPS location pinning, C2PA authenticity verification, hardware-backed E2EE messaging, multi-language internationalization, and decentralized community verification.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/masanork/tossa)

---

## 🌟 Key Features

1. **Organically Emergent Vocabulary (Tag-Integrated Filtering)**
   - No rigid or pre-imposed categories. Tags posted by citizens and local staff (such as `#water`, `#shelter`, `#cafe`, `#wifi`) are automatically aggregated and ranked by recency and frequency.
   - Eliminates artificial barriers between daily living and emergency modes, autonomously adapting to shifting local needs.

2. **Photo-Driven Posting with Automated EXIF GPS Pinning**
   - Uploading on-site photos extracts GPS latitude and longitude directly from EXIF metadata, pinning the exact location to the map automatically.
   - Client-side Canvas downscaling (max 1200px / WebP) ensures ultra-fast uploads even over degraded or congested mobile networks.

3. **C2PA Content Authenticity & EXIF Recency Verification**
   - High-speed parsing of embedded JUMBF / C2PA cryptographic manifests proves authenticity against generative AI tampering and photo manipulation.
   - Explicit display of original capture timestamps prevents misleading reuse of outdated disaster imagery.

4. **Hardware-Backed End-to-End Encrypted (E2EE) Secure Messaging**
   - Leverages WebAuthn PRF (Pseudo-Random Function) extension to derive encryption keys directly from biometric authenticators.
   - Facilitates confidential, zero-knowledge inquiries between shelter managers and citizens that cannot be intercepted even by the server host.

5. **Multi-Language & Inclusive Accessibility (i18n)**
   - Instant language switching powered by Inlang Paraglide JS integrated with reactive Svelte 5 Runes.
   - First-class support for English, Japanese, and Plain Japanese ("やさしい日本語", Easy Japanese) for international residents and accessibility.

6. **Source Domain Credibility Badging & Community Peer Verification**
   - Automatic classification and trust badges for municipal authorities (`.go.jp`, `.lg.jp`), universities (`.ac.jp`), news agencies, and official SNS channels.
   - Community-powered "Verify on Site" action allows citizens to collaboratively confirm ongoing accuracy and freshness of active posts.

7. **Passkey (WebAuthn) & Seamless Device Cookie Sessions**
   - Immediate friction-free posting without login via secure device cookies.
   - One-tap upgrade to passwordless biometric Passkeys (Touch ID, Face ID, Windows Hello) for persistent role authorization.

8. **Massive Scalability with Zero Egress Cost**
   - Unified Cloudflare Workers + D1 (SQLite) + Workers Static Assets architecture.
   - Aggressive edge caching withstands extreme traffic spikes during large-scale emergencies at near-zero operating costs.

9. **Progressive Web App (PWA) & Offline Disaster Resilience**
   - Built-in Service Worker caches the SPA shell and latest community updates.
   - Offline Outbox automatically queues local posts and status reports when connectivity drops, auto-syncing when signal returns.

10. **Mobile-First Multi-Modal Architecture & Native Bottom Sheets**
    - Seamless layered modal management (non-destructive Passkey auth layering while retaining draft post content).
    - Touch-optimized bottom sheets with drag handles and native browser back button (`popstate`) dismissal.
11. **Dark Mode & High-Contrast Emergency Modes**
    - Dark theme designed for night-time comfort and OLED power-saving during blackouts.
    - High-contrast monochrome mode tailored for readability under harsh outdoor sunlight.
12. **Offline Distance & Compass Direction Indicator with GPS Sorting**
    - 100% offline client-side Haversine straight-line distance (m/km) and forward azimuth bearing calculation.
    - Real-time rotating compass needle tracking device heading (DeviceOrientation API / geomagnetic sensor).
    - Distance-based timeline sorting and interactive user location pin & centering on Leaflet map view.

---

## 🛠 Tech Stack

- **Runtime & Hosting**: Cloudflare Workers
- **Configuration**: `wrangler.toml` (fully compatible with Deploy to Cloudflare)
- **API Framework**: Hono
- **Database**: Cloudflare D1 (Serverless SQLite)
- **Frontend**: Svelte 5 (Runes) + Vite + Tailwind CSS v4
- **Internationalization (i18n)**: `@inlang/paraglide-js` + Svelte 5 Reactive State
- **Encryption (E2EE)**: Web Crypto API (AES-GCM-256 + ECDH P-256) + WebAuthn PRF
- **Media Processing**: `exifr` (EXIF GPS & Timestamp extraction) + JUMBF/C2PA manifest scanner
- **Authentication**: WebAuthn / Passkeys (`@simplewebauthn/server` & `@simplewebauthn/browser`)
- **Mapping**: Leaflet + GSI Address Search API + OpenStreetMap

---

## 🚀 Local Development Setup

```bash
# 1. Install dependencies
npm install
npm --prefix web install

# 2. Initialize local D1 database schema and seeds
npm run db:reset:local

# 3. Build frontend and start development server (port 8787)
npm run build
npm run dev
```

Open your browser at `http://localhost:8787`.

---

## 🧪 Quality Assurance & Test Suite

The repository includes a comprehensive testing and quality assurance pipeline:

```bash
# 1. Unit and integration tests (Vitest with in-memory D1 SQLite)
npm test

# 2. Browser End-to-End tests (Playwright: multi-language switching, posting, cookie identity, Passkeys)
npm run test:e2e

# 3. Type checking (TypeScript & svelte-check)
npm run typecheck

# 4. Linting (ESLint flat config)
npm run lint
npm run lint:fix

# 5. Code formatting (Prettier)
npm run format:check
npm run format
```

All quality checks are automatically verified on pull requests and pushes to `main` via GitHub Actions CI (`.github/workflows/ci.yml`).

---

## 📦 Production Deployment to Cloudflare

### 1. Create a D1 Database

```bash
npx wrangler d1 create tossa-db
```

Paste the generated `database_id` into your [`wrangler.toml`](./wrangler.toml).  
Configure `RP_ID` and `EXPECTED_ORIGIN` to match your production domain.

### 2. Apply Database Schema & Seeds

```bash
npm run db:init:remote
npm run db:seed:remote
```

### 3. Deploy Application

```bash
npm run deploy
```

---

## 🔒 Passkey (WebAuthn) Admin Setup

1. Click the **"Admin" / "Auth"** button in the top navigation header.
2. Keep the username `admin` and click **"Register Passkey"**.
3. Complete registration using your device biometric sensor (Touch ID / Face ID / Windows Hello).
4. Subsequent logins only require a single click on **"Login with Passkey"**.
5. Once authenticated, administrators can configure regional metadata, emergency announcement banners, manage team permissions, and synchronize federated disaster databases.
