type BrowserNotificationOptions = {
  tag?: string;
  onlyWhenHidden?: boolean;
  onClick?: () => void;
};

let permissionRequested = false;

export function ensureBrowserNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (permissionRequested) return;
  permissionRequested = true;
  Notification.requestPermission().catch(() => undefined);
}

export function showBrowserNotification(
  title: string,
  body: string,
  options: BrowserNotificationOptions = {},
) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (options.onlyWhenHidden !== false && document.visibilityState === 'visible') return;

  const notification = new Notification(title, {
    body,
    tag: options.tag,
  });
  notification.onclick = () => {
    window.focus();
    options.onClick?.();
    notification.close();
  };
}
