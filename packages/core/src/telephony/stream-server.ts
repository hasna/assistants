/**
 * Stream Server - Bun-native WebSocket server for Twilio Media Streams
 *
 * Bridges Twilio's real-time audio stream to ElevenLabs Conversational AI
 * via the VoiceBridge. Handles the Twilio Media Stream WebSocket protocol:
 *   connected → start → media (repeated) → stop
 */

import type { VoiceBridge } from './voice-bridge';
import type { CallManager } from './call-manager';
import type { TelephonyStore } from './store';
import type { TwilioMediaStreamMessage, StreamServerConfig } from './types';

export interface StreamServerOptions {
  port: number;
  host?: string;
  voiceBridge: VoiceBridge;
  callManager: CallManager;
  store: TelephonyStore;
}

interface StreamSession {
  callSid: string;
  streamSid: string;
  bridgeId: string | null;
}

const DEFAULT_PORT = 8765;

/**
 * Start a Bun WebSocket server that handles Twilio Media Streams
 */
export function startStreamServer(config: {
  port?: number;
  host?: string;
  voiceBridge: VoiceBridge;
  callManager: CallManager;
  store: TelephonyStore;
}): { stop: () => void; port: number } {
  const port = config.port || DEFAULT_PORT;
  const host = config.host || '0.0.0.0';

  // Track sessions by WebSocket (using a WeakMap-like approach with Map)
  const sessions = new Map<unknown, StreamSession>();

  const server = Bun.serve({
    port,
    hostname: host,

    fetch(req, server) {
      // Upgrade HTTP requests to WebSocket
      const url = new URL(req.url);
      if (url.pathname === '/stream' || url.pathname === '/') {
        const upgraded = server.upgrade(req);
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }
      // Health check
      if (url.pathname === '/health') {
        return new Response('ok');
      }
      return new Response('Not Found', { status: 404 });
    },

    websocket: {
      open(ws) {
        // Session will be initialized when 'start' message arrives
        sessions.set(ws, { callSid: '', streamSid: '', bridgeId: null });
      },

      async message(ws, data) {
        try {
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data as unknown as ArrayBuffer);
          const msg: TwilioMediaStreamMessage = JSON.parse(text);
          const session = sessions.get(ws);
          if (!session) return;

          switch (msg.event) {
            case 'connected':
              // Twilio connected — no action needed
              break;

            case 'start': {
              const startData = msg.start;
              if (!startData) break;

              const callSid = startData.callSid;
              const streamSid = startData.streamSid;

              session.callSid = callSid;
              session.streamSid = streamSid;

              // Update call manager with stream SID
              config.callManager.setStreamSid(callSid, streamSid);

              // Create voice bridge connection
              const sendToTwilio = (message: string) => {
                try {
                  ws.send(message);
                } catch {
                  // WS may have closed
                }
              };

              try {
                const bridgeId = await config.voiceBridge.createBridge(
                  callSid,
                  streamSid,
                  sendToTwilio
                );
                session.bridgeId = bridgeId;

                // Update call state
                config.callManager.setBridgeId(callSid, bridgeId);
                config.callManager.updateState(callSid, 'active');

                // Update persistent call log
                const callLog = config.store.getCallLogBySid(callSid);
                if (callLog) {
                  config.store.updateCallLog(callLog.id, {
                    status: 'in-progress',
                    startedAt: new Date().toISOString(),
                  });
                }
              } catch (error) {
                console.error(`[StreamServer] Failed to create bridge for ${callSid}:`, error);
                ws.close();
              }
              break;
            }

            case 'media': {
              if (!session.bridgeId) break;
              config.callManager.touchCall(session.callSid);
              config.voiceBridge.handleTwilioMedia(session.bridgeId, msg);
              break;
            }

            case 'stop': {
              if (session.bridgeId) {
                config.voiceBridge.closeBridge(session.bridgeId);
              }

              // Update call state
              const call = config.callManager.endCall(session.callSid);
              if (call) {
                const callLog = config.store.getCallLogBySid(session.callSid);
                if (callLog) {
                  const duration = Math.floor((Date.now() - call.startedAt) / 1000);
                  config.store.updateCallLog(callLog.id, {
                    status: 'completed',
                    endedAt: new Date().toISOString(),
                    duration,
                  });
                }
              }

              sessions.delete(ws);
              break;
            }
          }
        } catch (error) {
          console.error('[StreamServer] Error handling message:', error);
        }
      },

      close(ws) {
        const session = sessions.get(ws);
        if (session) {
          if (session.bridgeId) {
            config.voiceBridge.closeBridge(session.bridgeId);
          }
          if (session.callSid) {
            config.callManager.endCall(session.callSid);
          }
          sessions.delete(ws);
        }
      },
    },
  });

  console.log(`[StreamServer] Listening on ${host}:${port}`);

  return {
    stop: () => {
      server.stop();
    },
    port,
  };
}
