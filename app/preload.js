// Preload for both the main shell window and the settings window. Exposes a
// single privileged surface (window.paperBridge) over IPC. contextIsolation is
// on, so the page's main world only ever sees this frozen object — never node.

const { contextBridge, ipcRenderer } = require("electron");

// Fan-out so the sidebar renderer and any other subscriber can both listen.
const progressSubs = new Set();
ipcRenderer.on("paper:progress", (_e, evt) => {
  for (const cb of progressSubs) {
    try {
      cb(evt);
    } catch {}
  }
});

contextBridge.exposeInMainWorld("paperBridge", {
  // jobs
  read: (payload) => ipcRenderer.invoke("paper:read", payload),
  cancel: (jobId) => ipcRenderer.invoke("paper:cancel", jobId),
  listJobs: () => ipcRenderer.invoke("job:list"),
  openFolder: (jobId) => ipcRenderer.invoke("job:openFolder", jobId),
  openInObsidian: (jobId) => ipcRenderer.invoke("job:openInObsidian", jobId),
  // already-read indicator + manual 已读 toggle (writes the note's checkbox)
  readPapers: () => ipcRenderer.invoke("vault:readPapers"),
  openNote: (relNoExt) => ipcRenderer.invoke("vault:openNote", relNoExt),
  setReadStatus: (relNoExt, read) => ipcRenderer.invoke("vault:setReadStatus", relNoExt, read),
  // settings / env
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  probeEnv: () => ipcRenderer.invoke("env:probe"),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  pickVault: () => ipcRenderer.invoke("settings:pickVault"),
  pickClaude: () => ipcRenderer.invoke("settings:pickClaude"),
  // arxiv metadata (read-modal 加入 Zotero, link/ID path)
  arxivMeta: (idOrUrl) => ipcRenderer.invoke("arxiv:meta", idOrUrl),
  // in-app tabs + external links
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onOpenTab: (cb) => {
    const h = (_e, url) => {
      try {
        cb(url);
      } catch {}
    };
    ipcRenderer.on("open-tab", h);
    return () => ipcRenderer.removeListener("open-tab", h);
  },
  // progress subscription; returns an unsubscribe fn (created in this world)
  onProgress: (cb) => {
    progressSubs.add(cb);
    return () => progressSubs.delete(cb);
  },
});
