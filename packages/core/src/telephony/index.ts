/**
 * Telephony module exports
 * Provides Twilio telephony integration with ElevenLabs Conversational AI
 */

// Core manager
export { TelephonyManager, createTelephonyManager } from './manager';
export type { TelephonyManagerOptions } from './manager';

// Store
export { TelephonyStore } from './store';

// Twilio client
export { TwilioClient, validateTwilioSignature } from './twilio-client';
export type { TwilioClientConfig, TwilioApiResponse } from './twilio-client';

// Call manager
export { CallManager } from './call-manager';
export type { CallManagerConfig } from './call-manager';

// Voice bridge
export { VoiceBridge } from './voice-bridge';
export type { VoiceBridgeConfig, VoiceBridgeConnection } from './voice-bridge';

// Stream server
export { startStreamServer } from './stream-server';

// Audio codec
export {
  pcmToMulaw,
  mulawToPcm,
  downsample16kTo8k,
  upsample8kTo16k,
  twilioToElevenLabs,
  elevenLabsToTwilio,
  decodeTwilioPayload,
  encodeTwilioPayload,
} from './audio-codec';

// Tools
export {
  telephonyTools,
  telephonySendSmsTool,
  telephonySendWhatsappTool,
  telephonyCallTool,
  telephonyCallHistoryTool,
  telephonySmsHistoryTool,
  telephonyPhoneNumbersTool,
  telephonyRoutingRulesTool,
  telephonyStatusTool,
  telephonyHoldTool,
  telephonyResumeTool,
  telephonyEndCallTool,
  telephonyActiveCallsTool,
  createTelephonyToolExecutors,
  registerTelephonyTools,
} from './tools';

// Types
export type {
  TelephonyConfig,
  CallStatus,
  CallDirection,
  SmsDirection,
  SmsStatus,
  PhoneNumberStatus,
  MessageType,
  PhoneNumber,
  PhoneNumberCapabilities,
  CallLog,
  SmsLog,
  RoutingRule,
  ActiveCall,
  ActiveCallState,
  CallListItem,
  SmsListItem,
  TelephonyOperationResult,
  TelephonyStatus,
  TwilioCallParams,
  TwilioSmsParams,
  TwilioMediaStreamMessage,
  TelephonyInjectionConfig,
  TelephonyStorageConfig,
  StreamServerConfig,
} from './types';
