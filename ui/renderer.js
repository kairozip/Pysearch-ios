const api = window.pyBrowser;
const tabsStrip = document.getElementById('tabs-strip');
const urlInput = document.getElementById('url-input');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const loadingBar = document.getElementById('loading-bar');
const webviewContainer = document.getElementById('webviews');

let activeTabId = null;
let tabCounter = 0;
/** @type {Record<number, { el: HTMLElement, webview: Electron.WebviewTag, incognito: boolean, groupId: string|null }>} */
const tabs = {};
let extensions = [];
let appPaths = null;
let settings = { background: {} };

const GROUP_COLORS = ['#a855f7', '#6366f1', '#22c55e', '#eab308', '#f97316', '#ec4899'];
/** @type {Record<string, { name: string, color: string, collapsed: boolean }>} */
let tabGroups = {};
/** @type {number[]} */
let tabOrder = [];

const STORAGE_GROUPS = 'pysearch-tab-groups-v1';
const STORAGE_ORDER = 'pysearch-tab-order-v1';

// ── ELEMENTS ──────────────────────────────────────────────
const searchOverlay = document.getElementById('search-overlay');
const searchOverlayInput = document.getElementById('search-overlay-input');
const tabSwitcher = document.getElementById('tab-switcher');
const switcherList = document.getElementById('switcher-list');
const settingsPanel = document.getElementById('settings-panel');
const bgBlur = document.getElementById('bg-blur');
const appBg = document.getElementById('app-bg');
const btnSettings = document.getElementById('btn-settings');
const btnSidebarHome = document.getElementById('btn-sidebar-home');
const btnSidebarHistory = document.getElementById('btn-sidebar-history');
const btnSidebarSettings = document.getElementById('btn-sidebar-settings');
const btnSidebarExtensions = document.getElementById('btn-sidebar-extensions');
const btnDownloads = document.getElementById('btn-downloads');
const btnExport = document.getElementById('btn-export-data');
const btnImport = document.getElementById('btn-import-data');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnResetSettings = document.getElementById('btn-reset-settings');
const btnStartScan = document.getElementById('btn-start-scan');
const btnCloseWizard = document.getElementById('btn-close-wizard');
const btnOpenMigrationWizard = document.getElementById('btn-open-migration-wizard');
const btnNewIncognito = document.getElementById('btn-incognito-tab');
const btnNewGroup = document.getElementById('btn-new-tab-group');

const migrationWizard = document.getElementById('migration-wizard');
const migSelection = document.getElementById('migration-selection');
const migScanning = document.getElementById('migration-scanning');
const migProgress = document.getElementById('scan-progress');
const migDetails = document.getElementById('scan-details');
const migStatus = document.getElementById('migration-status');
const migrationDone = document.getElementById('migration-done');
const migrationSummary = document.getElementById('migration-summary');

const privacyCount = document.getElementById('privacy-count');
const ramUsage = document.getElementById('ram-usage');
const cpuUsage = document.getElementById('cpu-usage');
const btnPrivacyShield = document.getElementById('btn-privacy-shield');
const btnPerf = document.getElementById('btn-perf');

const exportFlowOverlay = document.getElementById('export-flow-overlay');
const exportFlowBrowser = document.getElementById('export-flow-browser');
const exportFlowContinue = document.getElementById('export-flow-continue');
const exportFlowCancel = document.getElementById('export-flow-cancel');
const settingAdblock = document.getElementById('setting-adblock-enabled');
const vpnEnabledEl = document.getElementById('vpn-enabled');
const vpnSchemeEl = document.getElementById('vpn-scheme');
const vpnHostEl = document.getElementById('vpn-host');
const vpnPortEl = document.getElementById('vpn-port');
const vpnUserEl = document.getElementById('vpn-user');
const vpnPassEl = document.getElementById('vpn-pass');
const btnSaveNetwork = document.getElementById('btn-save-network');
const btnCheckUpdates = document.getElementById('btn-check-updates');

function nextGroupKey() {
    let max = 0;
    Object.keys(tabGroups).forEach((k) => {
        const m = /^g(\d+)$/.exec(k);
        if (m) max = Math.max(max, Number(m[1]));
    });
    return `g${max + 1}`;
}

function loadTabGroupsState() {
    try {
        const g = sessionStorage.getItem(STORAGE_GROUPS);
        const o = sessionStorage.getItem(STORAGE_ORDER);
        if (g) tabGroups = JSON.parse(g) || {};
        if (o) tabOrder = JSON.parse(o) || [];
    } catch (e) {
        tabGroups = {};
        tabOrder = [];
    }
}

function saveTabGroupsState() {
    try {
        sessionStorage.setItem(STORAGE_GROUPS, JSON.stringify(tabGroups));
        sessionStorage.setItem(STORAGE_ORDER, JSON.stringify(tabOrder));
    } catch (e) {}
}

function countIncognitoTabs() {
    return Object.keys(tabs).filter((id) => tabs[Number(id)].incognito).length;
}

function maybeClearIncognitoSession() {
    if (countIncognitoTabs() === 0 && api.clearIncognitoSession) {
        try {
            api.clearIncognitoSession();
        } catch (e) {}
    }
}

function updateIncognitoChrome() {
    const on = !!(activeTabId && tabs[activeTabId] && tabs[activeTabId].incognito);
    document.body.classList.toggle('incognito-mode', on);
}

function injectExtensions(wv) {
    if (!extensions || !extensions.length) return;
    extensions.forEach((ext) => {
        if (ext && ext.enabled !== false && ext.contentScript) {
            wv.executeJavaScript(ext.contentScript, false).catch(() => {});
        }
    });
}

// ── GOOGLE PROFILE — skipped in private tabs ──────────────
const GOOGLE_PROFILE_SCRIPT = `(function(){
  try {
    function hiRes(src) {
      if (!src || typeof src !== 'string') return null;
      if (src.indexOf('googleusercontent.com') === -1) return src;
      return src.replace(/=s[0-9]+-[a-z]$/i, '=s256-c').replace(/=s[0-9]+$/i, '=s256-c');
    }
    function findAvatar() {
      var selectors = [
        'a[href*="myaccount.google.com"] img[src*="googleusercontent"]',
        'a[href*="accounts.google.com"] img[src*="googleusercontent"]',
        'header img[src*="googleusercontent.com"]',
        'img[src*="/a-/"][src*="googleusercontent"]',
        'img[src*="/a/"][src*="googleusercontent"]',
        'img[data-src*="googleusercontent"]',
        'a[aria-label*="Account"] img[src*="googleusercontent"]',
        'button[aria-label*="Account"] img[src*="googleusercontent"]'
      ];
      var i, el, raw;
      for (i = 0; i < selectors.length; i++) {
        el = document.querySelector(selectors[i]);
        raw = el && (el.src || el.getAttribute('data-src'));
        if (raw && raw.indexOf('googleusercontent.com') !== -1) return hiRes(raw);
      }
      var imgs = document.getElementsByTagName('img');
      for (i = 0; i < imgs.length; i++) {
        var s = imgs[i].src || '';
        if (s.indexOf('googleusercontent.com') !== -1 && (s.indexOf('/a/') !== -1 || s.indexOf('/a-') !== -1))
          return hiRes(s);
      }
      return null;
    }
    function findEmail() {
      var nodes = document.querySelectorAll('a[aria-label*="@gmail.com"],a[aria-label*="@googlemail.com"],button[aria-label*="@gmail.com"],button[aria-label*="@googlemail.com"]');
      var j, label, m;
      for (j = 0; j < nodes.length; j++) {
        label = nodes[j].getAttribute('aria-label') || '';
        m = label.match(/[\\w.+-]+@(gmail\\.com|googlemail\\.com)/i);
        if (m) return m[0];
      }
      nodes = document.querySelectorAll('a[aria-label*="Google Account"],button[aria-label*="Google Account"]');
      for (j = 0; j < nodes.length; j++) {
        label = nodes[j].getAttribute('aria-label') || '';
        m = label.match(/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/i);
        if (m) return m[0];
      }
      return null;
    }
    return { src: findAvatar(), email: findEmail() };
  } catch (e) {
    return { src: null, email: null };
  }
})()`;

function shouldExtractGoogleProfile(pageUrl) {
    try {
        const h = new URL(pageUrl).hostname;
        return (
            h === 'gmail.com' ||
            h.endsWith('.gmail.com') ||
            h.includes('google.com') ||
            h.endsWith('.youtube.com')
        );
    } catch (e) {
        return /google\.com|gmail\.com/i.test(pageUrl);
    }
}

function tryExtractGoogleProfile(wv) {
    if (wv.isDestroyed()) return;
    wv.executeJavaScript(GOOGLE_PROFILE_SCRIPT, false)
        .then((data) => {
            if (data && data.src && api && api.saveGoogleProfile) {
                api.saveGoogleProfile(data.src, data.email || undefined);
            }
        })
        .catch(() => {});
}

function renderTabStrip() {
    if (!tabsStrip) return;
    tabOrder = tabOrder.filter((id) => tabs[id]);
    Object.keys(tabs).forEach((id) => {
        const n = Number(id);
        if (!tabOrder.includes(n)) tabOrder.push(n);
    });

    tabOrder.forEach((id) => {
        const t = tabs[id];
        if (t && t.el && t.el.parentNode) t.el.parentNode.removeChild(t.el);
    });
    while (tabsStrip.firstChild) tabsStrip.removeChild(tabsStrip.firstChild);

    let i = 0;
    while (i < tabOrder.length) {
        const tid = tabOrder[i];
        const t = tabs[tid];
        if (!t) {
            i++;
            continue;
        }
        let gid = t.groupId;
        if (gid && !tabGroups[gid]) {
            t.groupId = null;
            gid = null;
        }
        if (!gid) {
            t.el.style.display = '';
            tabsStrip.appendChild(t.el);
            i++;
            continue;
        }
        const g = tabGroups[gid];
        const wrap = document.createElement('div');
        wrap.className = 'tab-group-wrap';
        wrap.style.borderLeft = `3px solid ${g.color}`;
        wrap.style.background = 'rgba(255,255,255,0.02)';
        const row = document.createElement('div');
        row.className = 'tab-group-tabs';
        const start = i;
        while (i < tabOrder.length && tabs[tabOrder[i]] && tabs[tabOrder[i]].groupId === gid) {
            const tt = tabs[tabOrder[i]];
            if (g.collapsed && i > start) {
                tt.el.style.display = 'none';
            } else {
                tt.el.style.display = '';
            }
            row.appendChild(tt.el);
            i++;
        }
        const head = document.createElement('div');
        head.style.cssText =
            'font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);padding:2px 6px 0;cursor:pointer;user-select:none;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;';
        head.textContent = g.collapsed ? `${g.name} ▸` : g.name;
        head.title = 'Click to collapse or expand group';
        head.onclick = (e) => {
            e.stopPropagation();
            g.collapsed = !g.collapsed;
            saveTabGroupsState();
            renderTabStrip();
        };
        wrap.appendChild(head);
        wrap.appendChild(row);
        tabsStrip.appendChild(wrap);
    }
    saveTabGroupsState();
}

function attachTabDrag(tabEl, id) {
    tabEl.draggable = true;
    tabEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/pysearch-tab', String(id));
        e.dataTransfer.effectAllowed = 'move';
    });
}

function bindTabDropTargets() {
    tabsStrip.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('application/pysearch-tab')) e.preventDefault();
    });
    tabsStrip.addEventListener('drop', (e) => {
        const from = e.dataTransfer.getData('application/pysearch-tab');
        if (!from) return;
        e.preventDefault();
        const fromId = Number(from);
        const target = /** @type {HTMLElement} */ (e.target);
        const tabEl = target && target.closest ? target.closest('.tab') : null;
        if (!tabEl || !tabEl.dataset || !tabEl.dataset.tabId) return;
        const toId = Number(tabEl.dataset.tabId);
        if (!fromId || !toId || fromId === toId) return;
        const toGroup = tabs[toId] ? tabs[toId].groupId : null;
        tabs[fromId].groupId = toGroup;
        const fi = tabOrder.indexOf(fromId);
        const ti = tabOrder.indexOf(toId);
        if (fi >= 0 && ti >= 0) {
            tabOrder.splice(fi, 1);
            const newTi = tabOrder.indexOf(toId);
            tabOrder.splice(newTi, 0, fromId);
        }
        saveTabGroupsState();
        renderTabStrip();
    });
}

function createNewGroupFromActiveTab() {
    if (!activeTabId || !tabs[activeTabId]) return;
    const name = window.prompt('Group name', 'Tab group');
    if (!name || !name.trim()) return;
    const id = nextGroupKey();
    const color = GROUP_COLORS[Object.keys(tabGroups).length % GROUP_COLORS.length];
    tabGroups[id] = { name: name.trim(), color, collapsed: false };
    tabs[activeTabId].groupId = id;
    saveTabGroupsState();
    renderTabStrip();
}

// ── TAB MANAGEMENT ────────────────────────────────────────

/**
 * @param {string} [url]
 * @param {{ incognito?: boolean }} [opts]
 */
function newTab(url, opts) {
    const incognito = !!(opts && opts.incognito);
    const id = ++tabCounter;

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = String(id);
    tabEl.innerHTML = `<span class="tab-title">New Tab</span><span class="tab-close">✕</span>`;

    const wv = document.createElement('webview');
    wv.className = 'tab-webview';
    wv.src = url || appPaths.newTab;
    wv.setAttribute('preload', appPaths.preload);
    wv.setAttribute('partition', incognito ? 'incognito' : 'persist:pysearch');
    webviewContainer.appendChild(wv);

    tabs[id] = { el: tabEl, webview: wv, incognito, groupId: null };
    tabOrder.push(id);
    attachTabDrag(tabEl, id);

    tabEl.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close')) switchTab(id);
    });
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });

    tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const choice = window.prompt('Group: "new" | "clear" | leave empty to cancel', 'new');
        if (choice === 'new') {
            const name = window.prompt('New group name', 'Tabs');
            if (name && name.trim()) {
                const gid = nextGroupKey();
                const color = GROUP_COLORS[Object.keys(tabGroups).length % GROUP_COLORS.length];
                tabGroups[gid] = { name: name.trim(), color, collapsed: false };
                tabs[id].groupId = gid;
                saveTabGroupsState();
                renderTabStrip();
            }
        } else if (choice === 'clear') {
            tabs[id].groupId = null;
            saveTabGroupsState();
            renderTabStrip();
        }
    });

    wv.addEventListener('did-start-loading', () => {
        if (id === activeTabId) {
            loadingBar.classList.add('active');
            loadingBar.style.width = '30%';
        }
    });

    wv.addEventListener('did-stop-loading', () => {
        if (id === activeTabId) {
            loadingBar.style.width = '100%';
            setTimeout(() => {
                loadingBar.classList.remove('active');
                loadingBar.style.width = '0';
            }, 500);
            updateNavBtns();
        }
        injectExtensions(wv);
    });

    wv.addEventListener('did-navigate', (e) => {
        if (id === activeTabId) {
            urlInput.value = e.url.includes('newtab.html') ? '' : e.url;
        }
        if (!e.url.includes('newtab.html')) {
            api.saveHistory({ title: wv.getTitle(), url: e.url, incognito });
        }
    });

    wv.addEventListener('page-title-updated', (e) => {
        tabEl.querySelector('.tab-title').textContent = e.title || 'New Tab';
        if (id === activeTabId && !wv.getURL().includes('newtab.html')) {
            api.saveHistory({ title: e.title, url: wv.getURL(), incognito });
        }
    });

    wv.addEventListener('ipc-message', (e) => {
        if (e.channel === 'navigate' && e.args[0]) {
            navigate(e.args[0]).catch(() => {});
        }
    });

    wv.addEventListener('did-finish-load', () => {
        if (wv.isDestroyed()) return;
        const pageUrl = wv.getURL();
        if (incognito || !shouldExtractGoogleProfile(pageUrl)) return;
        tryExtractGoogleProfile(wv);
        setTimeout(() => tryExtractGoogleProfile(wv), 2800);
    });

    renderTabStrip();
    switchTab(id);
}

function switchTab(id) {
    if (activeTabId && tabs[activeTabId]) {
        tabs[activeTabId].el.classList.remove('active');
        tabs[activeTabId].webview.classList.remove('active');
    }
    activeTabId = id;
    tabs[id].el.classList.add('active');
    tabs[id].webview.classList.add('active');
    tabs[id].webview.focus();
    const currentUrl = tabs[id].webview.getURL();
    urlInput.value = currentUrl.includes('newtab.html') ? '' : currentUrl;
    updateNavBtns();
    updateIncognitoChrome();
}

function pruneEmptyGroups() {
    Object.keys(tabGroups).forEach((gid) => {
        const has = Object.keys(tabs).some((tid) => tabs[Number(tid)].groupId === gid);
        if (!has) delete tabGroups[gid];
    });
}

function closeTab(id) {
    const ids = Object.keys(tabs).map(Number);
    if (ids.length <= 1) return;

    const wasIncognito = tabs[id].incognito;
    tabs[id].el.remove();
    tabs[id].webview.remove();
    delete tabs[id];
    tabOrder = tabOrder.filter((x) => x !== id);
    pruneEmptyGroups();
    saveTabGroupsState();
    renderTabStrip();

    if (activeTabId === id) {
        const remaining = tabOrder.slice();
        if (remaining.length) switchTab(remaining[0]);
    }
    if (wasIncognito) maybeClearIncognitoSession();
}

function updateNavBtns() {
    if (!activeTabId || !tabs[activeTabId]) return;
    const wv = tabs[activeTabId].webview;
    btnBack.disabled = !wv.canGoBack();
    btnForward.disabled = !wv.canGoForward();
}

// ── INITIALIZATION ────────────────────────────────────────

async function init() {
    loadTabGroupsState();
    try {
        appPaths = await api.getAppPaths();
    } catch (e) {
        appPaths = { newTab: 'newtab.html' };
    }
    newTab();
    bindTabDropTargets();

    try {
        extensions = await api.getExtensions() || [];
        settings = await api.getSettings() || { background: {} };
        applySettings(settings);
        fillPrivacyNetworkForm(settings);
        console.log('PySearch Init: Services loaded.');
    } catch (e) {
        console.warn('PySearch Init: Non-critical service failure', e);
    }

    if (ramUsage) ramUsage.textContent = '—';
    if (cpuUsage) cpuUsage.textContent = '—';

    if (api.onPrivacyBlocked) {
        api.onPrivacyBlocked((count) => {
            if (privacyCount) {
                privacyCount.textContent = count;
                privacyCount.style.display = 'block';
                privacyCount.style.transform = 'scale(1.2)';
                setTimeout(() => {
                    privacyCount.style.transform = 'scale(1)';
                }, 200);
            }
        });
    }
}

function fillPrivacyNetworkForm(s) {
    if (!s) return;
    const vpn = s.vpnProxy || {};
    if (settingAdblock) settingAdblock.checked = s.privacy?.adblockEnabled !== false;
    if (vpnEnabledEl) vpnEnabledEl.checked = !!vpn.enabled;
    if (vpnSchemeEl) vpnSchemeEl.value = vpn.scheme === 'socks5' ? 'socks5' : 'http';
    if (vpnHostEl) vpnHostEl.value = vpn.host || '';
    if (vpnPortEl) vpnPortEl.value = vpn.port != null ? String(vpn.port) : '';
    if (vpnUserEl) vpnUserEl.value = vpn.username || '';
    if (vpnPassEl) vpnPassEl.value = vpn.password || '';
}

async function refreshPrivacyNetworkForm() {
    try {
        const s = await api.getSettings() || {};
        settings = { ...settings, ...s };
        fillPrivacyNetworkForm(s);
    } catch (e) {}
}

function applySettings(s) {
    if (!s || !appBg) return;
    const bg = s.background || {};
    if (bg.type === 'color') {
        appBg.style.background = bg.value;
        appBg.style.backgroundImage = 'none';
    } else if (bg.type === 'gradient') {
        appBg.style.backgroundImage = bg.value;
    } else if (bg.type === 'image') {
        appBg.style.backgroundImage = `url('${bg.value}')`;
    } else {
        appBg.style.background = '#0b0b0d';
        appBg.style.backgroundImage = 'none';
    }
}

async function navigate(url) {
    if (!url || !activeTabId || !tabs[activeTabId]) return;
    const wv = tabs[activeTabId].webview;
    let targetUrl = url;
    if (url === 'newtab.html' && appPaths && appPaths.newTab) {
        targetUrl = appPaths.newTab;
    } else if (appPaths && appPaths.newTab && url === appPaths.newTab) {
        targetUrl = appPaths.newTab;
    } else if (api.resolveNavigationUrl) {
        try {
            targetUrl = await api.resolveNavigationUrl(url);
        } catch (e) {
            targetUrl = url;
        }
    }
    if (!targetUrl) return;
    wv.loadURL(targetUrl);
    const display = typeof targetUrl === 'string' && targetUrl.includes('newtab.html') ? '' : targetUrl;
    urlInput.value = display;
}

// ── NAVIGATION CONTROLS ───────────────────────────────────

btnBack.addEventListener('click', () => {
    if (activeTabId && tabs[activeTabId]) tabs[activeTabId].webview.goBack();
});
btnForward.addEventListener('click', () => {
    if (activeTabId && tabs[activeTabId]) tabs[activeTabId].webview.goForward();
});
btnReload.addEventListener('click', () => {
    if (activeTabId && tabs[activeTabId]) tabs[activeTabId].webview.reload();
});

function goHome() {
    if (!appPaths || !appPaths.newTab || !activeTabId || !tabs[activeTabId]) return;
    tabs[activeTabId].webview.loadURL(appPaths.newTab);
    urlInput.value = '';
}

if (btnSidebarHome) btnSidebarHome.addEventListener('click', goHome);

if (btnDownloads) {
    btnDownloads.addEventListener('click', () => {
        if (appPaths && appPaths.downloads && activeTabId && tabs[activeTabId]) {
            tabs[activeTabId].webview.loadURL(appPaths.downloads);
        }
    });
}

if (btnSidebarHistory) {
    btnSidebarHistory.addEventListener('click', () => {
        if (appPaths && appPaths.history && activeTabId && tabs[activeTabId]) {
            tabs[activeTabId].webview.loadURL(appPaths.history);
        }
    });
}

if (btnSidebarExtensions) {
    btnSidebarExtensions.addEventListener('click', () => {
        if (appPaths && appPaths.extensions && activeTabId && tabs[activeTabId]) {
            tabs[activeTabId].webview.loadURL(appPaths.extensions);
        }
    });
}

if (btnSidebarSettings) {
    btnSidebarSettings.addEventListener('click', () => {
        settingsPanel.classList.add('active');
        bgBlur.classList.add('active');
    });
}

if (btnNewIncognito) {
    btnNewIncognito.addEventListener('click', () => newTab(undefined, { incognito: true }));
}
if (btnNewGroup) {
    btnNewGroup.addEventListener('click', () => createNewGroupFromActiveTab());
}

// ── OVERLAYS LOGIC (2026) ─────────────────────────────────

api.onToggleSearch(() => {
    const isActive = searchOverlay.classList.toggle('active');
    bgBlur.classList.toggle('active', isActive);
    if (isActive) {
        searchOverlayInput.focus();
        searchOverlayInput.value = '';
    }
});

api.onToggleSwitcher(() => {
    const isActive = tabSwitcher.classList.toggle('active');
    bgBlur.classList.toggle('active', isActive);
    if (isActive) {
        const keys = Object.keys(tabs)
            .map(Number)
            .sort((a, b) => a - b);
        switcherIndex = Math.max(0, keys.indexOf(activeTabId));
        populateTabSwitcher();
    }
});

function populateTabSwitcher() {
    switcherList.innerHTML = '';
    Object.keys(tabs).forEach((id) => {
        const tab = tabs[id];
        const item = document.createElement('div');
        item.className = `switcher-item ${Number(id) === activeTabId ? 'active' : ''}`;
        const title = tab.webview.getTitle() || 'New Tab';
        const priv = tab.incognito ? '<span style="font-size:10px;color:#c4b5fd;margin-left:6px;">Private</span>' : '';
        item.innerHTML = `
            <div class="switcher-info">
                <div class="switcher-title">${title}${priv}</div>
            </div>
        `;
        item.onclick = () => {
            switchTab(Number(id));
            closeOverlays();
        };
        switcherList.appendChild(item);
    });
}

function resetMigrationWizard() {
    if (migSelection) migSelection.style.display = 'block';
    if (migScanning) migScanning.style.display = 'none';
    if (migrationDone) migrationDone.style.display = 'none';
    if (migProgress) migProgress.style.width = '0%';
    if (btnStartScan) btnStartScan.style.display = '';
    if (btnCloseWizard) btnCloseWizard.textContent = 'Close';
}

function closeOverlays() {
    searchOverlay.classList.remove('active');
    tabSwitcher.classList.remove('active');
    if (exportFlowOverlay) exportFlowOverlay.classList.remove('active');
    if (migrationWizard) migrationWizard.classList.remove('active');
    bgBlur.classList.remove('active');
    resetMigrationWizard();
}

bgBlur.onclick = closeOverlays;

searchOverlayInput.onkeydown = async (e) => {
    if (e.key === 'Enter') {
        const val = searchOverlayInput.value.trim();
        if (val) {
            await navigate(val);
            closeOverlays();
        }
    }
    if (e.key === 'Escape') closeOverlays();
};

// ── SETTINGS & MIGRATION ──────────────────────────────────

btnSettings.onclick = () => {
    settingsPanel.classList.add('active');
    bgBlur.classList.add('active');
    refreshPrivacyNetworkForm();
};

btnCloseSettings.onclick = () => {
    settingsPanel.classList.remove('active');
    bgBlur.classList.remove('active');
};

document.getElementById('set-bg-color').onclick = () => {
    const color = prompt('Enter a Hex color (e.g. #ff0000):', '#0b0b0d');
    if (color) {
        settings.background = { type: 'color', value: color };
        applySettings(settings);
        api.saveSettings(settings);
    }
};

document.getElementById('set-bg-grad').onclick = () => {
    const grad = 'linear-gradient(135deg, #1c1c1e 0%, #0b0b0d 100%)';
    settings.background = { type: 'gradient', value: grad };
    applySettings(settings);
    api.saveSettings(settings);
};

document.getElementById('set-bg-img').onclick = () => {
    const url = prompt('Enter image URL:');
    if (url) {
        settings.background = { type: 'image', value: url };
        applySettings(settings);
        api.saveSettings(settings);
    }
};

btnResetSettings.onclick = async () => {
    const prev = await api.getSettings() || {};
    prev.background = {};
    settings = prev;
    applySettings(settings);
    api.saveSettings(prev);
};

if (btnSaveNetwork) {
    btnSaveNetwork.onclick = async () => {
        const prev = await api.getSettings() || {};
        prev.privacy = { ...(prev.privacy || {}), adblockEnabled: settingAdblock ? settingAdblock.checked : true };
        prev.vpnProxy = {
            enabled: !!(vpnEnabledEl && vpnEnabledEl.checked),
            scheme: vpnSchemeEl && vpnSchemeEl.value === 'socks5' ? 'socks5' : 'http',
            host: (vpnHostEl && vpnHostEl.value.trim()) || '',
            port: (vpnPortEl && vpnPortEl.value.trim()) || '',
            username: (vpnUserEl && vpnUserEl.value.trim()) || '',
            password: (vpnPassEl && vpnPassEl.value) || ''
        };
        settings = prev;
        api.saveSettings(prev);
    };
}

const syncServerUrlEl = document.getElementById('sync-server-url');
const syncTokenEl = document.getElementById('sync-token');
const syncPassphraseEl = document.getElementById('sync-passphrase');
const btnSyncPush = document.getElementById('btn-sync-push');
const btnSyncPull = document.getElementById('btn-sync-pull');

if (btnSyncPush && api.syncPushRemote) {
    btnSyncPush.onclick = async () => {
        const baseUrl = (syncServerUrlEl && syncServerUrlEl.value.trim()) || '';
        const token = (syncTokenEl && syncTokenEl.value.trim()) || '';
        const passphrase = (syncPassphraseEl && syncPassphraseEl.value) || '';
        const res = await api.syncPushRemote({ baseUrl, token, passphrase });
        window.alert(res && res.ok ? 'Upload OK.' : res.error || 'Upload failed.');
    };
}
if (btnSyncPull && api.syncPullRemote) {
    btnSyncPull.onclick = async () => {
        const baseUrl = (syncServerUrlEl && syncServerUrlEl.value.trim()) || '';
        const token = (syncTokenEl && syncTokenEl.value.trim()) || '';
        const passphrase = (syncPassphraseEl && syncPassphraseEl.value) || '';
        const res = await api.syncPullRemote({ baseUrl, token, passphrase });
        window.alert(res && res.ok ? 'Merged vault into this profile.' : res.error || 'Pull failed.');
    };
}

if (btnCheckUpdates && api.checkForUpdates) {
    btnCheckUpdates.onclick = async () => {
        const res = await api.checkForUpdates();
        if (!res || !res.ok) {
            window.alert((res && res.message) || 'Could not check for updates.');
            return;
        }
        window.alert(
            res.version
                ? `Update available: ${res.version}. It will download in the background; you will be asked to restart when ready.`
                : 'You are up to date (or the update server returned no newer build).'
        );
    };
}

if (api.onUpdateStatus) {
    api.onUpdateStatus((p) => {
        if (p && p.state === 'available' && p.version) {
            console.log('Update available:', p.version);
        }
    });
}

if (exportFlowCancel && exportFlowOverlay) {
    exportFlowCancel.onclick = () => {
        exportFlowOverlay.classList.remove('active');
        bgBlur.classList.remove('active');
    };
}

if (exportFlowContinue && exportFlowOverlay) {
    exportFlowContinue.onclick = async () => {
        const key = exportFlowBrowser ? exportFlowBrowser.value : '';
        exportFlowOverlay.classList.remove('active');
        bgBlur.classList.remove('active');
        if (key) {
            const res = await api.importFromBrowser(key);
            if (res && typeof res === 'number') {
                alert(
                    `Imported ${res} file(s) from your old browser profile into PySearch.\n` +
                        'Restart PySearch if bookmarks or logins do not appear yet.\n\n' +
                        'Next, choose where to save your backup file.'
                );
            } else if (res && res.error) {
                alert(`Could not read old browser data: ${res.error}\n\nContinuing with export only…`);
            } else {
                alert(
                    'No files were copied. Close the other browser completely and ensure it is installed on this PC.\n\n' +
                        'Continuing with export…'
                );
            }
        }
        const exportRes = await api.exportData();
        if (exportRes && exportRes.success) {
            alert(`Backup saved. ${exportRes.count} history entries in the JSON file.`);
        } else if (exportRes && exportRes.error) alert(`Export failed: ${exportRes.error}`);
    };
}

btnExport.onclick = async () => {
    if (exportFlowBrowser) exportFlowBrowser.value = '';
    if (exportFlowOverlay) exportFlowOverlay.classList.add('active');
    bgBlur.classList.add('active');
};

btnImport.onclick = async () => {
    const res = await api.importData();
    if (res && res.success) {
        alert('Import successful! The browser will now restart.');
    } else if (res && res.error) {
        alert(`Import failed: ${res.error}`);
    }
};

async function populateMigrationBrowserList() {
    const list = document.getElementById('wizard-browser-list');
    if (!list) return;
    list.innerHTML = '';
    let rows = [];
    try {
        rows = (await api.detectBrowsers()) || [];
    } catch (e) {
        rows = [];
    }
    if (!rows.length) {
        list.innerHTML = '<span style="font-size:12px;color:var(--muted)">Could not detect browsers.</span>';
        return;
    }
    rows.forEach((r) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;';
        row.style.opacity = r.found ? '1' : '0.5';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'wiz-browsers';
        cb.value = r.key;
        cb.checked = !!r.found;
        cb.disabled = !r.found;
        const span = document.createElement('span');
        span.textContent = r.name;
        row.appendChild(cb);
        row.appendChild(span);
        if (!r.found) {
            const hint = document.createElement('span');
            hint.style.cssText = 'font-size:11px;color:var(--muted)';
            hint.textContent = '(not found)';
            row.appendChild(hint);
        }
        list.appendChild(row);
    });
}

if (btnOpenMigrationWizard && migrationWizard) {
    btnOpenMigrationWizard.addEventListener('click', async () => {
        settingsPanel.classList.remove('active');
        migrationWizard.classList.add('active');
        bgBlur.classList.add('active');
        resetMigrationWizard();
        if (migStatus) migStatus.textContent = 'Select browsers to import, then start.';
        await populateMigrationBrowserList();
    });
}

if (btnStartScan) {
    btnStartScan.onclick = async () => {
        const boxes = document.querySelectorAll('#wizard-browser-list input[name="wiz-browsers"]:checked');
        const keys = Array.from(boxes).map((b) => b.value);
        if (!keys.length) {
            if (migStatus) migStatus.textContent = 'Select at least one available browser.';
            return;
        }
        if (migSelection) migSelection.style.display = 'none';
        if (migScanning) migScanning.style.display = 'block';
        if (migrationDone) migrationDone.style.display = 'none';
        const steps = [
            'Scanning AppData paths…',
            'Locating browser profiles…',
            'Reading bookmarks & history stores…',
            'Copying cookies & web data (best-effort)…',
            'Merging into PySearch storage…',
            'Done.'
        ];
        for (let i = 0; i < steps.length; i++) {
            if (migDetails) migDetails.textContent = steps[i];
            if (migProgress) migProgress.style.width = `${((i + 1) / steps.length) * 100}%`;
            await new Promise((r) => setTimeout(r, 450));
        }
        let res = { count: 0, errors: [] };
        try {
            res = await api.importBrowsers(keys);
        } catch (e) {
            res = { count: 0, errors: [e.message || 'Import failed'] };
        }
        if (migScanning) migScanning.style.display = 'none';
        if (migrationDone) migrationDone.style.display = 'block';
        const errTxt = res.errors && res.errors.length ? res.errors.join('\n') : '';
        if (migrationSummary) {
            migrationSummary.innerHTML =
                `<div>Files copied / merged (best-effort): <strong>${res.count != null ? res.count : 0}</strong></div>` +
                (errTxt ? `<div style="margin-top:10px;color:#f87171;white-space:pre-wrap;font-size:12px;">${escapeHtmlMigration(
                      errTxt
                  )}</div>` : '') +
                `<div style="margin-top:12px;font-size:12px;color:var(--muted)">Restart PySearch if bookmarks or logins do not appear immediately.</div>`;
        }
        if (migStatus) migStatus.textContent = 'Import finished.';
        if (btnStartScan) btnStartScan.style.display = 'none';
        if (btnCloseWizard) btnCloseWizard.textContent = 'Done';
    };
}

function escapeHtmlMigration(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

if (btnCloseWizard) {
    btnCloseWizard.onclick = () => {
        migrationWizard.classList.remove('active');
        bgBlur.classList.remove('active');
        resetMigrationWizard();
    };
}

// Tab switcher: ↑ ↓ Enter Esc
let switcherIndex = 0;
document.addEventListener(
    'keydown',
    (e) => {
        if (!tabSwitcher.classList.contains('active')) return;
        const items = document.querySelectorAll('.switcher-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            switcherIndex = (switcherIndex + 1) % items.length;
            updateSwitcherSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            switcherIndex = (switcherIndex - 1 + items.length) % items.length;
            updateSwitcherSelection(items);
        } else if (e.key === 'Enter' && items[switcherIndex]) {
            e.preventDefault();
            items[switcherIndex].click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeOverlays();
        }
    },
    true
);

function updateSwitcherSelection(items) {
    items.forEach((item, idx) => {
        if (idx === switcherIndex) item.classList.add('active');
        else item.classList.remove('active');
        if (idx === switcherIndex) item.scrollIntoView({ block: 'nearest' });
    });
}

const btnBrowserImport = document.getElementById('btn-browser-import');
const browserSelect = document.getElementById('import-browser-select');

if (btnBrowserImport) {
    btnBrowserImport.onclick = async () => {
        const browser = browserSelect.value;
        if (confirm(`Import data from ${browser}? This will copy your history and bookmarks to PySearch.`)) {
            const res = await api.importFromBrowser(browser);
            if (res && typeof res === 'number') alert(`Import successful! ${res} files migrated.`);
            else if (res && res.error) alert(`Import failed: ${res.error}`);
        }
    };
}

api.onGoBack(() => tabs[activeTabId] && tabs[activeTabId].webview.goBack());
api.onGoForward(() => tabs[activeTabId] && tabs[activeTabId].webview.goForward());
api.onRefresh(() => tabs[activeTabId] && tabs[activeTabId].webview.reload());
api.onNewTab(() => newTab());
api.onGoHome(() => goHome());
api.onCloseTab(() => closeTab(activeTabId));
api.onOpenSettings(() => {
    settingsPanel.classList.add('active');
    bgBlur.classList.add('active');
});
api.onOpenHistory(() => {
    if (appPaths && appPaths.history && tabs[activeTabId]) {
        tabs[activeTabId].webview.loadURL(appPaths.history);
    }
});
api.onOpenInfo(() => document.getElementById('info-overlay').classList.add('active'));

api.onSaveAsHtml(async () => {
    const wv = tabs[activeTabId].webview;
    const html = await wv.executeJavaScript('document.documentElement.outerHTML');
    const title = await wv.getTitle();
    api.performSaveAsHtml({ html, title });
});

urlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const raw = urlInput.value.trim();
        if (!raw) return;
        await navigate(raw);
        urlInput.blur();
    }
});

document.getElementById('new-tab-btn').addEventListener('click', () => newTab());
document.getElementById('btn-min').addEventListener('click', () => api.windowMinimize());
document.getElementById('btn-max').addEventListener('click', () => api.windowMaximize());
document.getElementById('btn-close').addEventListener('click', () => api.windowClose());

if (btnPrivacyShield) {
    btnPrivacyShield.onclick = () => {
        alert('PySearch Protective Shield is ACTIVE. Total Trackers Blocked: ' + (privacyCount ? privacyCount.textContent : '0'));
    };
}

if (btnPerf) {
    btnPerf.onclick = () => {
        alert('Performance: inactive tabs stay attached for instant switching; animations are CSS-only.');
    };
}

/** Safe AI tool runner — only whitelisted actions; user confirms each step */
async function runConfirmedAgentActions(actions) {
    const allowed = new Set([
        'open_tab',
        'close_tab',
        'switch_tab',
        'bookmark_page',
        'search',
        'summarize_page',
        'list_tabs'
    ]);
    for (const a of actions || []) {
        if (!a || !a.tool || !allowed.has(a.tool)) continue;
        const ok = window.confirm(`Allow browser action: ${a.tool}\n${JSON.stringify(a.args || {}, null, 2)}`);
        if (!ok) continue;
        const args = a.args || {};
        switch (a.tool) {
            case 'open_tab':
                if (args.url) newTab(args.url);
                break;
            case 'close_tab':
                if (args.id != null && tabs[Number(args.id)]) closeTab(Number(args.id));
                else if (activeTabId) closeTab(activeTabId);
                break;
            case 'switch_tab':
                if (args.id != null && tabs[Number(args.id)]) switchTab(Number(args.id));
                break;
            case 'search':
                if (args.query) await navigate(String(args.query));
                break;
            case 'list_tabs': {
                const lines = Object.keys(tabs).map((id) => `${id}: ${tabs[id].webview.getTitle() || 'Tab'}`);
                window.alert(lines.join('\n') || 'No tabs');
                break;
            }
            case 'bookmark_page':
                window.alert(
                    'Bookmarks vault is not wired in this build. Current URL: ' +
                        (tabs[activeTabId] && tabs[activeTabId].webview.getURL())
                );
                break;
            case 'summarize_page': {
                const wv = tabs[activeTabId] && tabs[activeTabId].webview;
                if (!wv) break;
                try {
                    const t = await wv.executeJavaScript(
                        `(function(){var b=document.body;if(!b)return'';return b.innerText.slice(0,4000);})()`
                    );
                    const s = (t || '').slice(0, 2000);
                    window.alert(s + ((t && t.length > 2000) ? '…' : ''));
                } catch (e) {
                    window.alert('Could not read page text.');
                }
                break;
            }
            default:
                break;
        }
    }
}

window.__ckApplyAgentActions = runConfirmedAgentActions;

init();
