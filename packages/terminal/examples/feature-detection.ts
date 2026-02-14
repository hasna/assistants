#!/usr/bin/env bun
/**
 * Feature Detection Example
 *
 * This example shows how to check which features are available
 * based on the current environment configuration.
 *
 * Usage:
 *   bun run examples/feature-detection.ts
 *
 * This script doesn't require any API keys - it just checks
 * what's configured in the environment.
 */

import {
  getFeatureAvailability,
  getFeatureStatusMessage,
  isAWSConfigured,
  isElevenLabsConfigured,
  isOpenAIConfigured,
  isExaConfigured,
  isSystemVoiceAvailable,
} from '../src/lib';

function main() {
  console.log('=== Feature Detection ===\n');

  // Get full feature status message
  console.log(getFeatureStatusMessage());

  console.log('\n=== Detailed Checks ===\n');

  // Individual checks
  const checks = [
    { name: 'ANTHROPIC_API_KEY', fn: () => !!process.env.ANTHROPIC_API_KEY },
    { name: 'AWS configured', fn: isAWSConfigured },
    { name: 'ElevenLabs TTS', fn: isElevenLabsConfigured },
    { name: 'OpenAI/Whisper STT', fn: isOpenAIConfigured },
    { name: 'Exa Search', fn: isExaConfigured },
    { name: 'System Voice (macOS)', fn: isSystemVoiceAvailable },
  ];

  for (const check of checks) {
    const status = check.fn() ? '✓' : '○';
    console.log(`${status} ${check.name}`);
  }

  console.log('\n=== Feature Availability Object ===\n');

  // Get structured availability data
  const features = getFeatureAvailability();
  console.log(JSON.stringify(features, null, 2));

  console.log('\n=== Usage Recommendations ===\n');

  if (!features.coreChat) {
    console.log('⚠️  Set ANTHROPIC_API_KEY to use the assistant:');
    console.log('   export ANTHROPIC_API_KEY="sk-ant-..."');
  } else {
    console.log('✓ Ready to use the assistant!');
  }

  if (!features.awsFeatures) {
    console.log('\nOptional: Set AWS credentials for inbox/wallet/secrets:');
    console.log('   export AWS_ACCESS_KEY_ID="..."');
    console.log('   export AWS_SECRET_ACCESS_KEY="..."');
    console.log('   export AWS_REGION="us-east-1"');
  }

  if (!features.elevenLabsTTS && !features.systemVoice) {
    console.log('\nOptional: Set ELEVENLABS_API_KEY for high-quality TTS');
  }

  if (!features.whisperSTT) {
    console.log('\nOptional: Set OPENAI_API_KEY for Whisper speech-to-text');
  }

  if (!features.exaSearch) {
    console.log('\nOptional: Set EXA_API_KEY for enhanced web search');
  }
}

main();
