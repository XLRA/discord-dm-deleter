import type { SessionData, UpdateCheckResult, UpdateEvent } from "../src/types/discord";

export interface ElectronAPI {
  login: () => Promise<SessionData | null>;
  logout: () => Promise<void>;
  getSession: () => Promise<SessionData | null>;
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  quitAndInstall: () => Promise<void>;
  onUpdateEvent: (listener: (event: UpdateEvent) => void) => () => void;
  setBackgroundActive: (active: boolean) => Promise<{ active: boolean }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
