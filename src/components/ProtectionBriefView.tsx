import React, { useMemo, useState } from 'react';
import {
  Bell,
  Mic,
  MicOff,
  Send,
  Volume2,
  Share2,
  ExternalLink,
  Clock,
  Shield,
  SlidersHorizontal,
  RotateCcw,
  Trash2,
  Sparkles,
  AlertCircle,
  TrendingUp,
  Compass,
  Database,
} from 'lucide-react';
import { postJson } from '../lib/apiClient.ts';
import {
  evaluateSmartAlert,
  getCpcbVerdict,
  getDailyJourneyStages,
  getDataSourceStatuses,
  getPredictiveHourlyOutlook,
  sanitizeHttpUrl,
} from '../lib/deterministicEngines.ts';
import type {
  AgentRunResult,
  GroundingLink,
  HouseholdState,
  SupportedLanguage,
} from '../types/breatheasy.ts';

interface SpeechRecognitionAlternativeLike {
  transcript?: string;
}

interface SpeechRecognitionEventLike {
  results?: ArrayLike<ArrayLike<SpeechRecognitionAlternativeLike>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition;
}

interface Props {
  household: HouseholdState;
  agentOutputs: Partial<Record<string, AgentRunResult>>;
  personalizationEnabled: boolean;
  onTogglePersonalization: () => void;
  onResetPreferences: () => void;
  onDeleteMemory: () => void;
  onUpdateHouseholdMeta: (
    patch: Partial<
      Pick<
        HouseholdState,
        | 'roomSqft'
        | 'housingType'
        | 'commuteMode'
        | 'schoolTime'
        | 'notificationStyle'
        | 'customBudgetInr'
        | 'localEmergencyContact'
      >
    >,
  ) => void;
  onEmergencyTrigger: (reason: string) => void;
  onNavigateTab: (tab: 'brief' | 'agents' | 'twin' | 'indoor') => void;
}

const UI_COPY: Record<
  SupportedLanguage,
  {
    briefLabel: string;
    askHeading: string;
    askPlaceholder: string;
    listenLabel: string;
    stopListenLabel: string;
    speakLabel: string;
    shareWhatsapp: string;
    vulnerableFirst: string;
    quickPrompts: string[];
  }
> = {
  en: {
    briefLabel: 'Observed Snapshot · Guidance Only',
    askHeading: 'Ask BreathEasy',
    askPlaceholder:
      'Ask calmly in English, Hindi, or Bengali — e.g. "Should my child play outside right now?"',
    listenLabel: 'Voice Ask',
    stopListenLabel: 'Listening...',
    speakLabel: 'Read Aloud',
    shareWhatsapp: 'Share Family Brief',
    vulnerableFirst: 'Household Priority Order',
    quickPrompts: [
      'Should my child play outside right now?',
      'Is my bedroom safer than outside?',
      'Find the least polluted way to get to school.',
      'Tell me what I can do without spending money.',
      'Why is the air getting worse?',
      'Compare my current route with another route.',
    ],
  },
  hi: {
    briefLabel: 'वर्तमान स्नैपशॉट · केवल मार्गदर्शन',
    askHeading: 'BreathEasy से पूछें',
    askPlaceholder: 'आराम से पूछें — जैसे "क्या मेरा बच्चा अभी बाहर खेल सकता है?"',
    listenLabel: 'बोलकर पूछें',
    stopListenLabel: 'सुन रहा हूँ...',
    speakLabel: 'सुनें',
    shareWhatsapp: 'परिवार को भेजें',
    vulnerableFirst: 'परिवार सुरक्षा प्राथमिकता',
    quickPrompts: [
      'क्या मेरा बच्चा अभी बाहर खेल सकता है?',
      'क्या मेरा बेडरूम बाहर से ज्यादा सुरक्षित है?',
      'स्कूल जाने का सबसे कम प्रदूषित रास्ता बताएं।',
      'बिना पैसे खर्च किए मैं क्या कर सकता हूँ?',
      'हवा अभी क्यों खराब हो रही है?',
      'मेरे मौजूदा रास्ते की दूसरे रास्ते से तुलना करें।',
    ],
  },
  bn: {
    briefLabel: 'বর্তমান পরিস্থিতি · শুধুমাত্র নির্দেশিকা',
    askHeading: 'BreathEasy-কে জিজ্ঞাসা করুন',
    askPlaceholder: 'সহজভাবে জিজ্ঞাসা করুন — যেমন "আমার সন্তান কি এখন বাইরে খেলতে পারে?"',
    listenLabel: 'ভয়েসে জিজ্ঞাসা',
    stopListenLabel: 'শুনছি...',
    speakLabel: 'শুনুন',
    shareWhatsapp: 'পরিবারকে জানান',
    vulnerableFirst: 'পরিবার সুরক্ষা অগ্রাধিকার',
    quickPrompts: [
      'আমার সন্তান কি এখন বাইরে খেলতে পারে?',
      'আমার শোবার ঘর কি বাইরের চেয়ে নিরাপদ?',
      'স্কুলে যাওয়ার সবচেয়ে কম দূষিত পথ বলুন।',
      'টাকা খরচ না করে আমি কী করতে পারি?',
      'বাতাস এখন খারাপ হচ্ছে কেন?',
      'আমার বর্তমান রুটের সাথে অন্য রুটের তুলনা করুন।',
    ],
  },
};

const TIER_STYLES = {
  safe: { badge: 'bg-[#0F766E]/10 text-[#0F766E] dark:bg-[#2DD4BF]/15 dark:text-[#2DD4BF]' },
  caution: { badge: 'bg-[#D97706]/12 text-[#B45309] dark:bg-[#F59E0B]/15 dark:text-[#FBBF24]' },
  avoid: { badge: 'bg-[#C2410C]/12 text-[#C2410C] dark:bg-[#FB923C]/15 dark:text-[#FB923C]' },
  emergency: { badge: 'bg-[#991B1B]/12 text-[#991B1B] dark:bg-[#F87171]/15 dark:text-[#F87171]' },
};

const PRIORITY_RANK: Record<HouseholdState['members'][number]['category'], number> = {
  infant: 0,
  respiratory_sensitive: 1,
  elderly: 2,
  child: 3,
  pet: 4,
  adult: 5,
};

export const ProtectionBriefView: React.FC<Props> = React.memo(
  ({
    household,
    agentOutputs,
    personalizationEnabled,
    onTogglePersonalization,
    onResetPreferences,
    onDeleteMemory,
    onUpdateHouseholdMeta,
    onEmergencyTrigger,
    onNavigateTab,
  }) => {
    const verdict = useMemo(
      () => getCpcbVerdict(household.city.baselinePm25),
      [household.city.baselinePm25],
    );
    const tierStyle = TIER_STYLES[verdict.verdictTier];
    const copy = UI_COPY[household.language];
    const predictive = useMemo(() => getPredictiveHourlyOutlook(household.city), [household.city]);
    const smartAlert = useMemo(
      () =>
        evaluateSmartAlert({
          city: household.city,
          notificationStyle: household.notificationStyle,
        }),
      [household.city, household.notificationStyle],
    );
    const dataSources = useMemo(
      () => getDataSourceStatuses(household.city, predictive.horizons[0]?.timestampIso),
      [household.city, predictive.horizons],
    );
    const journey = useMemo(
      () => getDailyJourneyStages(household.city, household.commuteMode, household.schoolTime),
      [household.city, household.commuteMode, household.schoolTime],
    );
    const priorityOrder = useMemo(
      () =>
        [...household.members].sort(
          (a, b) => PRIORITY_RANK[a.category] - PRIORITY_RANK[b.category],
        ),
      [household.members],
    );
    const updatedLabel = useMemo(() => {
      const iso = predictive.horizons[0]?.timestampIso;
      return iso
        ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Now';
    }, [predictive]);

    const [question, setQuestion] = useState('');
    const [asking, setAsking] = useState(false);
    const [askError, setAskError] = useState<string | null>(null);
    const [answer, setAnswer] = useState<string | null>(null);
    const [links, setLinks] = useState<GroundingLink[]>([]);
    const [listening, setListening] = useState(false);
    const [showMemory, setShowMemory] = useState(false);
    const [showSources, setShowSources] = useState(false);
    const [copiedNotice, setCopiedNotice] = useState(false);

    const handleAsk = async (promptText?: string) => {
      const q = (promptText ?? question).trim();
      if (!q || asking) return;
      setQuestion(q);
      setAsking(true);
      setAskError(null);
      try {
        const data = await postJson<
          { question: string; household: HouseholdState },
          { emergencyTriggered?: boolean; answer?: string; groundingLinks?: GroundingLink[] }
        >('/api/ask', { question: q, household });

        if (data.emergencyTriggered) {
          onEmergencyTrigger(
            data.answer ||
              'Emergency signals detected. Please contact 112 or 102 immediately.',
          );
          return;
        }
        setAnswer(data.answer || '');
        setLinks(Array.isArray(data.groundingLinks) ? data.groundingLinks : []);
      } catch (err: unknown) {
        setAskError(err instanceof Error ? err.message : 'Unable to answer right now.');
      } finally {
        setAsking(false);
      }
    };

    const handleVoiceListen = () => {
      const SpeechRec = getSpeechRecognitionConstructor();
      if (!SpeechRec) {
        setAskError('Voice input is not supported in this browser; please type your question.');
        return;
      }
      const recognition = new SpeechRec();
      recognition.lang =
        household.language === 'hi' ? 'hi-IN' : household.language === 'bn' ? 'bn-IN' : 'en-IN';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setListening(true);
      setAskError(null);
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = event?.results?.[0]?.[0]?.transcript || '';
        setListening(false);
        if (transcript) {
          void handleAsk(transcript);
        }
      };
      recognition.onerror = () => {
        setListening(false);
        setAskError('Microphone permission unavailable or voice capture timed out.');
      };
      recognition.onend = () => setListening(false);
      recognition.start();
    };

    const handleSpeak = (text: string) => {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang =
        household.language === 'hi' ? 'hi-IN' : household.language === 'bn' ? 'bn-IN' : 'en-IN';
      utter.rate = 0.96;
      window.speechSynthesis.speak(utter);
    };

    const handleCopyBrief = async () => {
      const shareText = `BreathEasy Family Brief — ${household.city.locality}, ${household.city.name}
Status: ${verdict.category} (PM2.5 ~${household.city.baselinePm25} µg/m³, CPCB approx AQI ${verdict.aqiApprox})
Guidance: ${verdict.humanHeadline}
Priority: ${priorityOrder
        .filter((m) => !m.privacyMasked)
        .map((m) => m.label)
        .join(', ')}
(Note: Guidance only, not medical advice.)`;

      try {
        await navigator.clipboard.writeText(shareText);
        setCopiedNotice(true);
        setTimeout(() => setCopiedNotice(false), 2600);
      } catch {
        setAskError('Clipboard copy was blocked; you can select and copy text manually.');
      }
    };

    const latestActionPlan = agentOutputs.action_planner?.content;

    return (
      <div className="space-y-6">
        {/* Hero 5-Second Protection Verdict Card */}
        <section
          aria-labelledby="brief-hero-heading"
          className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 md:p-8 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 max-w-2xl">
              <div className="text-xs font-medium tracking-wide uppercase text-[#4B5B59] dark:text-[#A7B8B5]">
                {household.city.locality}, {household.city.name} · {copy.briefLabel}
              </div>
              <h1
                id="brief-hero-heading"
                className="font-display text-2xl md:text-3xl font-bold tracking-tight text-[#1A2423] dark:text-[#F1F5F4]"
              >
                {verdict.humanHeadline}
              </h1>
              <p className="text-sm text-[#4B5B59] dark:text-[#A7B8B5]">
                Wind {household.city.windKmh} km/h · Temp {household.city.tempC}°C · RH{' '}
                {household.city.humidityPct}% · Commute anchor {household.schoolTime}
              </p>
            </div>

            <div className="flex flex-col items-start md:items-end gap-2">
              <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${tierStyle.badge}`}>
                CPCB {verdict.category} · Approx AQI {verdict.aqiApprox}
              </span>
              <div className="font-mono-tabular text-2xl font-bold text-[#1A2423] dark:text-[#F1F5F4]">
                {household.city.baselinePm25}{' '}
                <span className="text-sm font-normal text-[#4B5B59] dark:text-[#A7B8B5]">
                  µg/m³ PM2.5
                </span>
              </div>
              <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] tabular-nums">
                PM10 ~{household.city.baselinePm10} · NO₂ ~{household.city.baselineNo2} µg/m³
              </div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[#E2DDD2] dark:border-[#283836] grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl bg-[#F0ECE3]/70 dark:bg-[#1E2B29] p-4">
              <div className="text-xs font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                {copy.vulnerableFirst}
              </div>
              <div className="mt-1.5 text-sm font-medium text-[#1A2423] dark:text-[#F1F5F4]">
                {priorityOrder.slice(0, 3).map((m) => m.label).join(' → ')}
              </div>
              <p className="mt-1 text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                High-protection members prioritized calmly without alarmist framing.
              </p>
            </div>

            <div className="rounded-xl bg-[#F0ECE3]/70 dark:bg-[#1E2B29] p-4">
              <div className="text-xs font-semibold text-[#0F766E] dark:text-[#2DD4BF] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Today&apos;s Predictive Window
              </div>
              <div className="mt-1.5 text-sm font-medium text-[#1A2423] dark:text-[#F1F5F4]">
                {household.city.windKmh < 5
                  ? 'Low-wind inversion likely after 18:00 · Prefer 13:00–15:30 errands'
                  : 'Better dispersion midday · Keep morning N95 ready near roads'}
              </div>
              <p className="mt-1 text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                Run Agent 2 &amp; Agent 4 for live Search/Maps verification.
              </p>
            </div>

            <div className="rounded-xl bg-[#F0ECE3]/70 dark:bg-[#1E2B29] p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                  Multi-Agent &amp; Safe Room Ready
                </div>
                <p className="mt-1 text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                  {latestActionPlan
                    ? 'Agent 7 Action Plan synced below.'
                    : 'Execute all 8 BreathEasy agents one-by-one or inspect your 3D Digital Twin.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('agents')}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#0F766E] hover:bg-[#0D625B] text-white text-xs font-semibold cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F766E]"
                >
                  Open 8-Agent Pipeline
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyBrief()}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#16201F] text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                  {copiedNotice ? 'Copied Brief' : copy.shareWhatsapp}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Predictive Pollution & Risk Intelligence Strip */}
        <section
          aria-labelledby="predictive-outlook-heading"
          className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="predictive-outlook-heading"
                className="font-display text-lg font-bold flex items-center gap-2"
              >
                <TrendingUp
                  className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]"
                  aria-hidden="true"
                />
                Predictive Risk Intelligence (Observed vs. 1h–24h Modeled Outlook)
              </h2>
              <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] mt-0.5">
                {predictive.advisory}
              </p>
            </div>
            <span className="text-xs font-mono-tabular text-[#4B5B59] dark:text-[#A7B8B5]">
              Updated {updatedLabel}
            </span>
          </div>

          {predictive.insufficientData ? (
            <p className="text-xs text-[#B45309] dark:text-[#FBBF24]">{predictive.advisory}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {predictive.horizons.map((h) => (
                <div
                  key={h.horizonLabel}
                  className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-1 text-[11px] font-semibold">
                    <span className={h.isObserved ? 'text-[#0F766E] dark:text-[#2DD4BF]' : ''}>
                      {h.horizonLabel}
                    </span>
                    <span className="uppercase text-[#4B5B59] dark:text-[#A7B8B5]">
                      {h.isObserved ? 'Observed' : `${h.confidence} conf`}
                    </span>
                  </div>
                  <div className="font-mono-tabular text-base font-bold">
                    {h.pm25Range[0] === h.pm25Range[1]
                      ? `${h.pm25Range[0]} µg/m³`
                      : `${h.pm25Range[0]}–${h.pm25Range[1]} µg/m³`}
                  </div>
                  <p className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5] leading-snug">
                    {h.driver}
                  </p>
                  <div className="text-[11px] font-medium text-[#4B5B59] dark:text-[#A7B8B5]">
                    Inversion: {h.inversionRisk}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Smart Alert Intelligence + Data Source Transparency */}
          <div className="pt-3 border-t border-[#E2DDD2] dark:border-[#283836] space-y-3">
            <div className="rounded-xl bg-[#F0ECE3]/75 dark:bg-[#1E2B29] p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1 text-xs">
                <div className="font-semibold flex items-center gap-1.5 text-[#0F766E] dark:text-[#2DD4BF]">
                  <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                  Smart Alert Intelligence ·{' '}
                  {smartAlert.shouldNotify
                    ? `Active (${smartAlert.confidence} confidence)`
                    : 'Suppressed (Anti-Spam)'}
                </div>
                <p className="text-[#1A2423] dark:text-[#F1F5F4]">
                  <strong>What changed:</strong> {smartAlert.whatChanged}{' '}
                  <strong>Why it matters:</strong> {smartAlert.whyItMatters}
                </p>
                <p className="text-[#4B5B59] dark:text-[#A7B8B5]">
                  <strong>Do this now:</strong> {smartAlert.doThisNow}
                  {smartAlert.suppressedReason ? ` (${smartAlert.suppressedReason})` : ''}
                </p>
              </div>
              <button
                type="button"
                aria-expanded={showSources}
                onClick={() => setShowSources((v) => !v)}
                className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#16201F] text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Database className="w-3.5 h-3.5" aria-hidden="true" />
                {showSources ? 'Hide Data Sources' : 'Data Sources & Fallbacks'}
              </button>
            </div>

            {showSources && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                {dataSources.map((src) => (
                  <div
                    key={src.source}
                    className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>{src.source}</span>
                      <span className="uppercase text-[11px] text-[#0F766E] dark:text-[#2DD4BF]">
                        {src.stale ? 'Stale' : `${src.reliability} rel`}
                      </span>
                    </div>
                    <p className="text-[#4B5B59] dark:text-[#A7B8B5]">
                      {src.data} · {src.frequency}
                    </p>
                    <p className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5]">
                      Fallback: {src.fallbackAction}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Ask BreathEasy + Adaptive Memory Controls */}
        <section
          aria-labelledby="ask-breatheasy-heading"
          className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id="ask-breatheasy-heading"
                className="font-display text-lg font-bold flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]" aria-hidden="true" />
                {copy.askHeading}
              </h2>
              <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                Grounded with Google Search · Hard-coded respiratory distress safety gate outside LLM
              </p>
            </div>
            <button
              type="button"
              aria-expanded={showMemory}
              onClick={() => setShowMemory((v) => !v)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:bg-[#F0ECE3] dark:hover:bg-[#1E2B29]"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              Memory &amp; Home Settings
            </button>
          </div>

          {showMemory && (
            <div className="rounded-xl bg-[#F0ECE3] dark:bg-[#1E2B29] p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Shield
                      className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]"
                      aria-hidden="true"
                    />
                    Privacy-First Adaptive Memory ({personalizationEnabled ? 'Active' : 'Paused'})
                  </div>
                  <p className="text-[#4B5B59] dark:text-[#A7B8B5]">
                    City ({household.city.name}), Language ({household.language.toUpperCase()}),
                    Budget ({household.budgetTier}), School Run ({household.schoolTime}). No medical
                    diagnoses stored.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={!personalizationEnabled}
                    onClick={onTogglePersonalization}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] font-medium cursor-pointer"
                  >
                    {personalizationEnabled ? 'Pause Personalization' : 'Enable Personalization'}
                  </button>
                  <button
                    type="button"
                    onClick={onResetPreferences}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset Defaults
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteMemory}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] font-medium flex items-center gap-1 cursor-pointer text-[#C2410C]"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete Memory
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-[#E2DDD2] dark:border-[#283836] flex flex-wrap gap-4 items-center">
                <label className="inline-flex items-center gap-2 font-medium">
                  Safe Room Size (sq ft):
                  <input
                    type="number"
                    min={40}
                    max={5000}
                    value={household.roomSqft}
                    onChange={(e) => {
                      const val = Math.min(5000, Math.max(40, Number(e.target.value) || 140));
                      onUpdateHouseholdMeta({ roomSqft: val });
                    }}
                    className="w-20 min-h-[34px] px-2 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] font-mono-tabular"
                  />
                </label>

                <label className="inline-flex items-center gap-2 font-medium">
                  Housing Type:
                  <select
                    value={household.housingType}
                    onChange={(e) =>
                      onUpdateHouseholdMeta({
                        housingType: e.target.value as HouseholdState['housingType'],
                      })
                    }
                    className="min-h-[34px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514]"
                  >
                    <option value="independent_flat">Independent Flat</option>
                    <option value="high_rise">High-Rise Apartment</option>
                    <option value="ground_floor_roadside">Ground-Floor Roadside</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-2 font-medium">
                  Commute Mode:
                  <select
                    value={household.commuteMode}
                    onChange={(e) =>
                      onUpdateHouseholdMeta({
                        commuteMode: e.target.value as HouseholdState['commuteMode'],
                      })
                    }
                    className="min-h-[34px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514]"
                  >
                    <option value="auto_rickshaw">Open Auto-Rickshaw</option>
                    <option value="metro">Metro / Enclosed Transit</option>
                    <option value="car_ac">Car (Recirculated AC)</option>
                    <option value="walk">Walking</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-2 font-medium">
                  Activity / School Time:
                  <input
                    type="text"
                    maxLength={20}
                    value={household.schoolTime}
                    onChange={(e) => onUpdateHouseholdMeta({ schoolTime: e.target.value })}
                    className="w-24 min-h-[34px] px-2 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514] font-mono-tabular"
                  />
                </label>

                <label className="inline-flex items-center gap-2 font-medium">
                  Alert Style:
                  <select
                    value={household.notificationStyle ?? 'calm_essential'}
                    onChange={(e) =>
                      onUpdateHouseholdMeta({
                        notificationStyle: e.target.value as HouseholdState['notificationStyle'],
                      })
                    }
                    className="min-h-[34px] px-2.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514]"
                  >
                    <option value="calm_essential">Calm Essential Only (45m cooldown)</option>
                    <option value="detailed_shifts">Detailed Shifts (20m cooldown)</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-2 font-medium">
                  Local Emergency Contact:
                  <input
                    type="tel"
                    maxLength={24}
                    placeholder="Optional doctor/family #"
                    value={household.localEmergencyContact ?? ''}
                    onChange={(e) =>
                      onUpdateHouseholdMeta({ localEmergencyContact: e.target.value })
                    }
                    className="w-40 min-h-[34px] px-2 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#0E1514]"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {copy.quickPrompts.map((qp) => (
              <button
                key={qp}
                type="button"
                onClick={() => void handleAsk(qp)}
                disabled={asking}
                className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#F0ECE3] dark:bg-[#1E2B29] hover:bg-[#E2DDD2] dark:hover:bg-[#283836] text-xs font-medium text-left transition-colors cursor-pointer disabled:opacity-60"
              >
                {qp}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAsk();
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <label htmlFor="ask-breatheasy-input" className="sr-only">
              {copy.askHeading}
            </label>
            <input
              id="ask-breatheasy-input"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={copy.askPlaceholder}
              className="flex-1 min-h-[46px] px-4 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={listening}
                onClick={handleVoiceListen}
                disabled={asking}
                className={`min-h-[46px] px-4 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  listening
                    ? 'bg-[#D97706] text-white border-[#D97706]'
                    : 'border-[#E2DDD2] dark:border-[#283836] bg-[#F0ECE3] dark:bg-[#1E2B29]'
                }`}
              >
                {listening ? (
                  <MicOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Mic className="w-4 h-4" aria-hidden="true" />
                )}
                {listening ? copy.stopListenLabel : copy.listenLabel}
              </button>
              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="min-h-[46px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                {asking ? 'Thinking...' : 'Ask'}
              </button>
            </div>
          </form>

          {askError && (
            <div
              role="alert"
              className="rounded-xl border border-[#C2410C]/40 bg-[#C2410C]/10 p-3 text-xs text-[#C2410C] dark:text-[#FB923C] flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{askError}</span>
            </div>
          )}

          <div aria-live="polite">
            {answer && (
              <div className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                    BreathEasy Guidance
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSpeak(answer)}
                    className="min-h-[36px] px-2.5 py-1 rounded-lg border border-[#E2DDD2] dark:border-[#283836] text-xs font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" /> {copy.speakLabel}
                  </button>
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-line text-[#1A2423] dark:text-[#F1F5F4]">
                  {answer}
                </div>
                {links.length > 0 && (
                  <div className="pt-2 border-t border-[#E2DDD2] dark:border-[#283836] flex flex-wrap gap-2">
                    {links.map((l) => {
                      const safeHref = sanitizeHttpUrl(l.uri);
                      if (!safeHref) return null;
                      return (
                        <a
                          key={safeHref}
                          href={safeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#0F766E] dark:text-[#2DD4BF] hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" aria-hidden="true" /> {l.title}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Calm Daily Journey & Behavioral Nudges */}
        <section
          aria-labelledby="daily-journey-heading"
          className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-4"
        >
          <div>
            <h2
              id="daily-journey-heading"
              className="font-display text-lg font-bold flex items-center gap-2"
            >
              <Compass className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]" aria-hidden="true" />
              Calm Daily Protection Journey &amp; Behavioral Nudges
            </h2>
            <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
              Supportive routine steps tailored for {household.city.name} — zero guilt or fear framing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {journey.map((stage) => (
              <article
                key={stage.id}
                className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-4 space-y-2"
              >
                <div className="text-[11px] font-mono-tabular font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                  {stage.windowLabel}
                </div>
                <h3 className="font-display text-sm font-bold">{stage.title}</h3>
                <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] leading-relaxed">
                  {stage.nudge}
                </p>
                <div className="pt-1 text-[11px] font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                  {stage.exposureBenefit}
                </div>
              </article>
            ))}
          </div>
        </section>

        {latestActionPlan && (
          <section
            aria-labelledby="synthesized-plan-heading"
            className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="synthesized-plan-heading" className="font-display text-lg font-bold">
                Synthesized Daily Plan (Agent 7)
              </h2>
              <button
                type="button"
                onClick={() => handleSpeak(latestActionPlan)}
                className="min-h-[36px] px-3 py-1 rounded-lg border border-[#E2DDD2] dark:border-[#283836] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" aria-hidden="true" /> {copy.speakLabel}
              </button>
            </div>
            <div className="text-sm leading-relaxed whitespace-pre-line text-[#1A2423] dark:text-[#F1F5F4]">
              {latestActionPlan}
            </div>
          </section>
        )}
      </div>
    );
  },
);
ProtectionBriefView.displayName = 'ProtectionBriefView';
