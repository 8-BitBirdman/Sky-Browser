const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class AdBlocker {
    constructor() {
        this.blocklist = new Set();
        this.cachePath = path.join(app.getPath('userData'), 'blocklist.txt');
        this.url = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/domains/pro.txt';
    }

    async initialize() {
        const TTL_MS = 24 * 60 * 60 * 1000;
        let hasCache = false;
        let fresh = false;
        try {
            await this.loadFromCache();
            hasCache = true;
            fresh = (Date.now() - fs.statSync(this.cachePath).mtimeMs) < TTL_MS;
        } catch (_) { /* no cache */ }
        if (fresh) return;
        if (hasCache) {
            // Have stale cache: update in background.
            this.fetchUpdate().catch((e) => console.warn('[adblock] update failed:', e.message));
        } else {
            // No cache: must wait so first nav has protection.
            try { await this.fetchUpdate(); }
            catch (e) { console.warn('[adblock] initial fetch failed:', e.message); }
        }
    }

    async loadFromCache() {
        if (fs.existsSync(this.cachePath)) {
            const data = fs.readFileSync(this.cachePath, 'utf8');
            this.parse(data);
        } else {
            throw new Error('No cache found');
        }
    }

    fetchUpdate() {
        return this._get(this.url).then((data) => {
            if (!this._looksLikeBlocklist(data)) {
                throw new Error('Fetched data does not look like blocklist');
            }
            fs.writeFileSync(this.cachePath, data);
            this.parse(data);
        });
    }

    _get(url, hops = 0) {
        return new Promise((resolve, reject) => {
            if (hops > 5) return reject(new Error('Too many redirects'));
            https.get(url, { headers: { 'User-Agent': 'SkyBrowser/1.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    const next = new URL(res.headers.location, url).toString();
                    return resolve(this._get(next, hops + 1));
                }
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => resolve(data));
                res.on('error', reject);
            }).on('error', reject);
        });
    }

    _looksLikeBlocklist(data) {
        if (!data || /<html/i.test(data)) return false;
        let n = 0;
        for (const line of data.split('\n')) {
            const t = line.trim();
            if (!t || t.startsWith('#')) continue;
            if (++n > 100) return true;
        }
        return false;
    }

    parse(data) {
        const lines = data.split('\n');
        const next = new Set();
        for (let raw of lines) {
            let line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            // Strip hosts-file prefix (0.0.0.0 / 127.0.0.1 example.com).
            if (line.startsWith('0.0.0.0 ') || line.startsWith('127.0.0.1 ')) {
                line = line.substring(line.indexOf(' ') + 1).trim();
            }
            if (line) next.add(line.toLowerCase());
        }
        // Atomic swap: avoids isBlocked() seeing empty set during refresh.
        this.blocklist = next;
    }

    isBlocked(urlStr) {
        try {
            const url = new URL(urlStr);
            const host = url.hostname.toLowerCase();
            const parts = host.split('.');
            for (let i = 0; i < parts.length - 1; i++) {
                const domainToCheck = parts.slice(i).join('.');
                if (this.blocklist.has(domainToCheck)) return true;
            }
        } catch (e) { }
        return false;
    }
}

module.exports = new AdBlocker();
