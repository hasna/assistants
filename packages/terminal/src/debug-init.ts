#!/usr/bin/env bun
// Debug script to identify initialization bottleneck
// Run with: bun run packages/terminal/src/debug-init.ts
import { setRuntime } from '@hasna/assistants-core';
import { bunRuntime } from '@hasna/runtime-bun';

setRuntime(bunRuntime);

import { SessionRegistry } from '@hasna/assistants-core';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function debugInit() {
  const cwd = process.cwd();
  log('Starting initialization debug...');
  log(`CWD: ${cwd}`);
  log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'}`);

  const startTotal = Date.now();

  log('\n[1] Creating SessionRegistry...');
  const start1 = Date.now();
  const registry = new SessionRegistry();
  log(`    Done in ${Date.now() - start1}ms`);

  log('\n[2] Creating session (includes AssistantLoop.initialize)...');
  log('    This includes: config load, skill load, hook load, LLM client, identity system');
  const start2 = Date.now();

  // Set a timeout warning
  const warnTimeout = setTimeout(() => {
    log('    WARNING: Session creation taking longer than 5 seconds...');
    log('    This may indicate a hanging connector or network issue.');
  }, 5000);

  try {
    const session = await registry.createSession(cwd);
    clearTimeout(warnTimeout);
    log(`    Done in ${Date.now() - start2}ms`);
    log(`    Session ID: ${session.id}`);

    log('\n[3] Getting skills...');
    const start3 = Date.now();
    const skills = await session.client.getSkills();
    log(`    Done in ${Date.now() - start3}ms`);
    log(`    Skills count: ${skills.length}`);

    log('\n[4] Getting commands...');
    const start4 = Date.now();
    const commands = await session.client.getCommands();
    log(`    Done in ${Date.now() - start4}ms`);
    log(`    Commands count: ${commands.length}`);

    log('\n[5] Getting energy state...');
    const start5 = Date.now();
    const energy = session.client.getEnergyState();
    log(`    Done in ${Date.now() - start5}ms`);
    log(`    Energy: ${JSON.stringify(energy)}`);

    log('\n========================================');
    log(`TOTAL: ${Date.now() - startTotal}ms`);
    log('========================================');

    if (Date.now() - startTotal > 1000) {
      log('\nWARNING: Initialization took longer than 1 second.');
      log('This may cause the "Initializing..." message to persist.');
    } else {
      log('\nInitialization is fast. If you see "Initializing..." stuck,');
      log('the issue may be with the Ink/React rendering, not initialization.');
    }

    registry.closeAll();
    process.exit(0);
  } catch (err) {
    clearTimeout(warnTimeout);
    log('\nERROR during initialization:');
    console.error(err);
    log(`\nFailed after ${Date.now() - start2}ms`);
    process.exit(1);
  }
}

debugInit();
