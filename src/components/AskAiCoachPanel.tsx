import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Atom,
  BrainCircuit,
  Loader2,
  Send,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  DockingTelemetry,
  NasaMissionFeed,
  OutpostTelemetry,
  SimulationRunRecord,
} from '../types/mission';
import { voiceGuide, type CoachVoiceMode, type VoiceSpeaker } from '../services/voiceGuide';

export type CoachMode = 'general' | 'docking' | 'lunar_outpost' | 'mars_outpost';

interface ChatMessage {
  id: string;
  role: 'kid' | 'coach';
  speaker?: 'maya' | 'leo' | 'sam';
  text: string;
  scienceConcept?: string;
  actionTip?: string;
}

interface AskAiCoachPanelProps {
  callsign: string;
  mode: CoachMode;
  telemetry?: DockingTelemetry | OutpostTelemetry | null;
  nasaFeed?: NasaMissionFeed | null;
  runs?: SimulationRunRecord[];
  variant?: 'embedded' | 'drawer';
  onClose?: () => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
}

const VOICE_OPTIONS: Array<{ id: CoachVoiceMode; label: string; tag: string; sample: string; speaker: VoiceSpeaker }> = [
  {
    id: 'duo',
    label: 'Duo',
    tag: 'M+F',
    speaker: 'maya',
    sample: 'Team Duo active! Commander Maya and Pilot Leo will both teach you in space!',
  },
  {
    id: 'maya',
    label: 'Maya',
    tag: 'F',
    speaker: 'maya',
    sample: 'Hi Cadet! I am Commander Maya. Ask me anything about flying or space science!',
  },
  {
    id: 'leo',
    label: 'Leo',
    tag: 'M',
    speaker: 'leo',
    sample: 'Hey Cadet! Pilot Leo here! Ready to explore thrusters, gravity, and orbits?',
  },
  {
    id: 'sam',
    label: 'Sam',
    tag: 'M',
    speaker: 'sam',
    sample: 'Flight Director Sam standing by! Ask about power shields, emergencies, or NASA weather.',
  },
];

export const AskAiCoachPanel: React.FC<AskAiCoachPanelProps> = ({
  callsign,
  mode,
  telemetry = null,
  nasaFeed = null,
  runs = [],
  variant = 'embedded',
  onClose,
  voiceEnabled: controlledVoiceEnabled,
  onToggleVoice,
}) => {
  const [localVoice, setLocalVoice] = useState<boolean>(voiceGuide.isEnabled());
  const [coachVoice, setCoachVoice] = useState<CoachVoiceMode>(() => voiceGuide.getCoachVoiceMode());
  const voiceOn = controlledVoiceEnabled ?? localVoice;

  const welcomeMessage = useMemo(() => {
    if (mode === 'docking') {
      const dock = telemetry as DockingTelemetry | null;
      if (dock?.activeDrills?.length) {
        return `Hi ${callsign}! I see a space alert on your ship right now. Ask us what button to tap or pick a question below!`;
      }
      return `Hi ${callsign}! Your AI Coaches Maya and Leo are watching your Space Shuttle radar. Ask about controls OR why spaceships glide in zero gravity!`;
    }
    if (mode === 'lunar_outpost' || mode === 'mars_outpost') {
      const world = mode === 'mars_outpost' ? 'Mars Base' : 'Moon Base';
      return `Hi ${callsign}! Your AI Coaches are watching your ${world} sensors. Ask about power trade-offs, oxygen science, or real Mars weather!`;
    }
    return `Hi ${callsign}! Pick Maya (Female), Leo (Male), Sam (Male), or Team Duo below, and ask anything about missions or space physics!`;
  }, [callsign, mode, telemetry]);

  const defaultQuickQuestions = useMemo(() => {
    if (mode === 'docking') {
      const dock = telemetry as DockingTelemetry | null;
      if (dock?.activeDrills?.length) {
        return [
          'What should I do for this alert?',
          'Why does a stuck jet push me sideways?',
          'How do I dock gently?',
        ];
      }
      return [
        'Why does my shuttle keep gliding after W?',
        'How do thrusters push in empty space?',
        'Why do astronauts dock so slowly?',
      ];
    }
    if (mode === 'lunar_outpost' || mode === 'mars_outpost') {
      const outpost = telemetry as OutpostTelemetry | null;
      if (outpost?.activeDrills?.length) {
        return [
          'How do I fix this emergency alert?',
          'How do Storm Shelters block solar rays?',
          'What is NASA seeing in space today?',
        ];
      }
      return [
        'How does Air Maker turn water into oxygen?',
        'Why is Mars air so thin and cold?',
        'How do plants help our crew breathe?',
      ];
    }
    return [
      'Why do spaceships keep drifting in space?',
      'How do thrusters steer without air?',
      'How does Air Maker keep oxygen safe?',
      'What is NASA seeing in space today?',
    ];
  }, [mode, telemetry]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'coach',
      speaker: 'maya',
      text: welcomeMessage,
      scienceConcept: 'In zero gravity, objects keep moving smoothly until an opposite force pushes them!',
      actionTip: 'Switch voices above or tap any physics or mission question below!',
    },
  ]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(defaultQuickQuestions);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const activeFetchRef = useRef<AbortController | null>(null);

  useEffect(() => {
    voiceGuide.setCoachPanelActive(true);
    return () => {
      voiceGuide.setCoachPanelActive(false);
      activeFetchRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === 'welcome') {
        return [
          {
            id: 'welcome',
            role: 'coach',
            speaker: coachVoice === 'leo' ? 'leo' : coachVoice === 'sam' ? 'sam' : 'maya',
            text: welcomeMessage,
            scienceConcept: prev[0].scienceConcept,
            actionTip: prev[0].actionTip,
          },
        ];
      }
      return prev;
    });
  }, [welcomeMessage, coachVoice]);

  useEffect(() => {
    if (messages.length === 1) {
      setSuggestedQuestions(defaultQuickQuestions);
    }
  }, [defaultQuickQuestions, messages.length]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading]);

  const handleSelectCoachVoice = (opt: (typeof VOICE_OPTIONS)[number]) => {
    voiceGuide.primeSpeech();
    setCoachVoice(opt.id);
    voiceGuide.setCoachVoiceMode(opt.id);
    if (!voiceGuide.isEnabled()) {
      voiceGuide.setEnabled(true);
      setLocalVoice(true);
    }
    voiceGuide.speak(opt.sample, {
      priority: true,
      isCoachReply: true,
      speaker: opt.speaker,
      useNeuralTts: true,
    });
  };

  const handleToggleVoice = () => {
    voiceGuide.primeSpeech();
    if (onToggleVoice) {
      onToggleVoice();
      return;
    }
    const next = !localVoice;
    voiceGuide.setEnabled(next);
    setLocalVoice(next);
    if (next) {
      voiceGuide.speak('Multi-gender AI Coach voice turned on! Ask me any mission or space science question.', {
        priority: true,
        isCoachReply: true,
        speaker: voiceGuide.resolveCoachSpeaker(),
        useNeuralTts: true,
      });
    }
  };

  const speakMessage = (msg: ChatMessage) => {
    voiceGuide.primeSpeech();
    if (!voiceGuide.isEnabled()) {
      voiceGuide.setEnabled(true);
      setLocalVoice(true);
    }
    const speaker = msg.speaker || voiceGuide.resolveCoachSpeaker();
    voiceGuide.speak(msg.text, {
      priority: true,
      isCoachReply: true,
      speaker,
      useNeuralTts: true,
    });
  };

  const askCoach = async (rawQuestion: string) => {
    const clean = rawQuestion.trim();
    if (!clean) return;

    // Synchronously unlock mobile speech & audio inside the tap/submit gesture before async fetch
    voiceGuide.primeSpeech();
    if (voiceGuide.isSpeaking()) {
      voiceGuide.stop();
    }

    activeFetchRef.current?.abort();
    const controller = new AbortController();
    activeFetchRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 11000);

    const kidMsg: ChatMessage = {
      id: `kid-${Date.now()}`,
      role: 'kid',
      text: clean,
    };

    const nextHistory = [...messages.filter((m) => m.id !== 'welcome'), kidMsg].slice(-8);
    setMessages((prev) => [...prev, kidMsg]);
    setInput('');
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/coach/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          callsign,
          question: clean,
          mode,
          coachVoice,
          history: nextHistory.map((m) => ({ role: m.role, speaker: m.speaker, text: m.text })),
          telemetry,
          nasaFeed,
          runs,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI Flight Coach could not answer right now.');
      }

      if (controller.signal.aborted) return;

      const coachText = String(data.reply || '').trim();
      const scienceConcept = data.scienceConcept ? String(data.scienceConcept).trim() : undefined;
      const actionTip = data.actionTip ? String(data.actionTip).trim() : undefined;
      const speaker: 'maya' | 'leo' | 'sam' =
        data.speaker === 'leo' || data.speaker === 'sam' ? data.speaker : 'maya';

      const coachMsg: ChatMessage = {
        id: `coach-${Date.now()}`,
        role: 'coach',
        speaker,
        text: coachText,
        scienceConcept,
        actionTip,
      };

      setMessages((prev) => [...prev, coachMsg]);
      if (Array.isArray(data.suggestedQuestions) && data.suggestedQuestions.length > 0) {
        setSuggestedQuestions(data.suggestedQuestions.slice(0, 3));
      }

      if (voiceOn && coachText) {
        // Speak crisp direct reply so speech never stalls or breaks up across long chained paragraphs
        voiceGuide.speak(coachText, {
          priority: true,
          isCoachReply: true,
          speaker,
          useNeuralTts: true,
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError' && activeFetchRef.current !== controller) {
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Unable to reach AI Flight Coach.');
    } finally {
      window.clearTimeout(timeoutId);
      if (activeFetchRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    askCoach(input);
  };

  const isDrawer = variant === 'drawer';

  return (
    <div
      className={`bg-[#0B0E17] border border-cyan-500/40 flex flex-col ${
        isDrawer ? 'w-[min(430px,92vw)] shadow-2xl' : 'w-full h-full'
      }`}
    >
      {/* Header + Multi-Gender Coach Voice Switcher */}
      <div className="px-4 py-3 border-b border-slate-800 space-y-2.5 bg-[#07090E]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrainCircuit className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-100 truncate">AI Flight & Physics Coach</h2>
              <p className="text-[11px] text-slate-400 truncate">
                {mode === 'docking'
                  ? 'Live Shuttle radar + orbital physics'
                  : mode === 'mars_outpost'
                  ? 'Live Mars Base + atmosphere science'
                  : mode === 'lunar_outpost'
                  ? 'Live Moon Base + solar radiation science'
                  : 'Ask about controls or real space science'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleVoice}
              className={`px-2.5 py-1.5 text-xs font-medium border flex items-center gap-1 whitespace-nowrap ${
                voiceOn
                  ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
              title="Toggle Voice Readout"
            >
              {voiceOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{voiceOn ? 'Voice On' : 'Voice Off'}</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close AI Coach"
                className="p-1.5 border border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Multi-Gender Voice Persona Switcher */}
        <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1">
          {VOICE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelectCoachVoice(opt)}
              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
                coachVoice === opt.id
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
              title={`Speak with ${opt.label} (${opt.tag})`}
            >
              <span>{opt.label}</span>
              <span className="font-mono text-[10px] opacity-80">{opt.tag}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Conversation History */}
      <div
        className={`p-4 space-y-3 overflow-y-auto flex-1 ${
          isDrawer ? 'max-h-[250px]' : 'min-h-[230px] max-h-[320px]'
        }`}
      >
        {messages.map((msg) => {
          const speakerLabel =
            msg.role === 'kid'
              ? callsign
              : msg.speaker === 'leo'
              ? 'Pilot Leo (M)'
              : msg.speaker === 'sam'
              ? 'Director Sam (M)'
              : 'Coach Maya (F)';
          const speakerColor =
            msg.role === 'kid'
              ? 'text-cyan-300'
              : msg.speaker === 'leo'
              ? 'text-emerald-300'
              : msg.speaker === 'sam'
              ? 'text-amber-300'
              : 'text-orange-300';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'kid' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[92%] p-3 border text-xs leading-relaxed ${
                  msg.role === 'kid'
                    ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-100'
                    : 'bg-[#07090E] border-slate-800 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className={`font-semibold text-[11px] ${speakerColor}`}>
                    {speakerLabel}
                  </span>
                  {msg.role === 'coach' && (
                    <button
                      type="button"
                      onClick={() => speakMessage(msg)}
                      className="text-cyan-300 hover:text-white flex items-center gap-1 whitespace-nowrap"
                      aria-label="Listen to coach answer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Listen</span>
                    </button>
                  )}
                </div>

                <p className="text-[13px] leading-relaxed text-slate-100">{msg.text}</p>

                {msg.scienceConcept && (
                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-start gap-1.5 text-[11px] text-cyan-300">
                    <Atom className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{msg.scienceConcept}</span>
                  </div>
                )}

                {msg.actionTip && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-300 font-medium">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Next Step: {msg.actionTip}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-start">
            <div className="bg-[#07090E] border border-slate-800 px-3 py-2.5 text-xs text-cyan-300 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Your Flight Coach is checking sensors...</span>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-[#1B1014] border border-rose-500/60 px-3 py-2.5 text-xs text-rose-200 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* Starter & Follow-up Quick Question Buttons */}
      <div className="px-4 py-2.5 border-t border-slate-800/90 bg-[#07090E]/70 space-y-2">
        <p className="text-[11px] text-slate-400">Ask a Mission or Space Physics Question:</p>
        <div className="flex flex-wrap gap-1.5">
          {suggestedQuestions.map((q) => (
            <button
              key={q}
              type="button"
              disabled={loading}
              onClick={() => askCoach(q)}
              className="px-2.5 py-1.5 text-xs text-left bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/60 text-cyan-200 disabled:opacity-50 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Ask Form */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800 bg-[#07090E] flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="Ask about controls or space physics..."
          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 focus:border-cyan-500 focus:outline-none px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-3.5 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          <span>Ask</span>
        </button>
      </form>
    </div>
  );
};
