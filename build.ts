#!/usr/bin/env bun
/**
 * Build script for assistants CLI
 * Bundles the terminal app into a single distributable file
 */

import { $ } from 'bun';

const outdir = './dist';

// Read version from package.json
const packageJson = await Bun.file('./package.json').json();
const version = packageJson.version || 'unknown';

console.log('Building assistants...');

// Clean dist
await $`rm -rf ${outdir}`;
await $`mkdir -p ${outdir}`;

// Bundle with Bun
const result = await Bun.build({
  entrypoints: ['./packages/terminal/src/index.tsx'],
  outdir,
  target: 'bun',
  format: 'esm',
  minify: false, // Keep readable for debugging
  sourcemap: 'external',
  // Embed version at build time
  define: {
    'process.env.ASSISTANTS_VERSION': JSON.stringify(version),
  },
  // Stub out react-devtools-core to avoid window reference errors
  plugins: [
    {
      name: 'stub-devtools',
      setup(build) {
        // Replace react-devtools-core imports with a no-op
        build.onResolve({ filter: /^react-devtools-core$/ }, () => {
          return {
            path: 'react-devtools-core',
            namespace: 'stub',
          };
        });
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
          return {
            contents: 'export default { connectToDevTools: () => {} };',
            loader: 'js',
          };
        });
      },
    },
  ],
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Post-process: fix Bun bundler __promiseAll bug
// Bun 1.3.x generates __promiseAll calls without defining the helper
const outputFile = `${outdir}/index.js`;
let content = await Bun.file(outputFile).text();

if (content.includes('__promiseAll') && !content.includes('var __promiseAll')) {
  const polyfill = `var __promiseAll = (arr) => Promise.all(arr);\n`;
  if (content.startsWith('#!')) {
    const newlineIndex = content.indexOf('\n');
    content = content.slice(0, newlineIndex + 1) + polyfill + content.slice(newlineIndex + 1);
  } else {
    content = polyfill + content;
  }
  console.log('  Fixed __promiseAll bundler bug');
}

// Add shebang to the output if not present
if (!content.startsWith('#!/usr/bin/env bun')) {
  content = `#!/usr/bin/env bun\n${content}`;
}

await Bun.write(outputFile, content);

// Make executable
await $`chmod +x ${outputFile}`;

// Copy only skills and commands (not runtime data like feedback, tasks, schedules)
await $`mkdir -p ${outdir}/.assistants`;
await $`cp -r .assistants/skills ${outdir}/.assistants/skills 2>/dev/null || true`;
await $`cp -r .assistants/commands ${outdir}/.assistants/commands 2>/dev/null || true`;
await $`cp .assistants/ASSISTANTS.md ${outdir}/.assistants/ASSISTANTS.md 2>/dev/null || true`;

// Copy config directory
await $`cp -r config ${outdir}/config 2>/dev/null || true`;

console.log('Build complete! Output in ./dist');
console.log('Files:');
await $`ls -la ${outdir}`;
