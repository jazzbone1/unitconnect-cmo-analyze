import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 정적 사이트 빌드. GitHub Pages 하위 경로 배포를 위해 base는 상대 경로로.
export default defineConfig({
  plugins: [react()],
  base: './',
})
