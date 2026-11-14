import type { ChatLanguage } from './chatAssistant';

export type SarvamLocale = 'en-IN' | 'hi-IN' | 'ta-IN' | 'te-IN';

export function getSarvamLocale(language: ChatLanguage = 'en'): SarvamLocale {
  switch (language) {
    case 'hi':
    case 'hinglish':
      return 'hi-IN';
    case 'ta':
      return 'ta-IN';
    case 'te':
      return 'te-IN';
    case 'en':
    default:
      return 'en-IN';
  }
}

export function getConfiguredSarvamKey(): string | null {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key || key.includes('MY_SARVAM_API_KEY')) return null;
  return key;
}

export function getVoiceCapabilities() {
  const sarvamConfigured = Boolean(getConfiguredSarvamKey());
  return {
    sarvamConfigured,
    chatModel: 'sarvam-m',
    sttModel: 'saaras:v3',
    ttsModel: 'bulbul:v3',
    defaultSpeaker: 'roopa',
    supportedLocales: ['en-IN', 'hi-IN', 'ta-IN', 'te-IN'] as SarvamLocale[],
  };
}

export function sanitizeTextForSpeech(raw: string): string {
  return raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[•#*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export interface SttResult {
  available: boolean;
  transcript: string;
  locale: SarvamLocale;
  mode: 'sarvam-stt' | 'browser-speech-recognition';
  reason?: string;
}

export async function transcribeAudioWithSarvam(params: {
  audioBase64: string;
  mimeType?: string;
  language?: ChatLanguage;
}): Promise<SttResult> {
  const language = params.language ?? 'en';
  const locale = getSarvamLocale(language);
  const sarvamKey = getConfiguredSarvamKey();

  if (!sarvamKey) {
    return {
      available: false,
      transcript: '',
      locale,
      mode: 'browser-speech-recognition',
      reason: 'SARVAM_API_KEY is not configured; using browser Web Speech Recognition.',
    };
  }

  const cleanBase64 = params.audioBase64.replace(/^data:audio\/[a-z0-9.+-]+(?:;[^;,]+)*;base64,/i, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.byteLength === 0) {
    throw new Error('Empty audio recording received.');
  }

  const rawMime = (params.mimeType || 'audio/wav').split(';')[0].trim().toLowerCase();
  const normalizedMime =
    rawMime === 'audio/wave' || rawMime === 'audio/x-wav' || rawMime === 'audio/wav'
      ? 'audio/wav'
      : rawMime === 'audio/mp3' || rawMime === 'audio/mpeg3' || rawMime === 'audio/mpeg'
        ? 'audio/mpeg'
        : rawMime === 'audio/ogg'
          ? 'audio/ogg'
          : 'audio/wav';
  const ext = normalizedMime === 'audio/mpeg' ? 'mp3' : normalizedMime === 'audio/ogg' ? 'ogg' : 'wav';

  const callSttModel = async (model: string) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: normalizedMime }), `voice.${ext}`);
    form.append('model', model);
    form.append('language_code', locale);
    form.append('mode', language === 'hinglish' ? 'codemix' : 'transcribe');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST',
        headers: {
          'api-subscription-key': sarvamKey,
        },
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Sarvam STT HTTP ${res.status}${errText ? `: ${errText.slice(0, 160)}` : ''}`);
      }

      const json = (await res.json()) as {
        transcript?: string;
        language_code?: string;
      };

      return {
        available: true,
        transcript: json.transcript?.trim() ?? '',
        locale: (json.language_code as SarvamLocale) || locale,
        mode: 'sarvam-stt' as const,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await callSttModel('saaras:v3');
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('HTTP 400') || msg.includes('HTTP 422')) {
      return await callSttModel('saarika:v2.5');
    }
    throw err;
  }
}

export interface TtsResult {
  available: boolean;
  audioBase64?: string;
  mimeType?: string;
  cleanText: string;
  locale: SarvamLocale;
  mode: 'sarvam-tts' | 'browser-speech-synthesis';
  reason?: string;
}

export async function synthesizeSpeechWithSarvam(params: {
  text: string;
  language?: ChatLanguage;
  speaker?: string;
}): Promise<TtsResult> {
  const language = params.language ?? 'en';
  const locale = getSarvamLocale(language);
  const cleanText = sanitizeTextForSpeech(params.text);

  if (!cleanText) {
    throw new Error('No speakable text provided.');
  }

  const sarvamKey = getConfiguredSarvamKey();
  if (!sarvamKey) {
    return {
      available: false,
      cleanText,
      locale,
      mode: 'browser-speech-synthesis',
      reason: 'SARVAM_API_KEY is not configured; using browser SpeechSynthesis.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': sarvamKey,
      },
      body: JSON.stringify({
        text: cleanText,
        target_language_code: locale,
        speaker: params.speaker || 'roopa',
        model: 'bulbul:v3',
        pace: 1.0,
        output_audio_codec: 'mp3',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Sarvam TTS HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
    }

    const json = (await res.json()) as {
      audios?: string[];
    };

    const audioBase64 = json.audios?.[0];
    if (!audioBase64) {
      throw new Error('Sarvam TTS returned no audio stream.');
    }

    return {
      available: true,
      audioBase64,
      mimeType: 'audio/mpeg',
      cleanText,
      locale,
      mode: 'sarvam-tts',
    };
  } finally {
    clearTimeout(timer);
  }
}
