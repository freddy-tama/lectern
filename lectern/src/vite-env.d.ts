/// <reference types="vite/client" />

/** package.json's version, set by vite.config.ts. */
declare const __APP_VERSION__: string;

declare module 'virtual:lectern-plugins' {
  import type { LecternPlugin } from './core/plugins/api';
  const plugins: LecternPlugin[];
  export default plugins;
}
