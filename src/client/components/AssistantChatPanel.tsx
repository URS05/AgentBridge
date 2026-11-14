import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  api,
  type ChatAction,
  type ChatLanguage,
  type ChatProvider,
  type ChatReference,
  type ChatTurn,
  type VoiceCapabilities,
} from '../api';
import { startLiveWavRecorder, type LiveWavRecorder } from '../audioRecorder';
import { StatusBadge } from './StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: 'sarvam' | 'sarvam-grounded' | 'gemini' | 'grounded-engine';
  language?: ChatLanguage;
  references?: ChatReference[];
  actions?: ChatAction[];
  suggestedPrompts?: string[];
  timestamp: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const LOCALE_MAP: Record<ChatLanguage, string> = {
  en: 'en-IN',
  hinglish: 'hi-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
};

const PROVIDER_LABELS: Record<ChatProvider, string> = {
  sarvam: 'Sarvam AI',
  gemini: 'Gemini 4',
  grounded: 'Live Ops',
  auto: 'Auto',
};

const LANGUAGE_LABELS: Record<ChatLanguage, string> = {
  en: 'English',
  hinglish: 'Hinglish',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
};

const MODE_LABELS: Record<NonNullable<MessageItem['mode']>, string> = {
  sarvam: 'Sarvam AI',
  'sarvam-grounded': 'Sarvam',
  gemini: 'Gemini 4',
  'grounded-engine': 'Live Ops',
};

const MINIMAL_PROMPTS = [
  'Explain this screen & help me navigate',
  'What needs my attention today?',
  'Why is Kaveri Fresh Foods blocked?',
];

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AssistantChatPanel({
  focusJourneyId,
  currentPath,
  initialQuestion,
  initialQuestionNonce,
  onNavigate,
  onOpenLaunch,
  onMutated,
  compact = false,
}: {
  focusJourneyId?: string;
  currentPath?: string;
  initialQuestion?: string | null;
  initialQuestionNonce?: number;
  onNavigate: (path: string) => void;
  onOpenLaunch?: () => void;
  onMutated?: () => void;
  compact?: boolean;
}) {
  const [provider, setProvider] = useState<ChatProvider>('sarvam');
  const [language, setLanguage] = useState<ChatLanguage>('en');
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Voice Input & Output state
  const [voiceCaps, setVoiceCaps] = useState<VoiceCapabilities | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(Array(12).fill(0.2));
  const [transcribing, setTranscribing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastHandledNonce = useRef<number>(0);
  const wavRecorderRef = useRef<LiveWavRecorder | null>(null);
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api
      .getVoiceCapabilities()
      .then((caps) => setVoiceCaps(caps))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }
    const id = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    return () => {
      stopPlayback();
      cancelRecording();
    };
  }, []);

  useEffect(() => {
    if (
      initialQuestion &&
      initialQuestionNonce &&
      initialQuestionNonce !== lastHandledNonce.current
    ) {
      lastHandledNonce.current = initialQuestionNonce;
      void sendPrompt(initialQuestion);
    }
  }, [initialQuestion, initialQuestionNonce]);

  function stopPlayback() {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }

  function cancelRecording() {
    if (wavRecorderRef.current) {
      wavRecorderRef.current.cancel();
      wavRecorderRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // Ignore stop error
      }
      speechRecRef.current = null;
    }
    setRecording(false);
    setVoiceLevels(Array(12).fill(0.2));
  }

  async function speakText(messageId: string, rawText: string, lang: ChatLanguage) {
    if (speakingMessageId === messageId) {
      stopPlayback();
      return;
    }

    stopPlayback();
    setSpeakingMessageId(messageId);

    try {
      const ttsRes = await api.textToSpeech({
        text: rawText,
        language: lang,
      });

      if (ttsRes.available && ttsRes.audioBase64) {
        const audio = new Audio(`data:${ttsRes.mimeType ?? 'audio/mpeg'};base64,${ttsRes.audioBase64}`);
        audioElRef.current = audio;
        audio.onended = () => setSpeakingMessageId(null);
        audio.onerror = () => setSpeakingMessageId(null);
        await audio.play();
        return;
      }

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(ttsRes.cleanText);
        utterance.lang = ttsRes.locale || LOCALE_MAP[lang];
        utterance.rate = 1.0;
        utterance.onend = () => setSpeakingMessageId(null);
        utterance.onerror = () => setSpeakingMessageId(null);
        window.speechSynthesis.speak(utterance);
        return;
      }

      setSpeakingMessageId(null);
      toast.info('Speaker playback is unavailable in this browser.');
    } catch (err) {
      setSpeakingMessageId(null);
      toast.error(err instanceof Error ? err.message : 'Unable to play voice reply');
    }
  }

  async function finishAndSendRecording() {
    if (!recording) return;

    if (wavRecorderRef.current) {
      const recorder = wavRecorderRef.current;
      wavRecorderRef.current = null;
      setRecording(false);
      setVoiceLevels(Array(12).fill(0.2));
      setTranscribing(true);
      try {
        const { base64, mimeType } = await recorder.stop();
        const stt = await api.speechToText({
          audioBase64: base64,
          mimeType,
          language,
        });
        if (stt.transcript) {
          void sendPrompt(stt.transcript);
        } else {
          toast.info('No speech detected — please try speaking clearly.');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not transcribe audio');
      } finally {
        setTranscribing(false);
      }
      return;
    }

    if (speechRecRef.current) {
      speechRecRef.current.stop();
      setRecording(false);
    }
  }

  async function startMic() {
    if (recording || sending || transcribing) return;

    // Path 1: Real 16kHz PCM WAV capture -> Sarvam STT when SARVAM_API_KEY is configured
    if (voiceCaps?.sarvamConfigured) {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('Microphone access is not available in this browser.');
        return;
      }
      try {
        const recorder = await startLiveWavRecorder((bars) => setVoiceLevels(bars));
        wavRecorderRef.current = recorder;
        setRecording(true);
        return;
      } catch {
        toast.error('Please allow microphone permission to speak.');
        return;
      }
    }

    // Path 2: Browser Web Speech API fallback when no SARVAM_API_KEY is set
    const SpeechRecCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      toast.info('Browser voice input is not supported here. Try typing or clicking a prompt.');
      return;
    }

    try {
      const rec = new SpeechRecCtor();
      rec.lang = LOCALE_MAP[language];
      rec.interimResults = true;
      rec.continuous = false;
      speechRecRef.current = rec;

      let finalTranscript = '';
      rec.onresult = (event) => {
        let combined = '';
        for (let i = 0; i < event.results.length; i += 1) {
          combined += event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript = combined.trim();
        }
        setInput(combined);
        setVoiceLevels(
          Array.from({ length: 12 }, (_, idx) => 0.3 + ((combined.length + idx * 3) % 7) * 0.1)
        );
      };
      rec.onerror = (ev) => {
        setRecording(false);
        speechRecRef.current = null;
        if (ev.error === 'not-allowed') toast.error('Microphone permission denied.');
      };
      rec.onend = () => {
        setRecording(false);
        speechRecRef.current = null;
        if (finalTranscript) void sendPrompt(finalTranscript);
      };

      rec.start();
      setRecording(true);
    } catch {
      setRecording(false);
      toast.error('Unable to start microphone.');
    }
  }

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: MessageItem = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: nowLabel,
    };

    const history: ChatTurn[] = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await api.chat({
        message: trimmed,
        journeyId: focusJourneyId,
        provider,
        language,
        currentPath,
        history,
      });

      if (res.mutatedStore) {
        onMutated?.();
      }

      const assistantId = `a_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: res.reply,
          mode: res.mode,
          language: res.language,
          references: res.references,
          actions: res.actions,
          suggestedPrompts: res.suggestedPrompts,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      if (autoSpeak) {
        void speakText(assistantId, res.reply, res.language || language);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to send message');
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendPrompt(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendPrompt(input);
    }
  }

  function handleActionClick(act: ChatAction) {
    if (act.action === 'OPEN_LAUNCH') {
      onOpenLaunch?.();
      return;
    }
    if (act.path) {
      onNavigate(act.path);
    }
  }

  const latestPrompts =
    [...messages].reverse().find((m) => m.role === 'assistant' && m.suggestedPrompts?.length)
      ?.suggestedPrompts ?? [];

  return (
    <div className={`flex flex-col bg-card ${compact ? 'h-full min-h-0' : 'h-full min-h-[520px]'}`}>
      {/* Minimal Single-Row Header Bar */}
      <div className="px-3.5 py-2 border-b border-border/70 bg-card flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Select value={provider} onValueChange={(v) => setProvider((v as ChatProvider) ?? 'sarvam')}>
            <SelectTrigger
              size="sm"
              className="h-7 px-2.5 text-xs font-medium bg-secondary/50 border-transparent hover:bg-secondary"
              aria-label="Select AI Model Provider"
            >
              <Sparkles className="w-3 h-3 text-[#0095D9] shrink-0" />
              <SelectValue>{PROVIDER_LABELS[provider]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sarvam">Sarvam AI</SelectItem>
              <SelectItem value="gemini">Gemini 4</SelectItem>
              <SelectItem value="grounded">Live Ops</SelectItem>
              <SelectItem value="auto">Auto</SelectItem>
            </SelectContent>
          </Select>

          <Select value={language} onValueChange={(v) => setLanguage((v as ChatLanguage) ?? 'en')}>
            <SelectTrigger
              size="sm"
              className="h-7 px-2 text-xs bg-secondary/50 border-transparent hover:bg-secondary"
              aria-label="Select Sarvam Chat Language"
            >
              <SelectValue>{LANGUAGE_LABELS[language]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="hinglish">Hinglish</SelectItem>
              <SelectItem value="hi">हिन्दी</SelectItem>
              <SelectItem value="ta">தமிழ்</SelectItem>
              <SelectItem value="te">తెలుగు</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="icon-xs"
            variant={autoSpeak ? 'default' : 'ghost'}
            onClick={() => {
              const next = !autoSpeak;
              setAutoSpeak(next);
              if (!next) stopPlayback();
              toast.success(next ? 'Auto-speak enabled' : 'Auto-speak muted');
            }}
            aria-label={autoSpeak ? 'Mute auto-speak voice' : 'Enable auto-speak voice'}
            title={autoSpeak ? 'Auto-speak On' : 'Auto-speak Off'}
            className={autoSpeak ? 'bg-[#0095D9] hover:bg-[#007EB8] text-white' : 'text-muted-foreground'}
          >
            {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </Button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {compact && onOpenLaunch && (
            <Button
              type="button"
              size="xs"
              onClick={onOpenLaunch}
              className="h-7 px-2.5 rounded-full bg-[#002E6E] hover:bg-[#002354] text-white dark:bg-[#00B9F1] dark:text-[#04152D]"
            >
              <Play className="w-3 h-3" />
              <span>Start Demo</span>
            </Button>
          )}
          {messages.length > 0 && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => {
                stopPlayback();
                setMessages([]);
              }}
              title="New chat"
              aria-label="Start new chat"
              className="text-muted-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Calm, Minimal Conversation Area */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col">
        <div className={`w-full flex-1 flex flex-col ${compact ? 'space-y-4' : 'max-w-2xl mx-auto space-y-6'}`}>
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-4 space-y-5">
              <div className="space-y-2">
                <div className="w-11 h-11 rounded-2xl bg-[#002E6E] text-white dark:bg-[#00B9F1] dark:text-[#04152D] flex items-center justify-center mx-auto shadow-sm">
                  <Bot className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  Hi, I am Paytm Bot
                </h2>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  Speak with the mic or type below. I can explain any screen, check merchants, and help you navigate.
                </p>
              </div>

              {/* Minimal Prompt Chips */}
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
                {MINIMAL_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendPrompt(prompt)}
                    className="px-3.5 py-2 rounded-full border border-border bg-background hover:bg-secondary/60 text-xs font-medium text-foreground transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {/* Quiet Inline Quick Navigation */}
              <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground pt-1">
                <button type="button" onClick={() => onNavigate('/dashboard')} className="hover:text-[#0095D9] transition-colors">
                  Dashboard
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => onNavigate('/approvals')} className="hover:text-[#0095D9] transition-colors">
                  Approvals
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => onNavigate('/journeys')} className="hover:text-[#0095D9] transition-colors">
                  All Merchants
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => onNavigate('/integrations')} className="hover:text-[#0095D9] transition-colors">
                  Systems
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isSpeaking = speakingMessageId === msg.id;

              if (isUser) {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="flex items-start gap-2 max-w-[85%] justify-end">
                      <div className="rounded-2xl rounded-tr-sm bg-[#002E6E] text-white dark:bg-[#00B9F1] dark:text-[#04152D] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line">
                        {msg.content}
                      </div>
                      <div className="w-7 h-7 rounded-full bg-secondary text-foreground flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#002E6E] text-white dark:bg-[#00B9F1] dark:text-[#04152D] flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Paytm Bot</span>
                        {msg.mode && (
                          <span className="text-[10px] text-muted-foreground">
                            · {MODE_LABELS[msg.mode]}
                          </span>
                        )}
                      </div>

                      {/* Speaker Button with Live Equalizer when Speaking */}
                      <button
                        type="button"
                        onClick={() => void speakText(msg.id, msg.content, msg.language || language)}
                        aria-label={isSpeaking ? 'Stop speaking reply' : 'Listen to reply aloud'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                          isSpeaking
                            ? 'bg-[#0095D9] text-white'
                            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                        }`}
                      >
                        {isSpeaking ? (
                          <>
                            <span className="inline-flex items-end gap-0.5 h-3" aria-hidden="true">
                              <span className="w-0.5 bg-white rounded-full animate-pulse h-2" />
                              <span className="w-0.5 bg-white rounded-full animate-pulse h-3" />
                              <span className="w-0.5 bg-white rounded-full animate-pulse h-1.5" />
                            </span>
                            <span>Stop</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5" />
                            <span>Listen</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                      {msg.content
                        .replace(/\*\*(.*?)\*\*/g, '$1')
                        .replace(/`([^`]+)`/g, '$1')
                        .replace(/^\* /gm, '• ')}
                    </div>

                    {msg.actions && msg.actions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {msg.actions.map((act) => (
                          <Button
                            key={act.label}
                            type="button"
                            size="xs"
                            variant={act.action === 'OPEN_LAUNCH' ? 'default' : 'outline'}
                            onClick={() => handleActionClick(act)}
                            className="rounded-full"
                          >
                            <span>{act.label}</span>
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        ))}
                      </div>
                    )}

                    {msg.references && msg.references.length > 0 && (
                      <div className="space-y-1.5">
                        {msg.references.map((ref) => (
                          <div
                            key={ref.journeyId}
                            className="rounded-xl bg-background border border-border/80 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">{ref.merchantName}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{ref.summary}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <StatusBadge status={ref.status} />
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                onClick={() => onNavigate(`/journeys/${ref.journeyId}`)}
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-[#002E6E] text-white flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="inline-flex gap-1" aria-hidden="true">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0095D9] animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0095D9] animate-bounce [animation-delay:120ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0095D9] animate-bounce [animation-delay:240ms]" />
                </span>
                <span>Thinking...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Minimal Bottom Composer + Live Reactive Voice Waveform */}
      <div className="px-4 pb-3.5 pt-2 bg-card shrink-0">
        <div className={`${compact ? 'space-y-2' : 'max-w-2xl mx-auto space-y-2'}`}>
          {!recording && !transcribing && latestPrompts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {latestPrompts.slice(0, 3).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => void sendPrompt(prompt)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-background hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {recording ? (
            /* Live Animated Voice Equalizer Mode */
            <div className="rounded-2xl border border-[#0095D9]/50 bg-[#E6F7FD]/60 dark:bg-[#14294D] px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-[#0095D9] text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Mic className="w-4 h-4 animate-pulse" />
                </div>
                <div className="flex items-center gap-1 h-7" aria-label="Live voice waveform">
                  {voiceLevels.map((lvl, idx) => (
                    <span
                      key={idx}
                      className="w-1 rounded-full bg-[#002E6E] dark:bg-[#00B9F1] transition-[height] duration-75"
                      style={{ height: `${Math.round(4 + lvl * 22)}px` }}
                    />
                  ))}
                </div>
                <span className="text-xs font-medium text-[#002E6E] dark:text-white tabular-nums">
                  {formatTimer(recordingSeconds)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={cancelRecording}
                  aria-label="Cancel voice recording"
                >
                  <X className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void finishAndSendRecording()}
                  aria-label="Finish speaking and send"
                  className="rounded-full bg-[#002E6E] hover:bg-[#002354] text-white dark:bg-[#00B9F1] dark:text-[#04152D] px-3"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Send Voice</span>
                </Button>
              </div>
            </div>
          ) : transcribing ? (
            <div className="rounded-2xl border border-border bg-secondary/40 px-4 py-3 flex items-center gap-2.5 text-xs text-foreground">
              <span className="inline-flex gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0095D9] animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#0095D9] animate-bounce [animation-delay:120ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#0095D9] animate-bounce [animation-delay:240ms]" />
              </span>
              <span>Transcribing your voice...</span>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-border bg-background px-3.5 py-2 shadow-xs focus-within:border-[#0095D9] focus-within:ring-2 focus-within:ring-[#0095D9]/15 transition-all flex items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={
                  language === 'hinglish'
                    ? 'Poochhein ya mic dabayein...'
                    : 'Message Paytm Bot...'
                }
                aria-label="Message Paytm Bot"
                disabled={sending}
                className="flex-1 min-h-[36px] max-h-28 py-1.5 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed"
              />

              <div className="flex items-center gap-1.5 pb-0.5 shrink-0">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={sending}
                  onClick={() => void startMic()}
                  aria-label="Speak using microphone"
                  title={`Speak in ${LANGUAGE_LABELS[language]}`}
                  className="rounded-full text-[#0095D9] hover:bg-[#E6F7FD] dark:hover:bg-[#14294D]"
                >
                  <Mic className="w-4 h-4" />
                </Button>

                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={sending || !input.trim()}
                  aria-label="Send message"
                  className="rounded-full bg-[#002E6E] hover:bg-[#002354] text-white dark:bg-[#00B9F1] dark:text-[#04152D]"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
