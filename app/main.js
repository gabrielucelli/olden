'use strict';

const {
  app,
  Menu,
  Tray,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
  dialog,
  shell } = require('electron');

const path = require('path');
const fs = require('fs');
const AutoLaunch = require('auto-launch');


let mainWindow = null;
let tray = null;

// Hide the icon from the dock if the OS has it.
if (app.dock) {
  app.dock.hide();
}


app.on('ready', () => {

  let autoLaunch = new AutoLaunch({
    name: 'Olden',
    path: app.getPath('exe'),
  });

  autoLaunch.isEnabled().then((isEnabled) => {
    if (!isEnabled) autoLaunch.enable();
  });

  mainWindow = new BrowserWindow({
    frame: false,
    height: 396,
    width: 400,
    backgroundColor: '#2B2F3B',
    resizable: false,
    center: true,
    skipTaskbar: true,
    show: false,
    title: 'Olden',
    alwaysOnTop: true,
    icon: path.join(__dirname, 'img', 'app_icon.png')
  });

  mainWindow.on('blur', () => {
    mainWindow.hide()
  })

  // The trigger used to show/hide the app window.
  // TODO: allow user to set a custom shortcut.
  globalShortcut.register('ctrl+shift+v', () => {
    if (mainWindow.isVisible()) {
      if (app.hide) {
        // NOTE: to get focus back to the previous window on MacOS we need to
        // hide the app not only the window.
        app.hide();
      } else {
        // NOTE: Windows doesn't have app.hide method, but combination of
        // window.blur and window.hide does the same thing.
        mainWindow.blur();
        mainWindow.hide()
      }
    } else {
      mainWindow.show();
    }
  });

  globalShortcut.register('esc', () => {
    if (mainWindow.isVisible()) {
      if (app.hide) {
        app.hide();
      } else {
        mainWindow.blur();
        mainWindow.hide()
      }
    }
  });

  if (process.platform === 'darwin') {
    tray = new Tray(path.join(__dirname, 'img', 'iconTemplate.png'));
  } else if (process.platform === 'linux') {
    tray = new Tray(path.join(__dirname, 'img', 'iconHighlight@2x.png'));
  } else {
    tray = new Tray(path.join(__dirname, 'img', 'iconHighlight.png'));
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Export', submenu: [
        {
          label: 'JSON', click(item, focusedWindow) {
            mainWindow.webContents.send('exportClipboardHistoryAsJSON');
          }
        },
        {
          label: 'Plain text', click(item, focusedWindow) {
            mainWindow.webContents.send('exportClipboardHistoryAsTXT');
          }
        }
      ]
    },
    {
      label: 'Clear clipboard history', click(item, focusedWindow) {
        mainWindow.webContents.send('clearClipboardHistory');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Olden', click(item, focusedWindow) {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Olden')
  tray.setContextMenu(contextMenu)

  mainWindow.loadURL('file://' + __dirname + '/index.html');
  mainWindow.setVisibleOnAllWorkspaces(true);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  ipcMain.on('hideWindow', (event) => {
    if (app.hide) {
      app.hide();
    } else {
      mainWindow.blur();
      mainWindow.hide()
    }
  });

  ipcMain.on('saveExportedData', (event, data) => {
    dialog.showSaveDialog(null, {
      defaultPath: process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'],
      filters: [{ name: 'JSON', extensions: [data.format] }]
    }, (filename) => {
      if (filename) {
        fs.writeFile(filename, data.items, 'utf8', (err, data) => {
          if (err) {
            // TODO: provide more descriptive error message.
            dialog.showErrorBox('Export failed', "Couldn't export clipboard history.");
          } else {
            dialog.showMessageBox(null, {
              type: 'info',
              buttons: [],
              title: 'Export successful',
              message: `All clipboard history has been exported to ${filename}`
            });
          }
        });
      }
    });
  });
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On MacOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
