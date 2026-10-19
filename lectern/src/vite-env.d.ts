/// <reference types="vite/client" />

declare module 'virtual:lectern-plugins' {
  import type { LecternPlugin } from './core/plugins/api';
  const plugins: LecternPlugin[];
  export default plugins;
}
