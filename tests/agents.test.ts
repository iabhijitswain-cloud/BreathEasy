import { describe, expect, it, vi } from 'vitest';
import {
  executeAgent,
  extractGroundingLinks,
  runDeterministicSafetyAudit,
  type AiClientLike,
  type PriorAgentSnippet,
} from '../src/server/agents.ts';
import { CITY_PRESETS, DEFAULT_MEMBERS } from '../src/lib/deterministicEngines.ts';
import type { AgentId, CommunityReport, HouseholdState } from '../src/types/breatheasy.ts';

const baseHousehold: HouseholdState = {
  city: CITY_PRESETS[0],
  language: 'en',
  eli10: false,
  budgetTier: 'under_2000',
  roomSqft: 140,
  hasPets: true,
  hasToddler: true,
  housingType: 'independent_flat',
  commuteMode: 'auto_rickshaw',
  schoolTime: '07:45 AM',
  members: DEFAULT_MEMBERS,
};

const sampleReports: CommunityReport[] = [
  {
    id: 'rep_1',
    cityId: baseHousehold.city.id,
    h3Zone: 'H3-883da112-NW',
    category: 'garbage_burning',
    severity: 'moderate',
    note: 'Leaf smoke near boundary park.',
    corroborations: 3,
    confidence: 0.78,
    status: 'community_corroborated',
    createdAtIso: new Date().toISOString(),
  },
];

function createMockAi(overrideText?: string): {
  ai: AiClientLike;
  calls: Array<{ model: string; contents: unknown; config?: Record<string, unknown> }>;
} {
  const calls: Array<{ model: string; contents: unknown; config?: Record<string, unknown> }> = [];
  const ai: AiClientLike = {
    models: {
      generateContent: vi.fn(async (params) => {
        calls.push(params);
        return {
          text:
            overrideText ??
            'Calm modeled guidance only — not medical advice. Consult your physician for symptoms.',
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: 'https://cpcb.nic.in/aqi',
                      title: 'CPCB Live Bulletin',
                    },
                  },
                  {
                    web: {
                      uri: 'javascript:alert(1)',
                      title: 'Unsafe Link Should Be Stripped',
                    },
                  },
                  {
                    maps: {
                      uri: 'https://maps.google.com/?q=Mayur+Vihar+Metro',
                      title: 'Mayur Vihar Phase 1 Metro',
                    },
                  },
                ],
              },
            },
          ],
        } as unknown as Awaited<ReturnType<AiClientLike['models']['generateContent']>>;
      }),
    },
  };
  return { ai, calls };
}

describe('Server multi-agent orchestrator & safety audit', () => {
  it('sanitizes grounding links and strips unsafe javascript/data schemes', () => {
    const mockResponse = {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.com/a', title: 'Valid A' } },
              { web: { uri: 'https://example.com/a', title: 'Duplicate A' } },
              { web: { uri: 'javascript:alert(1)', title: 'Bad JS' } },
              { maps: { uri: 'https://maps.google.com/?q=Metro', title: 'Valid Map' } },
            ],
          },
        },
      ],
    } as unknown as Parameters<typeof extractGroundingLinks>[0];

    const webLinks = extractGroundingLinks(mockResponse, 'google_search');
    expect(webLinks).toEqual([
      { title: 'Valid A', uri: 'https://example.com/a', sourceType: 'google_search' },
    ]);

    const mapLinks = extractGroundingLinks(mockResponse, 'google_maps');
    expect(mapLinks).toEqual([
      { title: 'Valid Map', uri: 'https://maps.google.com/?q=Metro', sourceType: 'google_maps' },
    ]);
  });

  it('executes all 8 agents sequentially with proper grounding, multimodal parts, and safety pass', async () => {
    const { ai, calls } = createMockAi();
    const priorOutputs: Partial<Record<AgentId, PriorAgentSnippet>> = {};
    const orderedIds: AgentId[] = [
      'env_intelligence',
      'predictive_risk',
      'family_health',
      'mobility_route',
      'indoor_air',
      'community_intel',
      'action_planner',
      'verification_safety',
    ];

    for (const agentId of orderedIds) {
      const res = await executeAgent({
        ai,
        agentId,
        household: baseHousehold,
        priorOutputs,
        cityReports: sampleReports,
        roomImageBase64: agentId === 'indoor_air' ? 'AQID' : undefined,
        roomImageMimeType: agentId === 'indoor_air' ? 'image/png' : undefined,
        indoorNote: agentId === 'indoor_air' ? 'Kitchen near balcony' : undefined,
      });

      expect(res.status).toBe('completed');
      expect(res.agentId).toBe(agentId);
      expect(res.summary.length).toBeGreaterThan(0);

      if (agentId === 'env_intelligence') {
        expect(res.groundingLinks).toHaveLength(1);
        expect(res.groundingLinks[0].uri).toBe('https://cpcb.nic.in/aqi');
      }
      if (agentId === 'mobility_route') {
        expect(res.groundingType).toBe('googleMaps');
        expect(res.groundingLinks[0].uri).toContain('maps.google.com');
      }
      if (agentId === 'indoor_air') {
        expect(res.content).toContain('Plant Safety Note:');
        expect(res.confidence).toBe('medium');
      }
      if (agentId === 'verification_safety') {
        expect(res.verificationPassed).toBe(true);
      }

      priorOutputs[agentId] = {
        agentId: res.agentId,
        agentNumber: res.agentNumber,
        agentName: res.agentName,
        summary: res.summary,
        content: res.content,
      };
    }

    expect(calls).toHaveLength(8);
    // Agent 5 with roomImageBase64 must pass multimodal parts with inlineData
    const indoorCall = calls[4];
    expect(typeof indoorCall.contents).toBe('object');
  });

  it('flags diagnostic, dosing, guilt framing, and missing disclaimer in deterministic safety audit', () => {
    const unsafeAudit = runDeterministicSafetyAudit([
      {
        agentId: 'family_health',
        agentNumber: 3,
        agentName: 'Family Health Protection Agent',
        content: 'You have bronchitis and should double your inhaler. Being outdoors is smoking 8 cigarettes.',
      },
    ]);

    expect(unsafeAudit.verificationPassed).toBe(false);
    expect(unsafeAudit.warnings).toContain('Flagged potential diagnostic/dosing phrasing.');
    expect(unsafeAudit.warnings).toContain(
      'Flagged non-supportive guilt/cigarette comparison framing.',
    );
    expect(unsafeAudit.warnings).toContain('Added missing non-medical advisory disclaimer.');
  });
});
