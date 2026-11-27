import React, { useEffect, useRef, useState } from 'react';
import {
  PhoneCall,
  X,
  Volume2,
  MapPin,
  ExternalLink,
  ChevronRight,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { postJson } from '../lib/apiClient.ts';
import { sanitizeHttpUrl } from '../lib/deterministicEngines.ts';
import type { GroundingLink, HouseholdState } from '../types/breatheasy.ts';

interface Props {
  open: boolean;
  reason: string | null;
  household: HouseholdState;
  onClose: () => void;
}

const EMERGENCY_STEPS = [
  {
    title: 'Step 1 — Call Emergency Services Immediately If Severe Symptoms Exist',
    detail:
      'If anyone has severe difficulty breathing, chest pain, confusion, fainting, or bluish lips, call 112 or 102 immediately. Do not delay care for AI chat.',
  },
  {
    title: 'Step 2 — Move to the Cleanest Enclosed Indoor Space',
    detail:
      'Step indoors away from road traffic or smoke plumes. Sit upright calmly and loosen tight collars. Never stay in a sealed room with burning chulha, coal, or incense.',
  },
  {
    title: 'Step 3 — Follow Physician-Prescribed Rescue Plan & Seek Urgent Care',
    detail:
      'Use only your doctor-prescribed rescue inhaler or emergency plan if already prescribed. BreathEasy never diagnoses or adjusts medication doses.',
  },
];

export const EmergencyOverlay: React.FC<Props> = React.memo(function EmergencyOverlay({
  open,
  reason,
  household,
  onClose,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesSummary, setPlacesSummary] = useState<string | null>(null);
  const [placesLinks, setPlacesLinks] = useState<GroundingLink[]>([]);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const sanitizedContact = household.localEmergencyContact
    ? household.localEmergencyContact.replace(/[^0-9+\-\s]/g, '').trim()
    : '';

  const currentStep = EMERGENCY_STEPS[stepIndex];

  const speakCurrentStep = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(`${currentStep.title}. ${currentStep.detail}`);
    utter.lang =
      household.language === 'hi' ? 'hi-IN' : household.language === 'bn' ? 'bn-IN' : 'en-IN';
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  };

  const lookupNearbyCare = async () => {
    setLoadingPlaces(true);
    setPlacesError(null);
    try {
      const data = await postJson<
        { lat: number; lng: number; cityName: string },
        { summary?: string; places?: GroundingLink[] }
      >('/api/emergency/resources', {
        lat: household.city.lat,
        lng: household.city.lng,
        cityName: `${household.city.locality}, ${household.city.name}`,
      });
      setPlacesSummary(data.summary || null);
      setPlacesLinks(Array.isArray(data.places) ? data.places : []);
    } catch (err: unknown) {
      setPlacesError(
        err instanceof Error ? err.message : 'Unable to fetch nearby emergency hospitals.',
      );
    } finally {
      setLoadingPlaces(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-overlay-title"
      className="fixed inset-0 z-50 bg-[#0E1514]/95 text-[#F1F5F4] overflow-y-auto p-4 md:p-8 flex items-start justify-center"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-[#16201F] border-2 border-[#D97706] p-6 md:p-8 space-y-6 my-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-[#FBBF24] flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" /> Protective Emergency Playbook
            </div>
            <h2 id="emergency-overlay-title" className="font-display text-2xl md:text-3xl font-bold">
              Calm, High-Priority Action Mode
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
            aria-label="Exit Emergency Playbook"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {reason && (
          <div
            role="alert"
            className="rounded-xl bg-[#991B1B]/30 border border-[#F87171]/40 p-4 text-sm font-medium"
          >
            {reason}
          </div>
        )}

        {/* Primary Emergency Dial Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="tel:112"
            className="min-h-[58px] px-5 py-3 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-display text-lg font-bold flex items-center justify-center gap-2.5"
          >
            <PhoneCall className="w-5 h-5" aria-hidden="true" /> Call National Emergency 112
          </a>
          <a
            href="tel:102"
            className="min-h-[58px] px-5 py-3 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-display text-lg font-bold flex items-center justify-center gap-2.5"
          >
            <PhoneCall className="w-5 h-5" aria-hidden="true" /> Call Ambulance 102
          </a>
          {sanitizedContact && (
            <a
              href={`tel:${sanitizedContact}`}
              className="sm:col-span-2 min-h-[48px] px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] text-white font-display text-base font-bold flex items-center justify-center gap-2"
            >
              <PhoneCall className="w-4 h-4" aria-hidden="true" /> Call Saved Local Contact ({sanitizedContact})
            </a>
          )}
        </div>

        {/* One Primary Step at a Time */}
        <div
          aria-live="polite"
          className="rounded-2xl bg-[#0E1514] border border-[#283836] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono-tabular text-[#A7B8B5]">
              Action {stepIndex + 1} of {EMERGENCY_STEPS.length}
            </span>
            <button
              type="button"
              onClick={speakCurrentStep}
              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Volume2 className="w-4 h-4" aria-hidden="true" /> Voice Instructions
            </button>
          </div>
          <h3 className="font-display text-xl font-bold text-[#F1F5F4]">{currentStep.title}</h3>
          <p className="text-base leading-relaxed text-[#E2E8F0]">{currentStep.detail}</p>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              className="min-h-[42px] px-4 rounded-xl bg-white/10 disabled:opacity-35 text-xs font-semibold cursor-pointer"
            >
              Previous Step
            </button>
            <button
              type="button"
              onClick={() => setStepIndex((i) => (i + 1) % EMERGENCY_STEPS.length)}
              className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              Next Step <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Verified Google Maps Hospital / Pharmacy Lookup */}
        <div className="rounded-2xl bg-[#0E1514] border border-[#283836] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                Verified 24h Emergency Hospitals &amp; Pharmacies ({household.city.locality})
              </div>
              <p className="text-xs text-[#A7B8B5]">
                Only runs on request; your location is never shared externally without permission.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void lookupNearbyCare()}
              disabled={loadingPlaces}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {loadingPlaces ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Finding Care...
                </>
              ) : (
                <>
                  <MapPin className="w-4 h-4" aria-hidden="true" /> Find Verified ERs Nearby
                </>
              )}
            </button>
          </div>

          {placesError && (
            <p role="alert" className="text-xs text-[#F87171]">
              {placesError}
            </p>
          )}
          {placesSummary && (
            <div className="text-sm whitespace-pre-line text-[#E2E8F0] pt-2 border-t border-[#283836]">
              {placesSummary}
            </div>
          )}
          {placesLinks.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-1">
              {placesLinks.map((p) => {
                const safeHref = sanitizeHttpUrl(p.uri);
                if (!safeHref) return null;
                return (
                  <a
                    key={safeHref}
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#2DD4BF] hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> {p.title}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
