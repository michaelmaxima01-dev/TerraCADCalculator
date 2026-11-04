import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss()],
  // Worker em módulo ES: permite carregar o leitor de DWG (WebAssembly) só quando necessário.
  worker: {format: 'es'},
  build: {rollupOptions: {output: {manualChunks: {three: ['three'], react: ['react', 'react-dom']}}}}
});
