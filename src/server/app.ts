import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import {
  detectClinicalEmergencyDistress,
  getCleanRoomPlans,
  getCpcbVerdict,
  runDigitalTwinSimulation,
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
import {
  agentRunSchema,
  askSchema,
  communityReportSchema,
  emergencyResourcesSchema,
  indoorSimulateSchema,
  redactPiiFromNote,
  twinSimulateSchema,
} from './validation.ts';

interface GroundingChunkLike {
  web?: { uri?: string; title?: string };
  maps?: { uri?: string; title?: string };
}

interface GeminiHttpErrorShape {
  status?: number;
  message?: string;
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 45000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown, fallback: string): { status: number; message: string } {
  const shaped = err as GeminiHttpErrorShape | null;
  const raw = err instanceof Error ? err.message : String(shaped?.message || fallback);
  if (shaped?.status === 429 || raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Gemini API quota/rate limit reached (429 RESOURCE_EXHAUSTED). Please verify your Gemini API billing/quota or retry shortly.',
    };
  }
  const status =
    typeof shaped?.status === 'number' && shaped.status >= 400 && shaped.status < 600
      ? shaped.status
      : 500;
  return { status, message: raw };
}

function extractSearchLinks(response: GenerateContentResponse): GroundingLink[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as
    | GroundingChunkLike[]
    | undefined;
  if (!Array.isArray(chunks)) return [];
  const links: GroundingLink[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const safeUri = c?.web?.uri ? sanitizeHttpUrl(c.web.uri) : null;
    if (safeUri && !seen.has(safeUri)) {
      seen.add(safeUri);
      links.push({
        title: c.web?.title || safeUri,
        uri: safeUri,
        sourceType: 'google_search',
      });
    }
  }
  return links.slice(0, 6);
}

function extractMapsLinks(response: GenerateContentResponse): GroundingLink[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as
    | GroundingChunkLike[]
    | undefined;
  if (!Array.isArray(chunks)) return [];
  const links: GroundingLink[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const safeUri = c?.maps?.uri ? sanitizeHttpUrl(c.maps.uri) : null;
    if (safeUri && !seen.has(safeUri)) {
      seen.add(safeUri);
      links.push({
        title: c.maps?.title || 'View on Google Maps',
        uri: safeUri,
        sourceType: 'google_maps',
      });
    }
  }
  return links.slice(0, 6);
}

const AGENT_META: Record<
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

function languageLabel(lang: HouseholdState['language']): string {
  if (lang === 'hi') return 'Hindi (Devanagari script, warm natural everyday Hindi)';
  if (lang === 'bn') return 'Bengali (Bangla script, warm natural everyday Bengali)';
  return 'English (clear, calm, plain language)';
}

function createRateLimiter(windowMs: number, maxRequests: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'local';
    const now = Date.now();
    const valid = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (valid.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a few seconds before retrying.',
      });
      return;
    }
    valid.push(now);
    hits.set(key, valid);
    next();
  };
}

function createInitialReports(): CommunityReport[] {
  return [
    {
      id: 'rep_seed_1',
      cityId: 'delhi_mayur_vihar',
      h3Zone: 'H3-883da112-NW',
      category: 'garbage_burning',
      severity: 'moderate',
      note: 'Dry leaf and plastic smoke near Pocket-C boundary park.',
      corroborations: 3,
      confidence: 0.76,
      status: 'community_corroborated',
      createdAtIso: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    },
    {
      id: 'rep_seed_2',
      cityId: 'delhi_mayur_vihar',
      h3Zone: 'H3-883da114-E',
      category: 'construction_dust',
      severity: 'mild',
      note: 'Uncovered sand unloading near metro pillar corridor.',
      corroborations: 1,
      confidence: 0.28,
      status: 'unconfirmed_single',
      createdAtIso: new Date(Date.now() - 41 * 60 * 1000).toISOString(),
    },
    {
      id: 'rep_seed_3',
      cityId: 'gurugram_dlf',
      h3Zone: 'H3-883da409-S',
      category: 'traffic_congestion',
      severity: 'moderate',
      note: 'Heavy diesel idling along service lane junction.',
      corroborations: 2,
      confidence: 0.58,
      status: 'community_corroborated',
      createdAtIso: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    },
  ];
}

export function createApiApp(options?: { disableRateLimit?: boolean }) {
  const app = express();
  const communityReports = createInitialReports();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // Baseline Security Headers (iframe-safe, no X-Frame-Options)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
    next();
  });

  if (!options?.disableRateLimit) {
    app.use('/api/agents/run', createRateLimiter(60_000, 40));
    app.use('/api/ask', createRateLimiter(60_000, 30));
    app.use('/api/community/reports', createRateLimiter(60_000, 40));
    app.use('/api/emergency/resources', createRateLimiter(60_000, 20));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'BreathEasy AI', timestamp: new Date().toISOString() });
  });

  app.get('/api/community/reports', (req, res) => {
    const rawCity = typeof req.query.cityId === 'string' ? req.query.cityId.trim() : undefined;
    if (rawCity && !/^[a-z0-9_]+$/.test(rawCity)) {
      return res.status(400).json({ error: 'Invalid cityId parameter.' });
    }
    const filtered = rawCity
      ? communityReports.filter((r) => r.cityId === rawCity)
      : communityReports;
    return res.json({ reports: filtered });
  });

  app.post('/api/community/reports', (req, res) => {
    const parsed = communityReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid community report payload.',
      });
    }

    const { cityId, category, severity, note } = parsed.data;
    const cleanNote = redactPiiFromNote(note);

    const cutoff = Date.now() - 45 * 60 * 1000;
    const existing = communityReports.find(
      (r) =>
        r.cityId === cityId &&
        r.category === category &&
        new Date(r.createdAtIso).getTime() >= cutoff,
    );

    if (existing) {
      existing.corroborations += 1;
      existing.confidence = Math.min(0.95, Number((existing.confidence + 0.22).toFixed(2)));
      existing.status =
        existing.corroborations >= 3 ? 'community_corroborated' : 'unconfirmed_single';
      existing.createdAtIso = new Date().toISOString();
      return res.json({ report: existing, clustered: true });
    }

    const created: CommunityReport = {
      id: `rep_${Date.now()}`,
      cityId,
      h3Zone: `H3-${cityId.slice(0, 5)}-local`,
      category,
      severity,
      note: cleanNote || `${category.replace(/_/g, ' ')} observed nearby.`,
      corroborations: 1,
      confidence: 0.28,
      status: 'unconfirmed_single',
      createdAtIso: new Date().toISOString(),
    };
    communityReports.unshift(created);
    return res.status(201).json({ report: created, clustered: false });
  });

  app.post('/api/twin/simulate', (req, res) => {
    const parsed = twinSimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid simulation parameters.',
      });
    }
    return res.json(runDigitalTwinSimulation(parsed.data));
  });

  app.post('/api/indoor/simulate', (req, res) => {
    const parsed = indoorSimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid indoor simulation parameters.',
      });
    }
    return res.json(runIndoorBoxSimulation(parsed.data));
  });

  app.post('/api/agents/run', async (req, res) => {
    const startedAt = Date.now();
    const parsed = agentRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Valid agentId and household state are required.',
      });
    }

    try {
      const {
        agentId,
        household,
        priorOutputs,
        roomImageBase64,
        roomImageMimeType,
        indoorNote,
        customPm25,
      } = parsed.data;

      const typedPrior = priorOutputs as Partial<Record<AgentId, AgentRunResult>>;
      const ai = getAiClient();
      const meta = AGENT_META[agentId];
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

      const cityReports = communityReports.filter((r) => r.cityId === household.city.id);

      let content = '';
      let groundingLinks: GroundingLink[] = [];
      let confidence: AgentRunResult['confidence'] = 'medium';
      let verificationPassed: boolean | undefined;
      const warnings: string[] = [];

      if (agentId === 'env_intelligence') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze current air quality and weather context for ${household.city.locality}, ${household.city.name}, India.
Reference local station snapshot: PM2.5 ~${pm25} ug/m3 (CPCB approx AQI ${verdict.aqiApprox}, ${verdict.category}), PM10 ~${household.city.baselinePm10} ug/m3, NO2 ~${household.city.baselineNo2} ug/m3, Wind ${household.city.windKmh} km/h, Temp ${household.city.tempC} C, RH ${household.city.humidityPct}%.
Use Google Search to check any current air quality, weather, or CPCB/GRAP updates for ${household.city.name}.
Respond in ${langDesc}. ${eliRule}
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
        groundingLinks = extractSearchLinks(response);
        confidence = groundingLinks.length > 0 ? 'high' : 'medium';
      } else if (agentId === 'predictive_risk') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Assess short-term pollution outlook (1h, 3h, 6h, 24h) for ${household.city.locality}, ${household.city.name}.
Current snapshot: PM2.5 ${pm25} ug/m3, Wind ${household.city.windKmh} km/h, Temp ${household.city.tempC} C, Humidity ${household.city.humidityPct}%.
Prior Agent 1 context: ${typedPrior.env_intelligence?.summary || 'Not run yet.'}
Use Google Search to verify today's weather/wind forecast for ${household.city.name}.
Respond in ${langDesc}. ${eliRule}
Clearly distinguish Observed vs. Predicted horizons, state Confidence (Low/Medium/High), highlight upcoming risk windows (e.g., evening cooling/inversion) or safer afternoon windows, and keep under 160 words.`,
          config: {
            systemInstruction:
              'You are BreathEasy Agent 2 (Predictive Risk Agent). Never present 6h-24h forecasts as certainty; always state confidence and weather drivers.',
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        content = response.text || 'Unable to generate predictive outlook.';
        groundingLinks = extractSearchLinks(response);
        confidence = 'medium';
      } else if (agentId === 'family_health') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Create a calm, vulnerable-first household protection brief for:
Members: ${memberSummary}
Location: ${household.city.locality}, ${household.city.name} (PM2.5 ${pm25} ug/m3, CPCB ${verdict.category}).
Prior Env/Risk notes: ${typedPrior.env_intelligence?.content?.slice(0, 320) || 'PM2.5 ' + pm25}
Respond in ${langDesc}. ${eliRule}
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
      } else if (agentId === 'mobility_route') {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Find nearby metro/transit stations, quieter residential streets, or green/covered commuter hubs near ${household.city.locality}, ${household.city.name} for a morning school/work commute at ${household.schoolTime} (current mode: ${household.commuteMode}, PM2.5: ${pm25} ug/m3).
Respond in ${langDesc}. ${eliRule}
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
        groundingLinks = extractMapsLinks(response);
        confidence = groundingLinks.length > 0 ? 'high' : 'medium';
      } else if (agentId === 'indoor_air') {
        const boxSim = runIndoorBoxSimulation({
          outdoorPm25: pm25,
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

        const promptText = `Inspect indoor air risks for a ${household.housingType.replace(/_/g, ' ')} (${household.roomSqft} sq ft room) in ${household.city.name} where outdoor PM2.5 is ${pm25} ug/m3.
Household flags: hasPets=${household.hasPets}, hasToddler=${household.hasToddler}, budgetTier=${household.budgetTier}.
User note: ${indoorNote || 'No extra note provided.'}
Deterministic indoor box-model estimate (modeled, not measured sensor): baseline ~${boxSim.baselineMid} ug/m3 -> improved ~${boxSim.simulatedRange[0]}-${boxSim.simulatedRange[1]} ug/m3 (${boxSim.dropPctRange[0]}%-${boxSim.dropPctRange[1]}% estimated drop).
Respond in ${langDesc}. ${eliRule}
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
      } else if (agentId === 'community_intel') {
        const reportsJson = JSON.stringify(cityReports);
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Evaluate active Community Pulse reports for ${household.city.name} (Wind ${household.city.windKmh} km/h):
Reports: ${reportsJson}
Respond in ${langDesc}. ${eliRule}
Summarize: (1) Which reports are corroborated vs. unconfirmed single reports, (2) Downwind precautions without naming or accusing any private individuals or businesses, (3) Confidence summary.`,
          config: {
            systemInstruction:
              'You are BreathEasy Agent 6 (Community Intelligence Agent). Treat single reports as unconfirmed. Never blame specific private individuals or businesses.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        content = response.text || 'No active local reports to evaluate.';
        confidence = cityReports.some((r) => r.corroborations >= 3) ? 'medium' : 'low';
      } else if (agentId === 'action_planner') {
        const synthesizedPrior = Object.values(typedPrior)
          .filter((o): o is AgentRunResult => Boolean(o && typeof o.content === 'string'))
          .map((o) => `[Agent ${o.agentNumber} - ${o.agentName}]: ${o.content.slice(0, 350)}`)
          .join('\n\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Synthesize all available agent findings into one calm, practical, budget-respecting (${household.budgetTier}) daily action plan for ${household.city.locality}, ${household.city.name} (School/commute anchor: ${household.schoolTime}, mode: ${household.commuteMode}).
Available prior findings:
${synthesizedPrior || `Current PM2.5 ~${pm25} ug/m3 (${verdict.category}). Members: ${memberSummary}.`}

Respond in ${langDesc}. ${eliRule}
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
        confidence = Object.keys(typedPrior).length >= 3 ? 'high' : 'medium';
      } else if (agentId === 'verification_safety') {
        const allOutputs = Object.values(typedPrior).filter(
          (o): o is AgentRunResult => Boolean(o && typeof o.content === 'string'),
        );
        const combinedText = allOutputs.map((o) => o.content).join('\n');

        const hasDiagnosisPhrase =
          /\b(you have bronchitis|you have pneumonia|take \d+mg|double your inhaler)\b/i.test(
            combinedText,
          );
        const hasGuiltPhrase = /\b(bad parent|shame on|smoking \d+ cigarettes)\b/i.test(
          combinedText,
        );
        const hasDisclaimer = /not medical advice|medical advice|physician|doctor|चिकित्सा|চিকিৎসা/i.test(
          combinedText,
        );

        if (hasDiagnosisPhrase) warnings.push('Flagged potential diagnostic/dosing phrasing.');
        if (hasGuiltPhrase) {
          warnings.push('Flagged non-supportive guilt/cigarette comparison framing.');
        }
        if (!hasDisclaimer && allOutputs.length > 0) {
          warnings.push('Added missing non-medical advisory disclaimer.');
        }

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Audit the following multi-agent outputs for ${household.city.name} (Baseline PM2.5=${pm25} ug/m3) across all 7 safety criteria:
1. Medical Safety (no diagnosis or dosing)
2. Numeric Grounding (modeled estimates labeled as estimates, no invented readings)
3. Calculation Consistency
4. Source Citations
5. Physical Safety (combustion ventilation, pet-safe plants)
6. Zero Conflicting Advice
7. Appropriate Urgency & Calm Tone (zero fear/guilt)

Agent Outputs to Audit:
${allOutputs.map((o) => `--- Agent ${o.agentNumber}: ${o.agentName} ---\n${o.content.slice(0, 450)}`).join('\n\n') || 'No prior agent outputs supplied yet.'}

Respond in ${langDesc} with a concise Verification Report stating PASS/CAUTION, any detected gaps, and a clean confirmed disclaimer.`,
          config: {
            systemInstruction:
              'You are BreathEasy Agent 8 (Verification & Safety Validator). Be strict on clinical safety, numeric honesty, and calm non-alarmist tone.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });

        verificationPassed = !hasDiagnosisPhrase && !hasGuiltPhrase;
        content = response.text || 'Verification audit completed.';
        confidence = 'high';
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

      const result: AgentRunResult = {
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

      return res.json(result);
    } catch (err: unknown) {
      console.error('Agent run error:', err);
      const formatted = formatGeminiError(err, 'Agent execution failed.');
      return res.status(formatted.status).json({
        error: formatted.message,
      });
    }
  });

  app.post('/api/ask', async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Question cannot be empty.',
      });
    }

    try {
      const { question, household } = parsed.data;

      if (detectClinicalEmergencyDistress(question)) {
        return res.json({
          emergencyTriggered: true,
          answer:
            'Emergency signals detected. Please contact local emergency services (112 / 102) or seek urgent medical care immediately. Do not wait for AI conversation.',
          groundingLinks: [],
        });
      }

      const ai = getAiClient();
      const pm25 = household.city.baselinePm25;
      const verdict = getCpcbVerdict(pm25);
      const langDesc = languageLabel(household.language);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `User question: "${question}"
Household context: ${household.city.locality}, ${household.city.name} (PM2.5 ~${pm25} ug/m3, CPCB ${verdict.category}). Budget: ${household.budgetTier}. Members: ${household.members.map((m) => m.label).join(', ')}.
Respond in ${langDesc}. ${household.eli10 ? 'Use Explain-Like-Im-10 simplicity.' : 'Keep it calm, concise, and under 130 words.'}
End with: "Guidance only — not medical advice."`,
        config: {
          systemInstruction:
            'You are BreathEasy Ask AI. Ground answers with Google Search when current conditions/advisories help. Never diagnose or prescribe. Be calm, practical, and budget-aware.',
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      return res.json({
        emergencyTriggered: false,
        answer: response.text || 'I could not generate a response right now.',
        groundingLinks: extractSearchLinks(response),
      });
    } catch (err: unknown) {
      console.error('Ask error:', err);
      const formatted = formatGeminiError(err, 'Ask BreathEasy failed.');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/emergency/resources', async (req, res) => {
    const parsed = emergencyResourcesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid location parameters.',
      });
    }

    try {
      const { lat, lng, cityName } = parsed.data;
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find the nearest open 24-hour emergency hospitals and 24-hour pharmacies near ${cityName}. List up to 4 verified places clearly with short distances/areas.`,
        config: {
          systemInstruction:
            'You assist during an emergency checklist lookup. List only verified nearby hospitals/ERs and pharmacies concisely. Never give medical diagnoses.',
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: { latitude: lat, longitude: lng },
            },
          },
        },
      });

      return res.json({
        summary:
          response.text || 'Call 112 / 102 or proceed to nearest verified hospital emergency room.',
        places: extractMapsLinks(response),
      });
    } catch (err: unknown) {
      console.error('Emergency Maps lookup error:', err);
      const formatted = formatGeminiError(err, 'Emergency resource lookup failed.');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return app;
}
