function formatCaptureError(error) {
  return error?.message || String(error);
}

async function captureCurrentScreen() {
  const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  const screenshot = await chrome.tabs.captureVisibleTab(window.id, { format: "png" });

  return {
    screenshot,
    title: tab?.title ?? "",
    url: tab?.url ?? "",
    capturedAt: Date.now()
  };
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-and-roll") return;

  try {
    await chrome.storage.local.set({ pendingCapture: await captureCurrentScreen() });
  } catch (error) {
    const message = formatCaptureError(error);
    console.error("Rollit capture failed", error);
    await chrome.storage.local.set({ pendingCaptureError: message });
  }

  await chrome.action.openPopup();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture-current-screen") return false;

  captureCurrentScreen()
    .then((capture) => sendResponse({ ok: true, capture }))
    .catch((error) => sendResponse({ ok: false, error: formatCaptureError(error) }));

  return true;
});
