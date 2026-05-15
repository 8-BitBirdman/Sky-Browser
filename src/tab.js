// Tab abstraction. Two impls:
//  - ElectronTab: wraps <webview> tag (desktop)
//  - AndroidTab: talks to SkyTabs Capacitor plugin (native WebView underlay)
//
// Common API: load(url), reload(), back(), forward(), getURL(), on(event, fn),
//             setRect({x,y,w,h}), setVisible(bool), destroy()

const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

if (isCapacitor) {
    document.documentElement.classList.add('is-android');
    // Apply to body too once it exists.
    if (document.body) document.body.classList.add('is-android');
    else document.addEventListener('DOMContentLoaded', () => document.body.classList.add('is-android'));
}

// ---------- Electron impl ----------
class ElectronTab {
    constructor(id, url, container) {
        this.id = id;
        this.listeners = {};
        this.canBack = false;
        this.canForward = false;
        const wv = document.createElement('webview');
        wv.id = `webview-${id}`;
        wv.src = url;
        container.appendChild(wv);
        this.el = wv;
        const emitNav = () => {
            this.emit('navigate', wv.getURL());
            this._refreshCanGo();
        };
        wv.addEventListener('did-navigate', emitNav);
        wv.addEventListener('did-navigate-in-page', emitNav);
        wv.addEventListener('page-title-updated', (e) => this.emit('title', e.title));
        // popup blocking handled in main.js via app.on('web-contents-created')
    }
    _refreshCanGo() {
        try {
            this.canBack = this.el.canGoBack();
            this.canForward = this.el.canGoForward();
            this.emit('cango', { back: this.canBack, forward: this.canForward });
        } catch {}
    }
    load(url) { this.el.src = url; }
    reload() { try { this.el.reload(); } catch {} }
    back() { try { if (this.el.canGoBack()) this.el.goBack(); } catch {} }
    forward() { try { if (this.el.canGoForward()) this.el.goForward(); } catch {} }
    getURL() { try { return this.el.getURL(); } catch { return ''; } }
    setRect() { /* CSS handles fill */ }
    setVisible(v) { this.el.classList.toggle('active', v); }
    destroy() { this.el.remove(); }
    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    emit(ev, data) { (this.listeners[ev] || []).forEach(f => f(data)); }
}

// ---------- Android impl ----------
class AndroidTab {
    constructor(id, url) {
        this.id = id;
        this.url = url;
        this.title = 'New Tab';
        this.canBack = false;
        this.canForward = false;
        this.listeners = {};
        this.handles = [];
        this.pendingRect = null;
        this.pendingVisible = null;
        this.ready = false;
        this.plugin = window.Capacitor.Plugins.SkyTabs;
        // Listeners must be attached before create() to avoid missing early events.
        this.plugin.addListener(`tab:${id}:navigate`, (data) => { this.url = data.url; this.emit('navigate', data.url); })
            .then(h => this.handles.push(h));
        this.plugin.addListener(`tab:${id}:title`, (data) => { this.title = data.title; this.emit('title', data.title); })
            .then(h => this.handles.push(h));
        this.plugin.addListener(`tab:${id}:cangostate`, (data) => {
            this.canBack = !!data.back;
            this.canForward = !!data.forward;
            this.emit('cango', { back: this.canBack, forward: this.canForward });
        }).then(h => this.handles.push(h));
        this.plugin.create({ id, url }).then(() => {
            this.ready = true;
            if (this.pendingRect) this.plugin.setRect({ id, ...this.pendingRect }).catch(() => {});
            if (this.pendingVisible !== null) this.plugin.setVisible({ id, visible: this.pendingVisible }).catch(() => {});
        }).catch(() => {});
    }
    load(url) { this.url = url; this.plugin.load({ id: this.id, url }).catch(() => {}); }
    reload() { this.plugin.reload({ id: this.id }).catch(() => {}); }
    back() { this.plugin.back({ id: this.id }).catch(() => {}); }
    forward() { this.plugin.forward({ id: this.id }).catch(() => {}); }
    getURL() { return this.url; }
    setRect(r) { this.pendingRect = r; if (this.ready) this.plugin.setRect({ id: this.id, ...r }).catch(() => {}); }
    setVisible(v) { this.pendingVisible = v; if (this.ready) this.plugin.setVisible({ id: this.id, visible: v }).catch(() => {}); }
    destroy() {
        this.handles.forEach(h => { try { h.remove(); } catch {} });
        this.handles = [];
        this.plugin.destroy({ id: this.id }).catch(() => {});
    }
    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    emit(ev, data) { (this.listeners[ev] || []).forEach(f => f(data)); }
}

window.SkyTab = {
    isAndroid: isCapacitor,
    create(id, url, container) {
        return isCapacitor ? new AndroidTab(id, url) : new ElectronTab(id, url, container);
    }
};
