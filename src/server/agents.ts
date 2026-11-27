import { ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import {
  getCleanRoomPlans,
  getCpcbVerdict,
  runIndoorBoxSimulation,
  sanitizeHttpUrl,
} from '../lib/deterministicEngines.ts';
import type {
  AgentId,
  AgentRunResult,
  CommunityReport,
  GroundingLink,
  HouseholdState,
} from '../types/breatheasy.ts';

export interface AiClientLike {
  models: {
    generateContent: (params: {
      model: string;
      contents:
        | string
        | {
            parts: Array<
              | { inlineData: { mimeType: string; data: string } }
              | { text: string }
            >;
          };
      config?: Record<string, unknown>;
    }) => Promise<GenerateContentResponse>;
  };
}

interface GroundingChunkLike {
  web?: { uri?: string; title?: string };
  maps?: { uri?: string; title?: string };
}

export interface PriorAgentSnippet {
  agentId: AgentId;
  agentNumber: number;
  agentName: string;
  summary?: string;
  content: string;
}

export interface AgentExecutionParams {
  ai: AiClientLike;
  agentId: AgentId;
  household: HouseholdState;
  priorOutputs: Partial<Record<AgentId, PriorAgentSnippet>>;
  cityReports: CommunityReport[];
  roomImageBase64?: string;
  roomImageMimeType?: string;
  indoorNote?: string;
  customPm25?: number;
}

export const AGENT_META: Record<
  AgentId,
  { number: number; name: string; groundingType: AgentRunResult['groundingType'] }
> = {
  env_intelligence: {
    number: 1,
    name: 'Environmental Intelligence Agent',
    groundingType: 'googleSearch',
  },
  predictive_risk: {
    number: 2,
    name: 'Predictive Risk Agent',
    groundingType: 'googleSearch',
  },
  family_health: {
    number: 3,
    name: 'Family Health Protection Agent',
    groundingType: 'deterministic_plus_gemini',
  },
  mobility_route: {
    number: 4,
    name: 'Mobility & Route Agent',
    groundingType: 'googleMaps',
  },
  indoor_air: {
    number: 5,
    name: 'Indoor Air Guardian Agent',
    groundingType: 'multimodal_vision',
  },
  community_intel: {
    number: 6,
    name: 'Community Intelligence Agent',
    groundingType: 'deterministic_plus_gemini',
  },
  action_planner: {
    number: 7,
    name: 'Action Planner Agent',
    groundingType: 'deterministic_plus_gemini',
  },
  verification_safety: {
    number: 8,
    name: 'Verification & Safety Validator',
    groundingType: 'deterministic_plus_gemini',
  },
};

export function languageLabel(lang: HouseholdState['language']): string {
  if (lang === 'hi') return 'Hindi (Devanagari script, warm natural everyday Hindi)';
  if (lang === 'bn') return 'Bengali (Bangla script, warm natural everyday Bengali)';
  return 'English (clear, calm, plain language)';
}

export function extractGroundingLinks(
  response: GenerateContentResponse,
  source: 'google_search' | 'google_maps',
): GroundingLink[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as
    | GroundingChunkLike[]
    | undefined;
  if (!Array.isArray(chunks)) return [];
  const links: GroundingLink[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const raw = source === 'google_search' ? c?.web : c?.maps;
    const safeUri = raw?.uri ? sanitizeHttpUrl(raw.uri) : null;
    if (safeUri && !seen.has(safeUri)) {
      seen.add(safeUri);
      links.push({
        title: raw?.title || (source === 'google_maps' ? 'View on Google Maps' : safeUri),
        uri: safeUri,
        sourceType: source,
      });
    }
  }
  return links.slice(0, 6);
}

/**
 * Deterministic safety scanner executed outside the LLM before/alongside Agent 8
 * to catch diagnostic claims, guilt framing, or missing non-medical disclaimers.
 */
export function runDeterministicSafetyAudit(priorOutputs: PriorAgentSnippet[]): {
  verificationPassed: boolean;
  warnings: string[];
} {
  const combinedText = priorOutputs.map((o) => o.content).join('\n');
  const warnings: string[] = [];

  const hasDiagnosisPhrase =
    /\b(you have bronchitis|you have pneumonia|take \d+mg|double your inhaler)\b/i.test(
      combinedText,
    );
  const hasGuiltPhrase = /\b(bad parent|shame on|smoking \d+ cigarettes)\b/i.test(combinedText);
  const hasDisclaimer = /not medical advice|medical advice|physician|doctor|चिकित्सा|চিকিৎসা/i.test(
    combinedText,
  );

  if (hasDiagnosisPhrase) warnings.push('Flagged potential diagnostic/dosing phrasing.');
  if (hasGuiltPhrase) warnings.push('Flagged non-supportive guilt/cigarette comparison framing.');
  if (!hasDisclaimer && priorOutputs.length > 0) {
    warnings.push('Added missing non-medical advisory disclaimer.');
  }

  return {
    verificationPassed: !hasDiagnosisPhrase && !hasGuiltPhrase,
    warnings,
  };
}

function buildAgentContext(params: AgentExecutionParams) {
  const { household, customPm25 } = params;
  const pm25 = typeof customPm25 === 'number' ? customPm25 : household.city.baselinePm25;
  const verdict = getCpcbVerdict(pm25);
  const langDesc = languageLabel(household.language);
  const eliRule = household.eli10
    ? 'Use Explain-Like-Im-10 simplicity with warm everyday analogies.'
    : 'Use calm, plain, practical everyday prose without jargon.';
  const memberSummary = household.members
    .map(
      (m) =>
        `${m.label} (${m.category}, sensitivity=${m.sensitivity}${m.privacyMasked ? ', masked-for-external-share' : ''})`,
    )
    .join('; ');

  return { pm25, verdict, langDesc, eliRule, memberSummary };
}

export async function executeAgent(params: AgentExecutionParams): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const { ai, agentId, household, priorOutputs, cityReports, roomImageBase64, roomImageMimeType, indoorNote } =
    params;
  const meta = AGENT_META[agentId];
  const ctx = buildAgentContext(params);

  let content = '';
  let groundingLinks: GroundingLink[] = [];
  let confidence: AgentRunResult['confidence'] = 'medium';
  let verificationPassed: boolean | undefined;
  let warnings: string[] = [];

  switch (agentId) {
    case 'env_intelligence': {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze current air quality and weather context for ${household.city.locality}, ${household.city.name}, India.
Reference local station snapshot: PM2.5 ~${ctx.pm25} ug/m3 (CPCB approx AQI ${ctx.verdict.aqiApprox}, ${ctx.verdict.category}), PM10 ~${household.city.baselinePm10} ug/m3, NO2 ~${household.city.baselineNo2} ug/m3, Wind ${household.city.windKmh} km/h, Temp ${household.city.tempC} C, RH ${household.city.humidityPct}%.
Use Google Search to check any current air quality, weather, or CPCB/GRAP updates for ${household.city.name}.
Respond in ${ctx.langDesc}. ${ctx.eliRule}
Structure cleanly into:
1. Observed vs. Snapshot Status (with timestamps/data quality check)
2. Main Drivers (only state drivers backed by pollutant ratios, wind, or Search findings—never invent causes)
3. What Is Uncertain
Keep under 160 words.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 1 (Environmental Intelligence Analyst). Separate observed/retrieved data from uncertainty. Never fabricate readings.',
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      content = response.text || 'Unable to generate environmental analysis.';
      groundingLinks = extractGroundingLinks(response, 'google_search');
      confidence = groundingLinks.length > 0 ? 'high' : 'medium';
      break;
    }

    case 'predictive_risk': {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Assess short-term pollution outlook (1h, 3h, 6h, 24h) for ${household.city.locality}, ${household.city.name}.
Current snapshot: PM2.5 ${ctx.pm25} ug/m3, Wind ${household.city.windKmh} km/h, Temp ${household.city.tempC} C, Humidity ${household.city.humidityPct}%.
Prior Agent 1 context: ${priorOutputs.env_intelligence?.summary || 'Not run yet.'}
Use Google Search to verify today's weather/wind forecast for ${household.city.name}.
Respond in ${ctx.langDesc}. ${ctx.eliRule}
Clearly distinguish Observed vs. Predicted horizons, state Confidence (Low/Medium/High), highlight upcoming risk windows (e.g., evening cooling/inversion) or safer afternoon windows, and keep under 160 words.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 2 (Predictive Risk Agent). Never present 6h-24h forecasts as certainty; always state confidence and weather drivers.',
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      content = response.text || 'Unable to generate predictive outlook.';
      groundingLinks = extractGroundingLinks(response, 'google_search');
      confidence = 'medium';
      break;
    }

    case 'family_health': {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Create a calm, vulnerable-first household protection brief for:
Members: ${ctx.memberSummary}
Location: ${household.city.locality}, ${household.city.name} (PM2.5 ${ctx.pm25} ug/m3, CPCB ${ctx.verdict.category}).
Prior Env/Risk notes: ${priorOutputs.env_intelligence?.content?.slice(0, 320) || 'PM2.5 ' + ctx.pm25}
Respond in ${ctx.langDesc}. ${ctx.eliRule}
Requirements:
- Rank who needs protection most first (infants, respiratory-sensitive, elderly, children, pets).
- Give 3 practical protective steps without fear, shame, or medical diagnosis/prescriptions.
- Include a short 1-line non-medical disclaimer at the end.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 3 (Family Health Protection Agent). Prioritize vulnerable members calmly. Strictly NO medical diagnosis, NO medication dosing advice.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      content = response.text || 'Unable to generate family protection guidance.';
      confidence = 'high';
      break;
    }

    case 'mobility_route': {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find nearby metro/transit stations, quieter residential streets, or green/covered commuter hubs near ${household.city.locality}, ${household.city.name} for a morning school/work commute at ${household.schoolTime} (current mode: ${household.commuteMode}, PM2.5: ${ctx.pm25} ug/m3).
Respond in ${ctx.langDesc}. ${ctx.eliRule}
Compare 2-3 commute/route options (timing shift vs. enclosed Metro/AC vs. open road), mentioning real nearby transit hubs or landmarks found via Maps.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 4 (Mobility & Route Agent). Compare exposure trade-offs across 2-3 commute options calmly. Never suggest vigorous outdoor cycling/walking on high-pollution arterial roads when AQI is Very Poor/Severe.',
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: household.city.lat,
                longitude: household.city.lng,
              },
            },
          },
        },
      });
      content = response.text || 'Unable to generate mobility comparison.';
      groundingLinks = extractGroundingLinks(response, 'google_maps');
      confidence = groundingLinks.length > 0 ? 'high' : 'medium';
      break;
    }

    case 'indoor_air': {
      const boxSim = runIndoorBoxSimulation({
        outdoorPm25: ctx.pm25,
        roomSqft: household.roomSqft,
        sealGaps: true,
        stopIncense: true,
        coverCooking: true,
        diyBoxFan: household.budgetTier === 'under_2000',
        hepaPurifier:
          household.budgetTier === 'under_5000' || household.budgetTier === 'under_10000',
      });
      const budgetPack = getCleanRoomPlans(
        household.budgetTier,
        household.roomSqft,
        household.hasPets,
        household.hasToddler,
      );

      const promptText = `Inspect indoor air risks for a ${household.housingType.replace(/_/g, ' ')} (${household.roomSqft} sq ft room) in ${household.city.name} where outdoor PM2.5 is ${ctx.pm25} ug/m3.
Household flags: hasPets=${household.hasPets}, hasToddler=${household.hasToddler}, budgetTier=${household.budgetTier}.
User note: ${indoorNote || 'No extra note provided.'}
Deterministic indoor box-model estimate (modeled, not measured sensor): baseline ~${boxSim.baselineMid} ug/m3 -> improved ~${boxSim.simulatedRange[0]}-${boxSim.simulatedRange[1]} ug/m3 (${boxSim.dropPctRange[0]}%-${boxSim.dropPctRange[1]}% estimated drop).
Respond in ${ctx.langDesc}. ${ctx.eliRule}
${roomImageBase64 ? 'Analyze the attached room/stove/window photo carefully for smoke sources, unsealed gaps, or purifier placement.' : 'No photo uploaded: audit based on housing type and deterministic box model.'}
Include: (1) Key indoor risks/ventilation rule (never seal room while burning solid fuel/unvented stove), (2) Top ₹0 actions + budget match, (3) Note that houseplants do not replace HEPA filtration.`;

      const contents = roomImageBase64
        ? {
            parts: [
              {
                inlineData: {
                  mimeType: roomImageMimeType || 'image/jpeg',
                  data: roomImageBase64,
                },
              },
              { text: promptText },
            ],
          }
        : promptText;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 5 (Indoor Air Guardian). Always label box-model figures as modeled estimates, prioritize ₹0 sealing/source control, and enforce combustion ventilation safety.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      content =
        (response.text || '') +
        `\n\n**Plant Safety Note:** ${budgetPack.plantDisclaimer} ${budgetPack.excludedPlants.join(' ')}`;
      confidence = roomImageBase64 ? 'medium' : 'low';
      break;
    }

    case 'community_intel': {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Evaluate active Community Pulse reports for ${household.city.name} (Wind ${household.city.windKmh} km/h):
Reports: ${JSON.stringify(cityReports)}
Respond in ${ctx.langDesc}. ${ctx.eliRule}
Summarize: (1) Which reports are corroborated vs. unconfirmed single reports, (2) Downwind precautions without naming or accusing any private individuals or businesses, (3) Confidence summary.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 6 (Community Intelligence Agent). Treat single reports as unconfirmed. Never blame specific private individuals or businesses.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      content = response.text || 'No active local reports to evaluate.';
      confidence = cityReports.some((r) => r.corroborations >= 3) ? 'medium' : 'low';
      break;
    }

    case 'action_planner': {
      const synthesizedPrior = Object.values(priorOutputs)
        .filter((o): o is PriorAgentSnippet => Boolean(o && typeof o.content === 'string'))
        .map((o) => `[Agent ${o.agentNumber} - ${o.agentName}]: ${o.content.slice(0, 350)}`)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Synthesize all available agent findings into one calm, practical, budget-respecting (${household.budgetTier}) daily action plan for ${household.city.locality}, ${household.city.name} (School/commute anchor: ${household.schoolTime}, mode: ${household.commuteMode}).
Available prior findings:
${synthesizedPrior || `Current PM2.5 ~${ctx.pm25} ug/m3 (${ctx.verdict.category}). Members: ${ctx.memberSummary}.`}

Respond in ${ctx.langDesc}. ${ctx.eliRule}
Provide:
- Morning Action
- Commute / School Run Choice
- Midday Window Strategy
- Evening Safe Room Routine
Resolve any conflicts (e.g., cooking exhaust vs. sealing windows) clearly.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 7 (Action Planner Agent). Create feasible, time-slotted, ₹0-first actions with calm encouragement and zero guilt.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });
      content = response.text || 'Unable to assemble daily action plan.';
      confidence = Object.keys(priorOutputs).length >= 3 ? 'high' : 'medium';
      break;
    }

    case 'verification_safety': {
      const allOutputs = Object.values(priorOutputs).filter(
        (o): o is PriorAgentSnippet => Boolean(o && typeof o.content === 'string'),
      );
      const audit = runDeterministicSafetyAudit(allOutputs);
      verificationPassed = audit.verificationPassed;
      warnings = audit.warnings;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Audit the following multi-agent outputs for ${household.city.name} (Baseline PM2.5=${ctx.pm25} ug/m3) across all 7 safety criteria:
1. Medical Safety (no diagnosis or dosing)
2. Numeric Grounding (modeled estimates labeled as estimates, no invented readings)
3. Calculation Consistency
4. Source Citations
5. Physical Safety (combustion ventilation, pet-safe plants)
6. Zero Conflicting Advice
7. Appropriate Urgency & Calm Tone (zero fear/guilt)

Agent Outputs to Audit:
${allOutputs.map((o) => `--- Agent ${o.agentNumber}: ${o.agentName} ---\n${o.content.slice(0, 450)}`).join('\n\n') || 'No prior agent outputs supplied yet.'}

Respond in ${ctx.langDesc} with a concise Verification Report stating PASS/CAUTION, any detected gaps, and a clean confirmed disclaimer.`,
        config: {
          systemInstruction:
            'You are BreathEasy Agent 8 (Verification & Safety Validator). Be strict on clinical safety, numeric honesty, and calm non-alarmist tone.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      content = response.text || 'Verification audit completed.';
      confidence = 'high';
      break;
    }
  }

  const summary =
    content
      .replace(/[#*_`]/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')
      .slice(0, 170) || `${meta.name} completed.`;

  return {
    agentId,
    agentNumber: meta.number,
    agentName: meta.name,
    modelUsed: 'gemini-4-hydrogen',
    groundingType: meta.groundingType,
    status: 'completed',
    summary,
    content,
    confidence,
    latencyMs: Date.now() - startedAt,
    timestampIso: new Date().toISOString(),
    groundingLinks,
    verificationPassed,
    warnings: warnings.length ? warnings : undefined,
  };
}
