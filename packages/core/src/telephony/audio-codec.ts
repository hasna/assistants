/**
 * Audio codec utilities for Twilio <-> ElevenLabs audio conversion
 *
 * Twilio Media Streams send audio in mulaw (G.711 u-law) format at 8kHz.
 * ElevenLabs Conversational AI expects and sends PCM 16-bit at 16kHz.
 * This module handles the conversion between these formats.
 */

// mulaw encoding/decoding lookup tables
const MULAW_MAX = 0x1fff;
const MULAW_BIAS = 33;

/**
 * Encode a single 16-bit PCM sample to mulaw byte
 */
function pcmSampleToMulaw(sample: number): number {
  const sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  sample += MULAW_BIAS;

  let exponent = 7;
  let mask = 0x4000;
  while (exponent > 0 && (sample & mask) === 0) {
    exponent--;
    mask >>= 1;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulawByte;
}

/**
 * Decode a single mulaw byte to 16-bit PCM sample
 */
function mulawSampleToPcm(mulawByte: number): number {
  mulawByte = ~mulawByte & 0xff;
  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0f;

  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;

  return sign !== 0 ? -sample : sample;
}

/**
 * Convert a buffer of 16-bit PCM samples to mulaw encoded bytes
 *
 * @param pcmBuffer - Buffer containing 16-bit signed PCM samples (little-endian)
 * @returns Buffer of mulaw encoded bytes
 */
export function pcmToMulaw(pcmBuffer: Buffer): Buffer {
  const numSamples = Math.floor(pcmBuffer.length / 2);
  const mulawBuffer = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    mulawBuffer[i] = pcmSampleToMulaw(sample);
  }

  return mulawBuffer;
}

/**
 * Convert a buffer of mulaw encoded bytes to 16-bit PCM samples
 *
 * @param mulawBuffer - Buffer containing mulaw encoded bytes
 * @returns Buffer of 16-bit signed PCM samples (little-endian)
 */
export function mulawToPcm(mulawBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);

  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = mulawSampleToPcm(mulawBuffer[i]);
    pcmBuffer.writeInt16LE(sample, i * 2);
  }

  return pcmBuffer;
}

/**
 * Downsample PCM audio from 16kHz to 8kHz (simple decimation)
 * Takes every other sample.
 *
 * @param pcm16k - Buffer of 16-bit PCM at 16kHz
 * @returns Buffer of 16-bit PCM at 8kHz
 */
export function downsample16kTo8k(pcm16k: Buffer): Buffer {
  const numSamples = Math.floor(pcm16k.length / 2);
  const outputSamples = Math.floor(numSamples / 2);
  const pcm8k = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const sample = pcm16k.readInt16LE(i * 2 * 2);
    pcm8k.writeInt16LE(sample, i * 2);
  }

  return pcm8k;
}

/**
 * Upsample PCM audio from 8kHz to 16kHz (linear interpolation)
 *
 * @param pcm8k - Buffer of 16-bit PCM at 8kHz
 * @returns Buffer of 16-bit PCM at 16kHz
 */
export function upsample8kTo16k(pcm8k: Buffer): Buffer {
  const numSamples = Math.floor(pcm8k.length / 2);
  const pcm16k = Buffer.alloc(numSamples * 2 * 2);

  for (let i = 0; i < numSamples; i++) {
    const current = pcm8k.readInt16LE(i * 2);
    const next = i + 1 < numSamples ? pcm8k.readInt16LE((i + 1) * 2) : current;
    const interpolated = Math.round((current + next) / 2);

    pcm16k.writeInt16LE(current, i * 4);
    pcm16k.writeInt16LE(interpolated, i * 4 + 2);
  }

  return pcm16k;
}

/**
 * Convert Twilio mulaw (8kHz) to ElevenLabs PCM (16kHz, 16-bit)
 * Pipeline: mulaw -> PCM 8kHz -> PCM 16kHz
 */
export function twilioToElevenLabs(mulawBuffer: Buffer): Buffer {
  const pcm8k = mulawToPcm(mulawBuffer);
  return upsample8kTo16k(pcm8k);
}

/**
 * Convert ElevenLabs PCM (16kHz, 16-bit) to Twilio mulaw (8kHz)
 * Pipeline: PCM 16kHz -> PCM 8kHz -> mulaw
 */
export function elevenLabsToTwilio(pcm16k: Buffer): Buffer {
  const pcm8k = downsample16kTo8k(pcm16k);
  return pcmToMulaw(pcm8k);
}

/**
 * Encode a base64 mulaw payload from Twilio into PCM 16kHz for ElevenLabs
 */
export function decodeTwilioPayload(base64Payload: string): Buffer {
  const mulawBuffer = Buffer.from(base64Payload, 'base64');
  return twilioToElevenLabs(mulawBuffer);
}

/**
 * Encode PCM 16kHz from ElevenLabs into base64 mulaw for Twilio
 */
export function encodeTwilioPayload(pcm16k: Buffer): string {
  const mulawBuffer = elevenLabsToTwilio(pcm16k);
  return mulawBuffer.toString('base64');
}
