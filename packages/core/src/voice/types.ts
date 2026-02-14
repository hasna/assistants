export interface STTOptions {
  apiKey?: string;
  model?: string;
  language?: string;
}

export interface STTResult {
  text: string;
  confidence: number;
  duration?: number;
  language?: string;
}

export interface StreamingSTTCallbacks {
  /** Called with partial transcript as words are recognized */
  onPartial?: (text: string) => void;
  /** Called with finalized transcript segments */
  onFinal?: (text: string) => void;
  /** Called when streaming ends (silence detected or stopped) */
  onDone?: (fullText: string) => void;
}

export interface StreamingSTTOptions {
  /** Use VAD-based auto-commit (default: true) */
  autoSend?: boolean;
  /** Silence threshold in seconds for VAD (default: 1.5) */
  silenceThreshold?: number;
}

export interface STTProvider {
  transcribe(audio: ArrayBuffer): Promise<STTResult>;
  /** Stream audio from microphone with real-time partial transcripts */
  streamFromMic?(callbacks: StreamingSTTCallbacks, options?: StreamingSTTOptions): Promise<{ stop: () => void }>;
}

export interface TTSOptions {
  apiKey?: string;
  voiceId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
}

export interface TTSResult {
  audio: ArrayBuffer;
  duration?: number;
  format?: 'mp3' | 'wav' | 'aiff';
}

export interface TTSProvider {
  synthesize(text: string): Promise<TTSResult>;
  stream?(text: string): AsyncGenerator<ArrayBuffer>;
}

export interface VoiceState {
  enabled: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isTalking: boolean;
  sttProvider?: string;
  ttsProvider?: string;
}
