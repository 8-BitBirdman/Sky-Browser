const tabsContainer = document.getElementById('tabs-container');
const webviewsContainer = document.getElementById('webviews-container');
const newTabBtn = document.getElementById('new-tab-btn');
const urlInput = document.getElementById('url-input');
const addressBar = document.getElementById('address-bar');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');

let tabs = [];
let activeTabId = null;
let _tabSeq = 0;

function nextTabId() {
    return `${Date.now()}-${++_tabSeq}`;
}

function reportRect() {
    if (!SkyTab.isAndroid) return;
    const r = webviewsContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const rect = {
        x: Math.round(r.left * dpr),
        y: Math.round(r.top * dpr),
        w: Math.round(r.width * dpr),
        h: Math.round(r.height * dpr),
    };
    tabs.forEach(t => t.skytab.setRect(rect));
}

function createTab(url = 'https://www.google.com') {
    const id = nextTabId();
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = `tab-${id}`;
    tabEl.innerHTML = `<span class="tab-title">New Tab</span><span class="close-tab">×</span>`;
    tabEl.onclick = () => switchTab(id);
    tabEl.querySelector('.close-tab').onclick = (e) => { e.stopPropagation(); closeTab(id); };
    tabsContainer.insertBefore(tabEl, newTabBtn);

    const skytab = SkyTab.create(id, url, webviewsContainer);
    skytab.on('navigate', (u) => {
        if (activeTabId === id && document.activeElement !== urlInput) urlInput.value = u;
        if (activeTabId === id) addressBar.classList.toggle('insecure', !/^https:/i.test(u));
    });
    skytab.on('title', (t) => { tabEl.querySelector('.tab-title').textContent = t; });
    skytab.on('cango', () => { if (activeTabId === id) updateNavButtons(); });

    const tab = { id, tabEl, skytab };
    tabs.push(tab);
    switchTab(id);
    reportRect();
    return tab;
}

function switchTab(id) {
    activeTabId = id;
    tabs.forEach(t => {
        const active = t.id === id;
        t.tabEl.classList.toggle('active', active);
        t.skytab.setVisible(active);
        if (active) {
            urlInput.value = t.skytab.getURL();
            addressBar.classList.toggle('insecure', !/^https:/i.test(t.skytab.getURL()));
        }
    });
    updateNavButtons();
}

function updateNavButtons() {
    const t = tabs.find(x => x.id === activeTabId);
    const back = !!(t && t.skytab.canBack);
    const fwd = !!(t && t.skytab.canForward);
    backBtn.disabled = !back;
    forwardBtn.disabled = !fwd;
    backBtn.classList.toggle('disabled', !back);
    forwardBtn.classList.toggle('disabled', !fwd);
}

function closeTab(id) {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    tabs[index].tabEl.remove();
    tabs[index].skytab.destroy();
    tabs.splice(index, 1);
    if (tabs.length === 0) createTab();
    else if (activeTabId === id) switchTab(tabs[Math.max(0, index - 1)].id);
}

newTabBtn.onclick = () => createTab();
urlInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        let url = urlInput.value.trim();
        if (!/^https?:\/\//i.test(url)) {
            url = (url.includes('.') && !url.includes(' ')) ? 'https://' + url : 'https://www.google.com/search?q=' + encodeURIComponent(url);
        }
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) tab.skytab.load(url);
        urlInput.blur();
    }
};
backBtn.onclick = () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.skytab.back(); };
forwardBtn.onclick = () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.skytab.forward(); };
reloadBtn.onclick = () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.skytab.reload(); };

window.addEventListener('resize', reportRect);
document.addEventListener('DOMContentLoaded', () => {
    createTab();
    reportRect();
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(reportRect).observe(webviewsContainer);
    }
});
