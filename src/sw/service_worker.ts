const MENU_ID = "generate-assert-visible";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Generate test step… → Assert visible",
      contexts: ["all"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;

  chrome.tabs.sendMessage(
    tab.id,
    { type: "capture-and-copy" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Capture failed:", chrome.runtime.lastError.message);
        return;
      }
      if (!response?.ok) {
        console.warn("Capture failed:", response?.error || "Unknown error");
      }
    }
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
