const { ipcMain, app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SALT = 'chrome-killer-sync-v1';

function keyFromPassphrase(passphrase) {
    return crypto.scryptSync(String(passphrase || 'changeme'), SALT, 32);
}

function encryptVault(plaintext, passphrase) {
    const key = keyFromPassphrase(passphrase);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptVault(b64, passphrase) {
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const key = keyFromPassphrase(passphrase);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function readJsonFile(p) {
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return null;
    }
}

function buildLocalBundleObject() {
    const ud = app.getPath('userData');
    return {
        v: 1,
        exportedAt: new Date().toISOString(),
        history: readJsonFile(path.join(ud, 'history.json')),
        settings: readJsonFile(path.join(ud, 'settings.json'))
    };
}

function mergeDecryptedJsonIntoProfile(jsonStr) {
    let obj;
    try {
        obj = JSON.parse(jsonStr);
    } catch (e) {
        return { ok: false, error: 'Invalid JSON after decrypt.' };
    }
    const ud = app.getPath('userData');
    if (Array.isArray(obj.history)) {
        fs.writeFileSync(path.join(ud, 'history.json'), JSON.stringify(obj.history, null, 2));
    }
    if (obj.settings && typeof obj.settings === 'object') {
        const cur = readJsonFile(path.join(ud, 'settings.json')) || {};
        const merged = { ...cur, ...obj.settings, updatedAt: Date.now() };
        fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(merged, null, 2));
    }
    return { ok: true };
}

function hostnameId() {
    try {
        return os.hostname();
    } catch (e) {
        return 'device';
    }
}

/**
 * @param {{ getMainWindow: Function, readSettingsFromDisk: Function }} _ctx
 */
function registerSyncIpc(_ctx) {
    ipcMain.handle('sync-build-local-bundle', async () => ({
        ok: true,
        bundle: buildLocalBundleObject()
    }));

    ipcMain.handle('sync-encrypt-bundle', async (_e, { passphrase, bundle }) => {
        const inner = bundle && typeof bundle === 'object' ? bundle : buildLocalBundleObject();
        const plaintext = JSON.stringify(inner);
        return { ok: true, vault: encryptVault(plaintext, passphrase) };
    });

    ipcMain.handle('sync-decrypt-merge', async (_e, { vault, passphrase }) => {
        if (!vault) return { ok: false, error: 'No vault data.' };
        try {
            return mergeDecryptedJsonIntoProfile(decryptVault(vault, passphrase));
        } catch (e) {
            return { ok: false, error: 'Decrypt failed (wrong passphrase or corrupt data).' };
        }
    });

    ipcMain.handle('sync-push-remote', async (_e, { baseUrl, token, passphrase }) => {
        const base = String(baseUrl || '').replace(/\/$/, '');
        if (!base || !token) return { ok: false, error: 'Missing server URL or token.' };
        const built = buildLocalBundleObject();
        const vault = encryptVault(JSON.stringify(built), passphrase);
        try {
            const res = await fetch(`${base}/sync/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ vault, deviceId: hostnameId(), updatedAt: Date.now() })
            });
            if (!res.ok) return { ok: false, error: `Server ${res.status}` };
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.message || 'Network error' };
        }
    });

    ipcMain.handle('sync-pull-remote', async (_e, { baseUrl, token, passphrase }) => {
        const base = String(baseUrl || '').replace(/\/$/, '');
        if (!base || !token) return { ok: false, error: 'Missing server URL or token.' };
        try {
            const res = await fetch(`${base}/sync/download`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return { ok: false, error: `Server ${res.status}` };
            const data = await res.json();
            if (!data || !data.vault) return { ok: false, error: 'Empty vault.' };
            try {
                return mergeDecryptedJsonIntoProfile(decryptVault(data.vault, passphrase));
            } catch (e) {
                return { ok: false, error: 'Decrypt failed (wrong passphrase or corrupt data).' };
            }
        } catch (e) {
            return { ok: false, error: e.message || 'Network error' };
        }
    });
}

module.exports = { registerSyncIpc, encryptVault, decryptVault };
