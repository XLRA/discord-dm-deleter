import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { SessionData, UpdateCheckResult, UpdateEvent } from "../src/types/discord";

type UpdateListener = (event: UpdateEvent) => void;

contextBridge.exposeInMainWorld("electronAPI", {
  login: (): Promise<SessionData | null> => ipcRenderer.invoke("auth:login"),
  logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
  getSession: (): Promise<SessionData | null> => ipcRenderer.invoke("auth:getSession"),
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke("update:check"),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke("update:quitAndInstall"),
  onUpdateEvent: (listener: UpdateListener): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: UpdateEvent) => listener(payload);
    ipcRenderer.on("update:event", handler);
    return () => ipcRenderer.removeListener("update:event", handler);
  },
});
