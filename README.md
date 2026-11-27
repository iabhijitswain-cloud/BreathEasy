# BreathEasy AI — Calm, Family-First Environmental Protection Platform

BreathEasy AI is a full-stack environmental intelligence, indoor physics, and multi-agent family protection platform built for polluted urban environments across India. It pairs transparent deterministic air-quality physics models and hard-coded clinical safety gates with an 8-agent Gemini pipeline grounded in Google Search and Google Maps.

## Core Capabilities

- **Calm Protection Brief & Predictive Risk Intelligence (`src/components/ProtectionBriefView.tsx`)**
  - Vulnerable-first family ranking (infants, elders, children, adults, pets) with English, Hindi, and Bengali UI support and an **Explain Like I'm 10** toggle.
  - Observed vs. 1h / 3h / 6h / 24h modeled pollution outlook (`getPredictiveHourlyOutlook`) with explicit confidence bands and inversion/wind drivers.
  - Natural-language **Ask BreathEasy** assistant (`POST /api/ask`) with hard-coded pre-LLM clinical distress screening (`detectClinicalEmergencyDistress`).
  - Privacy-first **Memory & Home Settings** (`roomSqft`, `housingType`, `budgetTier`, `language`, optional Firebase Google sign-in + Firestore preference sync with instant reset/delete controls).
- **8-Agent Grounded Pipeline (`src/server/agents.ts`, `src/components/AgentsPipelineView.tsx`)**
  1. **Environmental Intelligence Agent** (`gemini-4-hydrogen` + Google Search) — separates observed station snapshots from uncertainty.
  2. **Predictive Risk Agent** (`gemini-4-hydrogen` + Google Search) — assesses 1h–24h wind and inversion outlook.
  3. **Family Health Protection Agent** — prioritizes vulnerable household members with zero medical diagnosis or guilt framing.
  4. **Mobility & Route Agent** (`gemini-4-hydrogen` + Google Maps `latLng`) — compares Metro/enclosed transit hubs and lower-exposure corridors.
  5. **Indoor Air Guardian Agent** (Multimodal room/stove vision + deterministic box model) — prioritizes ₹0 steps and enforces combustion ventilation rules.
  6. **Community Intelligence Agent** — evaluates corroborated Community Pulse clusters while masking PII.
  7. **Action Planner Agent** (`ThinkingLevel.HIGH`) — resolves conflicts (e.g., cooking exhaust vs. sealing windows) into a daily schedule.
  8. **Verification & Safety Validator** — runs `runDeterministicSafetyAudit` + 7-point safety audit across all prior agent outputs.
- **3D Household & Street Airshed Digital Twin (`src/components/AirQuality3DScene.tsx`, `src/components/DigitalTwinView.tsx`)**
  - Interactive Three.js scene showing outdoor PM2.5 haze, wind vectors, window sealing, and HEPA purification in real time, paired with `O(1)` deterministic scenario comparisons (`runDigitalTwinSimulation`).
- **Indoor Safe Room Optimizer & Community Pulse (`src/components/IndoorCommunityView.tsx`)**
  - Single-zone mass-balance box model (`runIndoorBoxSimulation`) labeled clearly as modeled estimates.
  - Budget-aware protection plans (`₹0`, `Under ₹500`, `Under ₹2,000`, `Under ₹5,000`, `Under ₹10,000`) filtered by room size, toddler safety, and pet-safe plant warnings (`getCleanRoomPlans`).
  - Community Pulse reporting (`GET/POST /api/community/reports`) with server-side PII redaction (`redactPiiFromNote`) and 45-minute corroboration clustering.
- **High-Priority Emergency Playbook (`src/components/EmergencyOverlay.tsx`)**
  - High-contrast, minimal-distraction overlay with 112/102 emergency dial links, step-by-step Web Speech voice instructions, and on-demand verified 24h ER/pharmacy lookup (`POST /api/emergency/resources`).

## Architecture & Key Files

- `server.ts` & `src/server/app.ts` — Express server running on port `3000`, serving API endpoints, rate limiters, iframe-safe security headers, and `vite.middlewares` in development.
- `src/server/validation.ts` — Strict Zod schemas (`agentRunSchema`, `askSchema`, `communityReportSchema`, `twinSimulateSchema`, `indoorSimulateSchema`, `emergencyResourcesSchema`) and PII redaction.
- `src/lib/deterministicEngines.ts` — CPCB AQI mapping, predictive outlook, digital twin, indoor box model, budget optimizer, clinical emergency detector, and URL sanitizer (`sanitizeHttpUrl`).
- `src/lib/firebase.ts`, `firebase-blueprint.json`, `firestore.rules` — Owner-scoped Firestore persistence (`users/{userId}`) with strict schema validation and security rules.

## Environment Setup

Copy `.env.example` or configure environment secrets on the server side only (never expose API keys in `VITE_*` variables):

- `GEMINI_API_KEY` — Server-side Gemini API key used exclusively inside Express routes (`/api/agents/run`, `/api/ask`, `/api/emergency/resources`).
- `APP_URL` — Public application origin URL.

## Commands

```bash
# Start full-stack dev server (Express + Vite on port 3000)
npm run dev

# Run deterministic unit, API, Firestore rules, and UI tests
npm test

# Type-check TypeScript (strict) & lint JS + Firestore security rules
npm run lint

# Build production client bundle with vendor code-splitting
npm run build
```
