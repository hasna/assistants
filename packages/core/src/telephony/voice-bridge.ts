/**
 * VoiceBridge - Bridges Twilio Media Streams to ElevenLabs Conversational AI
 *
 * Audio flow:
 *   Caller -> Twilio -> mulaw 8kHz base64 -> [this bridge] -> PCM 16kHz -> ElevenLabs WS
 *   ElevenLabs WS -> PCM 16kHz -> [this bridge] -> mulaw 8kHz base64 -> Twilio -> Caller
 *
 * The bridge handles:
 * 1. Connecting to the ElevenLabs Conversational AI WebSocket
 * 2. Converting audio between Twilio mulaw and ElevenLabs PCM formats
 * 3. Forwarding audio bidirectionally
 * 4. Managing connection lifecycle
 */

import { generateId } from '@hasna/assistants-shared';
import { decodeTwilioPayload, encodeTwilioPayload } from './audio-codec';
import type { TwilioMediaStreamMessage } from './types';

const ELEVENLABS_WS_BASE = 'wss://api.elevenlabs.io/v1/convai/conversation';

export interface VoiceBridgeConfig {
  elevenLabsApiKey: string;
  elevenLabsAgentId: string;
}

export interface VoiceBridgeConnection {
  id: string;
  callSid: string;
  streamSid: string;
  state: 'connecting' | 'active' | 'closing' | 'closed';
  startedAt: number;
}

type TwilioSendFn = (message: string) => void;

/**
 * VoiceBridge manages bidirectional audio between Twilio and ElevenLabs
 */
export class VoiceBridge {
  private config: VoiceBridgeConfig;
  private connections = new Map<string, BridgeConnection>();

  constructor(config: VoiceBridgeConfig) {
    this.config = config;
  }

  /**
   * Check if the bridge is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.config.elevenLabsApiKey && this.config.elevenLabsAgentId);
  }

  /**
   * Create a new bridge connection for a call
   *
   * @param callSid - Twilio call SID
   * @param streamSid - Twilio stream SID
   * @param sendToTwilio - Function to send messages back to the Twilio WebSocket
   * @returns Bridge connection ID
   */
  async createBridge(
    callSid: string,
    streamSid: string,
    sendToTwilio: TwilioSendFn
  ): Promise<string> {
    const id = `bridge_${generateId().slice(0, 12)}`;

    const connection = new BridgeConnection({
      id,
      callSid,
      streamSid,
      config: this.config,
      sendToTwilio,
    });

    this.connections.set(id, connection);

    try {
      await connection.connect();
    } catch (error) {
      this.connections.delete(id);
      throw error;
    }

    return id;
  }

  /**
   * Forward audio from Twilio to ElevenLabs
   */
  handleTwilioMedia(bridgeId: string, message: TwilioMediaStreamMessage): void {
    const connection = this.connections.get(bridgeId);
    if (!connection) return;

    if (message.event === 'media' && message.media?.payload) {
      connection.forwardToElevenLabs(message.media.payload);
    } else if (message.event === 'stop') {
      connection.close();
      this.connections.delete(bridgeId);
    }
  }

  /**
   * Close a bridge connection
   */
  closeBridge(bridgeId: string): void {
    const connection = this.connections.get(bridgeId);
    if (connection) {
      connection.close();
      this.connections.delete(bridgeId);
    }
  }

  /**
   * Get connection info
   */
  getConnection(bridgeId: string): VoiceBridgeConnection | null {
    const conn = this.connections.get(bridgeId);
    if (!conn) return null;
    return conn.getInfo();
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): VoiceBridgeConnection[] {
    return Array.from(this.connections.values()).map((c) => c.getInfo());
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
  }
}

// ============================================
// Internal Bridge Connection
// ============================================

interface BridgeConnectionOptions {
  id: string;
  callSid: string;
  streamSid: string;
  config: VoiceBridgeConfig;
  sendToTwilio: TwilioSendFn;
}

class BridgeConnection {
  private id: string;
  private callSid: string;
  private streamSid: string;
  private config: VoiceBridgeConfig;
  private sendToTwilio: TwilioSendFn;
  private elevenLabsWs: WebSocket | null = null;
  private state: 'connecting' | 'active' | 'closing' | 'closed' = 'connecting';
  private startedAt: number;

  constructor(options: BridgeConnectionOptions) {
    this.id = options.id;
    this.callSid = options.callSid;
    this.streamSid = options.streamSid;
    this.config = options.config;
    this.sendToTwilio = options.sendToTwilio;
    this.startedAt = Date.now();
  }

  /**
   * Connect to ElevenLabs Conversational AI WebSocket
   */
  async connect(): Promise<void> {
    const url = `${ELEVENLABS_WS_BASE}?agent_id=${this.config.elevenLabsAgentId}`;

    return new Promise<void>((resolve, reject) => {
      try {
        this.elevenLabsWs = new WebSocket(url, {
          headers: {
            'xi-api-key': this.config.elevenLabsApiKey,
          },
        } as unknown as string[]);

        this.elevenLabsWs.onopen = () => {
          this.state = 'active';
          resolve();
        };

        this.elevenLabsWs.onmessage = (event) => {
          this.handleElevenLabsMessage(event.data as string);
        };

        this.elevenLabsWs.onerror = (event) => {
          console.error(`[VoiceBridge ${this.id}] ElevenLabs WS error:`, event);
          if (this.state === 'connecting') {
            reject(new Error('Failed to connect to ElevenLabs'));
          }
        };

        this.elevenLabsWs.onclose = () => {
          this.state = 'closed';
        };

        // Timeout connection attempt
        setTimeout(() => {
          if (this.state === 'connecting') {
            this.close();
            reject(new Error('ElevenLabs connection timeout'));
          }
        }, 10_000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Forward Twilio mulaw audio to ElevenLabs
   */
  forwardToElevenLabs(base64Payload: string): void {
    if (this.state !== 'active' || !this.elevenLabsWs) return;

    try {
      // Convert Twilio mulaw to PCM for ElevenLabs
      const pcm16k = decodeTwilioPayload(base64Payload);

      // Send as base64 PCM to ElevenLabs
      const message = JSON.stringify({
        user_audio_chunk: pcm16k.toString('base64'),
      });

      if (this.elevenLabsWs.readyState === WebSocket.OPEN) {
        this.elevenLabsWs.send(message);
      }
    } catch (error) {
      console.error(`[VoiceBridge ${this.id}] Error forwarding to ElevenLabs:`, error);
    }
  }

  /**
   * Handle messages from ElevenLabs and forward audio to Twilio
   */
  private handleElevenLabsMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // ElevenLabs sends audio chunks
      if (message.audio?.chunk) {
        const pcm16k = Buffer.from(message.audio.chunk, 'base64');
        const twilioPayload = encodeTwilioPayload(pcm16k);

        // Send to Twilio as media message
        const twilioMessage = JSON.stringify({
          event: 'media',
          streamSid: this.streamSid,
          media: {
            payload: twilioPayload,
          },
        });

        this.sendToTwilio(twilioMessage);
      }

      // Handle conversation events (for logging/debugging)
      if (message.type === 'conversation_initiation_metadata') {
        // Conversation started
      } else if (message.type === 'agent_response') {
        // Agent responded with text (could be logged)
      } else if (message.type === 'user_transcript') {
        // User speech was transcribed (could be logged)
      }
    } catch (error) {
      console.error(`[VoiceBridge ${this.id}] Error handling ElevenLabs message:`, error);
    }
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.state = 'closing';

    if (this.elevenLabsWs) {
      try {
        this.elevenLabsWs.close();
      } catch {
        // Ignore close errors
      }
      this.elevenLabsWs = null;
    }

    this.state = 'closed';
  }

  /**
   * Get connection info
   */
  getInfo(): VoiceBridgeConnection {
    return {
      id: this.id,
      callSid: this.callSid,
      streamSid: this.streamSid,
      state: this.state,
      startedAt: this.startedAt,
    };
  }
}
