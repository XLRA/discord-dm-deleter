import type { SessionData } from "../src/types/discord";

export interface ElectronAPI {
  login: () => Promise<SessionData | null>;
  logout: () => Promise<void>;
  getSession: () => Promise<SessionData | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
