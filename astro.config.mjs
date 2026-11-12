// @ts-check
import {defineConfig} from 'astro/config';
import react from '@astrojs/react';

// Static output only: the site is a folder of files served from
// keyboard.codystevens.studio. There is no server and no backend.
export default defineConfig({
  site: 'https://keyboard.codystevens.studio',
  output: 'static',
  integrations: [react()],
  server: {port: 4321, host: '127.0.0.1'},
  devToolbar: {enabled: false},
});
