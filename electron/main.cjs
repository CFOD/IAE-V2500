// Electron entry point: one native window hosting the game.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1180,
    minHeight: 700,
    backgroundColor: '#0b0f14',
    title: 'V2500 Engine Simulator',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
