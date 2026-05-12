import { spawn } from 'node:child_process';

/**
 * Opens `url` in the system default browser when possible (macOS `open`, Windows `start`, Linux `xdg-open`).
 * Fire-and-forget: spawn errors are swallowed so login still works over SSH or without a GUI.
 */
export function tryOpenBrowserUrl(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    // `start` requires a window title argument before the URL
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: platform === 'win32',
    });
    child.on('error', () => {
      /* no GUI / unknown command — user still has the printed URL */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}
