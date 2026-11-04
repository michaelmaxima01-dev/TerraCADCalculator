import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[tailwindcss()],build:{rollupOptions:{output:{manualChunks:{three:['three'],react:['react','react-dom']}}}}});
