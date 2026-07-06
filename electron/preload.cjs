const { contextBridge } = require('electron')

// The UI is a plain web app that talks to the local API over HTTP, so it needs almost
// nothing from Electron. We expose a small flag so the UI can tell it's in the desktop shell.
contextBridge.exposeInMainWorld('launchpad', {
  isDesktop: true
})
