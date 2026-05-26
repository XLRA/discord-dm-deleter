import { contextBridge, ipcRenderer } from "electron";
import type { SessionData } from "../src/types/discord";

contextBridge.exposeInMainWorld("electronAPI", {
  login: (): Promise<SessionData | null> => ipcRenderer.invoke("auth:login"),
  logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
  getSession: (): Promise<SessionData | null> => ipcRenderer.invoke("auth:getSession"),
});
