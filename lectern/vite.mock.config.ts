// The dev server with Claude mocked: /api/deck-assistant runs end to end, through the real SDK and its tool runner,
// against the scripted replies in tests/mock-claude.ts. No API key is needed and nothing leaves the machine.
// npm run dev:mock-ai

import { type UserConfig, defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { mockClaude } from './tests/mock-claude';

export default defineConfig((env) => mergeConfig(typeof base === 'function' ? base(env) as UserConfig : base, { plugins: [mockClaude()] }));
