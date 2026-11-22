import React, { useState } from 'react';
import {
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
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { getCpcbVerdict } from '../lib/deterministicEngines.ts';
import type {
  AgentRunResult,
  GroundingLink,
  HouseholdState,
  SupportedLanguage,
} from '../types/breatheasy.ts';

interface Props {
  household: HouseholdState;
  agentOutputs: Partial<Record<string, AgentRunResult>>;
  personalizationEnabled: boolean;
  onTogglePersonalization: () => void;
  onResetPreferences: () => void;
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
    askPlaceholder: 'Ask calmly in English, Hindi, or Bengali — e.g. "Should my child play outside right now?"',
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
  safe: {
    badge: 'bg-[#0F766E]/10 text-[#0F766E] dark:bg-[#2DD4BF]/15 dark:text-[#2DD4BF]',
    accent: 'text-[#0F766E] dark:text-[#2DD4BF]',
  },
  caution: {
    badge: 'bg-[#D97706]/12 text-[#B45309] dark:bg-[#F59E0B]/15 dark:text-[#FBBF24]',
    accent: 'text-[#B45309] dark:text-[#FBBF24]',
  },
  avoid: {
    badge: 'bg-[#C2410C]/12 text-[#C2410C] dark:bg-[#FB923C]/15 dark:text-[#FB923C]',
    accent: 'text-[#C2410C] dark:text-[#FB923C]',
  },
  emergency: {
    badge: 'bg-[#991B1B]/12 text-[#991B1B] dark:bg-[#F87171]/15 dark:text-[#F87171]',
    accent: 'text-[#991B1B] dark:text-[#F87171]',
  },
};

export const ProtectionBriefView: React.FC<Props> = ({
  household,
  agentOutputs,
  personalizationEnabled,
  onTogglePersonalization,
  onResetPreferences,
  onEmergencyTrigger,
  onNavigateTab,
}) => {
  const verdict = getCpcbVerdict(household.city.baselinePm25);
  const tierStyle = TIER_STYLES[verdict.verdictTier];
  const copy = UI_COPY[household.language];

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [links, setLinks] = useState<GroundingLink[]>([]);
  const [listening, setListening] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState(false);

  const priorityOrder = [...household.members].sort((a, b) => {
    const rank = {
      infant: 0,
      respiratory_sensitive: 1,
      elderly: 2,
      child: 3,
      pet: 4,
      adult: 5,
    };
    return rank[a.category] - rank[b.category];
  });

  const handleAsk = async (promptText?: string) => {
    const q = (promptText ?? question).trim();
    if (!q || asking) return;
    setQuestion(q);
    setAsking(true);
    setAskError(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, household }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not reach Ask BreathEasy service.');
      }
      if (data.emergencyTriggered) {
        onEmergencyTrigger(data.answer);
        return;
      }
      setAnswer(data.answer);
      setLinks(Array.isArray(data.groundingLinks) ? data.groundingLinks : []);
    } catch (err: any) {
      setAskError(err?.message || 'Unable to answer right now.');
    } finally {
      setAsking(false);
    }
  };

  const handleVoiceListen = () => {
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      setListening(false);
      if (transcript) {
        handleAsk(transcript);
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
      <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 md:p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="text-xs font-medium tracking-wide uppercase text-[#4B5B59] dark:text-[#A7B8B5]">
              {household.city.locality}, {household.city.name} · {copy.briefLabel}
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-[#1A2423] dark:text-[#F1F5F4]">
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

        {/* Immediate Calm Takeaways + Action Shortcuts */}
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
              <Clock className="w-3.5 h-3.5" /> Today&apos;s Predictive Window
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
                className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#0F766E] hover:bg-[#0D625B] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                Open 8-Agent Pipeline
              </button>
              <button
                type="button"
                onClick={handleCopyBrief}
                className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] bg-[#FFFFFF] dark:bg-[#16201F] text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" />
                {copiedNotice ? 'Copied Brief' : copy.shareWhatsapp}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Ask BreathEasy (Voice + Search Grounded + Pre-LLM Emergency Safety Gate) */}
      <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]" />
              {copy.askHeading}
            </h2>
            <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
              Grounded with Google Search · Hard-coded respiratory distress safety gate outside LLM
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMemory((v) => !v)}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#E2DDD2] dark:border-[#283836] text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:bg-[#F0ECE3] dark:hover:bg-[#1E2B29]"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Memory Controls
          </button>
        </div>

        {/* Memory & Privacy Control Drawer */}
        {showMemory && (
          <div className="rounded-xl bg-[#F0ECE3] dark:bg-[#1E2B29] p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" />
                Local Privacy-First Memory ({personalizationEnabled ? 'Active' : 'Paused'})
              </div>
              <p className="text-[#4B5B59] dark:text-[#A7B8B5]">
                Stored locally in browser only: City ({household.city.name}), Language (
                {household.language.toUpperCase()}), Budget ({household.budgetTier}), School Run (
                {household.schoolTime}). No medical diagnoses stored.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onTogglePersonalization}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] font-medium cursor-pointer"
              >
                {personalizationEnabled ? 'Pause Personalization' : 'Enable Personalization'}
              </button>
              <button
                type="button"
                onClick={onResetPreferences}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] font-medium flex items-center gap-1 cursor-pointer text-[#C2410C]"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset Memory
              </button>
            </div>
          </div>
        )}

        {/* Quick Question Shortcuts */}
        <div className="flex flex-wrap gap-2">
          {copy.quickPrompts.map((qp) => (
            <button
              key={qp}
              type="button"
              onClick={() => handleAsk(qp)}
              disabled={asking}
              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#F0ECE3] dark:bg-[#1E2B29] hover:bg-[#E2DDD2] dark:hover:bg-[#283836] text-xs font-medium text-left transition-colors cursor-pointer disabled:opacity-60"
            >
              {qp}
            </button>
          ))}
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={copy.askPlaceholder}
            className="flex-1 min-h-[46px] px-4 rounded-xl border border-[#E2DDD2] dark:border-[#283836] bg-[#FAF7F2] dark:bg-[#0E1514] text-sm focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleVoiceListen}
              disabled={asking}
              className={`min-h-[46px] px-4 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                listening
                  ? 'bg-[#D97706] text-white border-[#D97706]'
                  : 'border-[#E2DDD2] dark:border-[#283836] bg-[#F0ECE3] dark:bg-[#1E2B29]'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {listening ? copy.stopListenLabel : copy.listenLabel}
            </button>
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="min-h-[46px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              {asking ? 'Thinking...' : 'Ask'}
            </button>
          </div>
        </form>

        {askError && (
          <div className="rounded-xl border border-[#C2410C]/40 bg-[#C2410C]/10 p-3 text-xs text-[#C2410C] dark:text-[#FB923C] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{askError}</span>
          </div>
        )}

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
                <Volume2 className="w-3.5 h-3.5" /> {copy.speakLabel}
              </button>
            </div>
            <div className="text-sm leading-relaxed whitespace-pre-line text-[#1A2423] dark:text-[#F1F5F4]">
              {answer}
            </div>
            {links.length > 0 && (
              <div className="pt-2 border-t border-[#E2DDD2] dark:border-[#283836] flex flex-wrap gap-2">
                {links.map((l) => (
                  <a
                    key={l.uri}
                    href={l.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#0F766E] dark:text-[#2DD4BF] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> {l.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Latest Synthesized Agent 7 Action Plan Preview (if run) */}
      {latestActionPlan && (
        <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">
              Synthesized Daily Plan (Agent 7)
            </h2>
            <button
              type="button"
              onClick={() => handleSpeak(latestActionPlan)}
              className="min-h-[36px] px-3 py-1 rounded-lg border border-[#E2DDD2] dark:border-[#283836] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5" /> {copy.speakLabel}
            </button>
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-line text-[#1A2423] dark:text-[#F1F5F4]">
            {latestActionPlan}
          </div>
        </section>
      )}
    </div>
  );
};
