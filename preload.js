const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pyBrowser', {
  // Navigation for webviews (to be called by newtab.html)
  sendToHost: (channel, data) => ipcRenderer.sendToHost(channel, data),

  // Extensions
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  importExtensionZip: () => ipcRenderer.invoke('import-extension-zip'),
  setExtensionEnabled: (extId, enabled) => ipcRenderer.invoke('set-extension-enabled', extId, enabled),
  deleteExtension: (extId) => ipcRenderer.invoke('delete-extension', extId),
  clearIncognitoSession: () => ipcRenderer.send('clear-incognito-session'),

  // History & Persistence (2026)
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveHistory: (item) => ipcRenderer.send('save-history', item),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  
  // Downloads (2026)
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  openDownloads: () => ipcRenderer.send('open-downloads'),
  openPath: (p) => ipcRenderer.send('open-path', p),

  // Customization & Migration (2026)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.send('save-settings', s),
  saveGoogleProfile: (url, email) => ipcRenderer.send('google-profile-detected', { url, email }),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (event, s) => cb(s)),
  onPrivacyBlocked: (cb) => ipcRenderer.on('privacy-blocked', (event, count) => cb(count)),
  onOpenHistory: (cb) => { if (cb) cb(); else ipcRenderer.send('navigate-to-history'); },
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  importFromBrowser: (b) => ipcRenderer.invoke('import-from-browser', b),
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),
  importBrowsers: (keys) => ipcRenderer.invoke('import-browsers', keys),
  resolveNavigationUrl: (input) => ipcRenderer.invoke('resolve-navigation-url', input),

  // Global Shortcut Events
  onToggleSearch: (cb) => ipcRenderer.on('toggle-search-overlay', cb),
  onToggleSwitcher: (cb) => ipcRenderer.on('toggle-tab-switcher', cb),
  onGoBack: (cb) => ipcRenderer.on('go-back', cb),
  onGoForward: (cb) => ipcRenderer.on('go-forward', cb),
  onRefresh: (cb) => ipcRenderer.on('refresh-page', cb),
  onNewTab: (cb) => ipcRenderer.on('new-tab', cb),
  onGoHome: (cb) => ipcRenderer.on('go-home', cb),
  onCloseTab: (cb) => ipcRenderer.on('close-tab', cb),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', cb),
  onOpenInfo: (cb) => ipcRenderer.on('open-info', cb),
  onSaveAsHtml: (cb) => ipcRenderer.on('save-page-as-html', cb),
  performSaveAsHtml: (data) => ipcRenderer.send('perform-save-as-html', data),

  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  
  // App Info
  getAppPaths: () => ipcRenderer.invoke('get-app-paths'),
  getVersion: () => '1.0.0',
  getCopyright: () => '© 2026 PySearch',

  // AI agent (safe JSON tools; main may call remote CHROME_KILLER_AI_URL)
  aiAgentQuery: (payload) => ipcRenderer.invoke('ai-agent-query', payload),
  onToggleAi: (cb) => ipcRenderer.on('toggle-ai-sidebar', () => cb()),

  // Encrypted sync (client AES vault; server stores opaque blob)
  syncBuildLocalBundle: () => ipcRenderer.invoke('sync-build-local-bundle'),
  syncEncryptBundle: (passphrase, bundle) => ipcRenderer.invoke('sync-encrypt-bundle', { passphrase, bundle }),
  syncDecryptMerge: (vault, passphrase) => ipcRenderer.invoke('sync-decrypt-merge', { vault, passphrase }),
  syncPushRemote: (opts) => ipcRenderer.invoke('sync-push-remote', opts),
  syncPullRemote: (opts) => ipcRenderer.invoke('sync-pull-remote', opts),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, payload) => cb(payload))
});

/**
 * Keyboard shortcuts work from the shell and from inside <webview> tabs (where
 * globalShortcut does not reach). Main process forwards to the browser UI.
 */
function shortcutFromKeydown(e) {
  const cmd = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  const shift = e.shiftKey;
  const meta = e.metaKey;
  const k = e.key;

  if (cmd && alt && !shift && (k === 'a' || k === 'A')) return 'back';
  if (cmd && alt && !shift && (k === 'd' || k === 'D')) return 'forward';
  if (cmd && !alt && !shift && (k === 'r' || k === 'R')) return 'refresh';
  if (cmd && !alt && !shift && (k === 'n' || k === 'N')) return 'new-tab';
  if (cmd && !alt && !shift && (k === 'h' || k === 'H')) return 'home';
  if (cmd && !alt && !shift && (k === 'w' || k === 'W')) return 'close-tab';
  if (cmd && !alt && !shift && (k === 's' || k === 'S')) return 'settings';
  if (cmd && !alt && !shift && (k === 'i' || k === 'I')) return 'info';
  if (cmd && !alt && !shift && (k === 'l' || k === 'L')) return 'search';
  if (cmd && !alt && !shift && k === 'Tab') return 'tab-switcher';
  if (cmd && shift && alt && meta && (k === 'c' || k === 'C')) return 'save-html';
  if (cmd && shift && !alt && (k === 'y' || k === 'Y')) return 'toggle-ai';
  return null;
}

window.addEventListener(
  'keydown',
  (e) => {
    const action = shortcutFromKeydown(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send('shortcut-action', action);
  },
  true
);
