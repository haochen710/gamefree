import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 会把站点放在 https://<用户名>.github.io/<仓库名>/ 这个子路径下，
// 所以 base 必须写成 "/<仓库名>/"，否则打包后的 js/css 全部 404。
//
// ⚠️ 仓库名改了的话，这里（以及 README 里的网址）要一起改。
// 如果这个仓库名就叫 <用户名>.github.io，则改成 base: '/'
export default defineConfig({
  base: '/gamefree/',
  plugins: [react()],
  server: {
    port: 5173,
    // 本地开发地址就是 http://localhost:5173/gamefree/
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
