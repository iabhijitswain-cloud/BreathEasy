export type SupportedLanguage = 'en' | 'hi' | 'bn';

export type BudgetTier =
  | 'inr_0'
  | 'under_500'
  | 'under_2000'
  | 'under_5000'
  | 'under_10000';

export type AgentId =
  | 'env_intelligence'
  | 'predictive_risk'
  | 'family_health'
  | 'mobility_route'
  | 'indoor_air'
  | 'community_intel'
  | 'action_planner'
  | 'verification_safety';

export type AgentStatus = 'idle' | 'running' | 'completed' | 'error';

export interface CityPreset {
  id: string;
  name: string;
  locality: string;
  lat: number;
  lng: number;
  baselinePm25: number;
  baselinePm10: number;
  baselineNo2: number;
  windKmh: number;
  tempC: number;
  humidityPct: number;
}

export interface FamilyMemberProfile {
  id: string;
  label: string;
  category:
    | 'adult'
    | 'child'
    | 'infant'
    | 'elderly'
    | 'respiratory_sensitive'
    | 'pet';
  sensitivity: 'standard' | 'elevated' | 'high_protection';
  privacyMasked: boolean;
}

export interface HouseholdState {
  city: CityPreset;
  language: SupportedLanguage;
  eli10: boolean;
  budgetTier: BudgetTier;
  roomSqft: number;
  hasPets: boolean;
  hasToddler: boolean;
  housingType: 'high_rise' | 'independent_flat' | 'ground_floor_roadside';
  commuteMode: 'metro' | 'car_ac' | 'auto_rickshaw' | 'walk';
  schoolTime: string;
  members: FamilyMemberProfile[];
}

export interface GroundingLink {
  title: string;
  uri: string;
  sourceType: 'google_search' | 'google_maps';
}

export interface AgentRunResult {
  agentId: AgentId;
  agentNumber: number;
  agentName: string;
  modelUsed: string;
  groundingType: 'googleSearch' | 'googleMaps' | 'multimodal_vision' | 'deterministic_plus_gemini';
  status: AgentStatus;
  summary: string;
  content: string;
  confidence: 'high' | 'medium' | 'low';
  latencyMs: number;
  timestampIso: string;
  groundingLinks: GroundingLink[];
  verificationPassed?: boolean;
  warnings?: string[];
  error?: string;
}

export type PulseCategory =
  | 'smoke'
  | 'garbage_burning'
  | 'construction_dust'
  | 'traffic_congestion'
  | 'industrial_emissions'
  | 'unusual_odor'
  | 'visibility_problems'
  | 'local_pollution_event';

export interface CommunityReport {
  id: string;
  cityId: string;
  h3Zone: string;
  category: PulseCategory;
  severity: 'mild' | 'moderate' | 'severe';
  note: string;
  corroborations: number;
  confidence: number;
  status: 'unconfirmed_single' | 'community_corroborated' | 'multi_source_verified';
  createdAtIso: string;
}

export interface TwinScenarioInput {
  presetId:
    | 'leave_earlier'
    | 'metro_vs_auto'
    | 'exercise_indoors'
    | 'seal_bedroom'
    | 'purifier_4h';
  ambientPm25: number;
  roomSqft: number;
  durationMin: number;
  purifierHours: number;
  roomSealed: boolean;
}

export interface TwinScenarioResult {
  title: string;
  exposureChangePctRange: [number, number];
  baselineRangeUgM3: [number, number];
  whatIfRangeUgM3: [number, number];
  costDiffInr: number;
  timeDiffMin: number;
  co2SavedKg: number | null;
  co2Defensible: boolean;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  verdict: string;
}
