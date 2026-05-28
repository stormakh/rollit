// Service worker: open side panel when the extension action (toolbar icon) is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("[rollit] sidePanel behavior failed:", err));
});
