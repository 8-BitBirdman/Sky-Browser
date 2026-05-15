const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const adBlocker = require('./blocklist');

let mainWindow;
let webRequestRegistered = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // AGGRESSIVE POP-UP BLOCKING at Window level
    mainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
}

function registerAdBlocker() {
    if (webRequestRegistered) return;
    webRequestRegistered = true;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (adBlocker.isBlocked(details.url)) {
            return callback({ cancel: true });
        }
        callback({ cancel: false });
    });
}

// AGGRESSIVE POP-UP BLOCKING at Session level
app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
});

app.whenReady().then(async () => {
    await adBlocker.initialize();
    registerAdBlocker();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
