import type { AgentId } from '../types/breatheasy.ts';

export interface AgentDescriptor {
  id: AgentId;
  number: number;
  name: string;
  role: string;
  capability: string;
  promptVersion: string;
  guardrails: string;
  refusalPolicy: string;
}

export const AGENT_SEQUENCE: AgentDescriptor[] = [
  {
    id: 'env_intelligence',
    number: 1,
    name: 'Environmental Intelligence Agent',
    role: 'Separates observed station snapshots from uncertainties & checks live CPCB/GRAP via Google Search.',
    capability: 'gemini-4-hydrogen + Google Search (LOW)',
    promptVersion: 'v1.4.0',
    guardrails: 'Never fabricate sensor readings; separate observed values from missing data.',
    refusalPolicy: 'States uncertainty explicitly when live web sources are unavailable.',
  },
  {
    id: 'predictive_risk',
    number: 2,
    name: 'Predictive Risk Agent',
    role: 'Assesses 1h/3h/6h/24h inversion & wind dispersion outlook with explicit confidence.',
    capability: 'gemini-4-hydrogen + Google Search (LOW)',
    promptVersion: 'v1.4.0',
    guardrails: 'Never present 6h–24h forecasts as certainty; always attach drivers and confidence.',
    refusalPolicy: 'Avoids multi-day precision claims when synoptic winds are unstable.',
  },
  {
    id: 'family_health',
    number: 3,
    name: 'Family Health Protection Agent',
    role: 'Prioritizes infants, respiratory-sensitive elders, kids & pets calmly with zero diagnosis.',
    capability: 'gemini-4-hydrogen (LOW thinking)',
    promptVersion: 'v1.4.0',
    guardrails: 'Zero medical diagnosis, zero inhaler dosing changes, zero fear or parent guilt.',
    refusalPolicy: 'Defers clinical symptoms immediately to physician care or emergency 112.',
  },
  {
    id: 'mobility_route',
    number: 4,
    name: 'Mobility & Route Agent',
    role: 'Finds real Metro/transit hubs & quieter corridors near your locality via Google Maps grounding.',
    capability: 'gemini-4-hydrogen + Google Maps',
    promptVersion: 'v1.4.0',
    guardrails: 'Never suggest vigorous outdoor walking/cycling on arterial roads in Very Poor/Severe air.',
    refusalPolicy: 'Omits unverified landmarks if Maps returns zero matching stops.',
  },
  {
    id: 'indoor_air',
    number: 5,
    name: 'Indoor Air Guardian Agent',
    role: 'Combines room photo vision + deterministic box model + ₹0-first budget actions.',
    capability: 'gemini-4-hydrogen Multimodal + Box Model',
    promptVersion: 'v1.4.0',
    guardrails: 'Never recommend sealing rooms with active solid-fuel/unvented combustion; houseplants != HEPA.',
    refusalPolicy: 'Labels box-model figures strictly as modeled estimates, not sensor measurements.',
  },
  {
    id: 'community_intel',
    number: 6,
    name: 'Community Intelligence Agent',
    role: 'Evaluates active Community Pulse reports, corroboration clusters & downwind precautions.',
    capability: 'gemini-4-hydrogen + Pulse Clustering',
    promptVersion: 'v1.4.0',
    guardrails: 'Treat single reports as unconfirmed; never name or blame private individuals/businesses.',
    refusalPolicy: 'Redacts PII and flags low confidence until >= 3 reports corroborate.',
  },
  {
    id: 'action_planner',
    number: 7,
    name: 'Action Planner Agent',
    role: 'Synthesizes prior agents into a conflict-free morning, commute, midday & evening routine.',
    capability: 'gemini-4-hydrogen (HIGH thinking)',
    promptVersion: 'v1.4.0',
    guardrails: 'Resolve cooking-vent vs. window-sealing conflicts; prioritize ₹0 steps first.',
    refusalPolicy: 'Respects selected budget tier and avoids unnecessary product upsells.',
  },
  {
    id: 'verification_safety',
    number: 8,
    name: 'Verification & Safety Validator',
    role: 'Runs hard-coded clinical/guilt regexes + 7-point safety audit across all agent outputs.',
    capability: 'Deterministic Gate + gemini-4-hydrogen',
    promptVersion: 'v1.4.0',
    guardrails: 'Checks clinical safety, numeric honesty, citations, combustion safety, and calm tone.',
    refusalPolicy: 'Flags CAUTION automatically if any diagnostic or guilt phrase is detected.',
  },
];
