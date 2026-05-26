/// <reference types="vite/client" />

import type { ElectronAPI } from "../electron/types";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
