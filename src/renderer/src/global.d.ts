import type { WtsApi } from '@shared/types'

declare global {
  interface Window {
    api: WtsApi
  }
}

declare module '*.css'

export {}
