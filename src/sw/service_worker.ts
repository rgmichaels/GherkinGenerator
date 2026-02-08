const MENU_ID = "generate-assert-visible";

type JiraConfig = {
  baseUrl: string;
  email: string;
  token: string;
  mapping: Record<string, string>;
};

let recordingState: {
  recordingActive?: boolean;
  recordingContext?: { text: string; meta: unknown } | null;
  tabId?: number | null;
} = {};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Create JIRA item",
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") {
    return false;
  }
  if (message?.type === "ping") {
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "jira:test") {
    void handleJiraTest().then(sendResponse);
    return true;
  }

  if (message?.type === "open-options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "jira:list-projects") {
    void handleJiraListProjects().then(sendResponse);
    return true;
  }

  if (message?.type === "jira:list-issuetypes") {
    void handleJiraListIssueTypes(message).then(sendResponse);
    return true;
  }

  if (message?.type === "jira:create-issue") {
    void handleJiraCreateIssue(message, sender.tab?.id, sender.tab?.windowId).then(
      sendResponse
    );
    return true;
  }

  if (message?.type === "capture:snapshot-preview") {
    void handleSnapshotPreview(message, sender.tab?.windowId).then(sendResponse);
    return true;
  }

  if (message?.type === "record:request-start") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "Missing tab context." });
      return true;
    }
    void handleRecordStart(sender.tab.id).then(sendResponse);
    return true;
  }

  if (message?.type === "record:request-stop") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "Missing tab context." });
      return true;
    }
    void handleRecordStop().then(sendResponse);
    return true;
  }

  if (message?.type === "record:state-set") {
    void handleRecordStateSet(message, sender.tab?.id).then(sendResponse);
    return true;
  }

  if (message?.type === "record:state-get") {
    void handleRecordStateGet().then(sendResponse);
    return true;
  }

  return false;
});

async function getJiraConfig(): Promise<JiraConfig | null> {
  const stored = (await chrome.storage.local.get("jiraConfig")) as {
    jiraConfig?: JiraConfig;
  };
  if (!stored.jiraConfig) return null;
  return stored.jiraConfig;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildAuthHeader(email: string, token: string): string {
  return `Basic ${btoa(`${email}:${token}`)}`;
}

async function handleJiraTest() {
  const config = await getJiraConfig();
  if (!config?.baseUrl || !config?.email || !config?.token) {
    return { ok: false, error: "Missing Jira configuration." };
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
    headers: {
      Authorization: buildAuthHeader(config.email, config.token),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return { ok: false, error: `Jira error (${response.status})` };
  }
  return { ok: true };
}

async function handleJiraListProjects() {
  const config = await getJiraConfig();
  if (!config?.baseUrl || !config?.email || !config?.token) {
    return { ok: false, error: "Missing Jira configuration." };
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const response = await fetch(
    `${baseUrl}/rest/api/3/project/search?maxResults=100`,
    {
      headers: {
        Authorization: buildAuthHeader(config.email, config.token),
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    return { ok: false, error: `Jira error (${response.status})` };
  }

  const payload = await response.json();
  const values = Array.isArray(payload.values) ? payload.values : [];
  const projects = values.map((project: { key: string; name: string }) => ({
    key: project.key,
    name: project.name,
  }));

  return { ok: true, projects };
}

async function handleJiraListIssueTypes(message: { projectKey?: string }) {
  const config = await getJiraConfig();
  if (!config?.baseUrl || !config?.email || !config?.token) {
    return { ok: false, error: "Missing Jira configuration." };
  }
  if (!message.projectKey) {
    return { ok: false, error: "Missing project key." };
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const response = await fetch(
    `${baseUrl}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(
      message.projectKey
    )}&expand=projects.issuetypes`,
    {
      headers: {
        Authorization: buildAuthHeader(config.email, config.token),
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    return { ok: false, error: `Jira error (${response.status}): ${detail}` };
  }

  const payload = await response.json();
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const issueTypes =
    projects[0]?.issuetypes?.map((it: { name: string; id: string }) => ({
      name: it.name,
      id: it.id,
    })) || [];

  return { ok: true, issueTypes };
}

async function handleJiraCreateIssue(
  message: {
    projectKey?: string;
    summary?: string;
    description?: string;
    stepDef?: string;
    mapping?: string;
    issueType?: string;
    snapshotDataUrl?: string | null;
    recordingDataUrl?: string | null;
    recordingId?: string | null;
    captureRect?: { x: number; y: number; width: number; height: number } | null;
    viewport?: { width: number; height: number };
    devicePixelRatio?: number;
  },
  tabId?: number,
  windowId?: number
) {
  const config = await getJiraConfig();
  if (!config?.baseUrl || !config?.email || !config?.token) {
    return { ok: false, error: "Missing Jira configuration." };
  }

  if (!message.projectKey) {
    return { ok: false, error: "Missing project key." };
  }

  const summary = message.summary?.trim();
  if (!summary) {
    return { ok: false, error: "Missing summary." };
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const descriptionText = message.description?.trim() || "";
  const description = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: descriptionText
          ? [{ type: "text", text: descriptionText }]
          : [],
      },
    ],
  };

  const issueType =
    message.issueType?.toLowerCase() === "bug" ? "Bug" : "Task";

  const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(config.email, config.token),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: message.projectKey },
        summary,
        description,
        issuetype: { name: issueType },
      },
    }),
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    return { ok: false, error: `Jira error (${response.status}): ${detail}` };
  }

  const payload = await response.json();
  const issueKey = payload.key as string;

  if (message.snapshotDataUrl) {
    const response = await fetch(message.snapshotDataUrl);
    const blob = await response.blob();
    await uploadAttachment(baseUrl, config, issueKey, blob);
  } else if (
    message.captureRect &&
    message.captureRect.width > 0 &&
    message.captureRect.height > 0 &&
    tabId &&
    typeof windowId === "number"
  ) {
    const attachment = await captureAndCropTab(
      windowId,
      message.captureRect,
      message.viewport || { width: 0, height: 0 },
      message.devicePixelRatio || 1
    );
    if (attachment) {
      await uploadAttachment(baseUrl, config, issueKey, attachment);
    }
  }

  if (message.recordingDataUrl) {
    const response = await fetch(message.recordingDataUrl);
    const blob = await response.blob();
    await uploadAttachment(baseUrl, config, issueKey, blob);
  } else if (message.recordingId) {
    await sendToOffscreen({
      type: "record:upload",
      target: "offscreen",
      recordingId: message.recordingId,
      baseUrl,
      authHeader: buildAuthHeader(config.email, config.token),
      issueKey,
    });
  }

  const comments: string[] = [];
  if (message.stepDef?.trim()) comments.push(message.stepDef.trim());
  if (message.mapping?.trim()) comments.push(message.mapping.trim());

  for (const comment of comments) {
    const commentResponse = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/comment`,
      {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(config.email, config.token),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "codeBlock",
              attrs: { language: "text" },
              content: [{ type: "text", text: comment }],
            },
          ],
        },
      }),
      }
    );
    if (!commentResponse.ok) {
      const detail = await safeReadError(commentResponse);
      return {
        ok: false,
        error: `Jira comment error (${commentResponse.status}): ${detail}`,
      };
    }
  }

  return { ok: true, key: issueKey };
}

async function ensureOffscreen() {
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) return;
  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the active tab using getUserMedia.",
  });
}

async function handleRecordStart(tabId?: number) {
  if (!tabId) return { ok: false, error: "Missing tab id." };
  await ensureOffscreen();
  let streamId: string | undefined;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
  } catch (error) {
    return { ok: false, error: error?.message || "Failed to get stream id." };
  }
  if (chrome.runtime.lastError) {
    return { ok: false, error: chrome.runtime.lastError.message };
  }
  if (!streamId) return { ok: false, error: "Failed to get stream id." };

  return sendToOffscreen({ type: "record:start", streamId, target: "offscreen" });
}

async function handleRecordStop() {
  await ensureOffscreen();
  const response = await sendToOffscreen({ type: "record:stop", target: "offscreen" });
  if (recordingState.recordingContext && typeof recordingState.tabId === "number") {
    const payload = {
      type: "record:stopped",
      recordingContext: recordingState.recordingContext,
      recordingId: response?.recordingId || null,
      recordingDataUrl: response?.dataUrl || null,
    };
    try {
      await chrome.tabs.sendMessage(recordingState.tabId, payload);
    } catch {
      // No-op; content script may not be ready on the new page yet.
    }
  }
  return response;
}

async function sendToOffscreen(message: unknown) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function handleRecordStateSet(message: {
  recordingActive?: boolean;
  recordingContext?: { text: string; meta: unknown } | null;
}, tabId?: number) {
  const payload: Record<string, unknown> = {};
  if (typeof message.recordingActive === "boolean") {
    payload.recordingActive = message.recordingActive;
  }
  if (message.recordingContext !== undefined) {
    payload.recordingContext = message.recordingContext;
  }
  if (typeof tabId === "number") {
    payload.tabId = tabId;
  }
  recordingState = { ...recordingState, ...payload };
  try {
    await chrome.storage.session.set(payload);
  } catch {
    // Fallback to in-memory recordingState.
  }
  return { ok: true };
}

async function handleRecordStateGet() {
  try {
    const stored = (await chrome.storage.session.get([
      "recordingActive",
      "recordingContext",
      "tabId",
    ])) as { recordingActive?: boolean; recordingContext?: unknown | null };
    return { ok: true, ...recordingState, ...stored };
  } catch {
    return { ok: true, ...recordingState };
  }
}

async function captureAndCropTab(
  windowId: number,
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  devicePixelRatio: number
): Promise<Blob | null> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  });
  if (!dataUrl) return null;

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = devicePixelRatio || 1;
  const maxWidth = Math.max(0, viewport.width);
  const maxHeight = Math.max(0, viewport.height);

  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = maxWidth > 0 ? Math.min(x + rect.width, maxWidth) : x + rect.width;
  const bottom = maxHeight > 0 ? Math.min(y + rect.height, maxHeight) : y + rect.height;
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(Math.ceil(width * scale), Math.ceil(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(
    bitmap,
    x * scale,
    y * scale,
    width * scale,
    height * scale,
    0,
    0,
    width * scale,
    height * scale
  );

  return canvas.convertToBlob({ type: "image/png" });
}

async function uploadAttachment(
  baseUrl: string,
  config: JiraConfig,
  issueKey: string,
  blob: Blob
) {
  const form = new FormData();
  form.append("file", blob, "selection.png");

  const response = await fetch(
    `${baseUrl}/rest/api/3/issue/${issueKey}/attachments`,
    {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(config.email, config.token),
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
    body: form,
    }
  );
  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(`Jira attachment error (${response.status}): ${detail}`);
  }
}

async function handleSnapshotPreview(
  message: { rect?: { x: number; y: number; width: number; height: number } },
  windowId?: number
) {
  if (!message.rect || typeof windowId !== "number") {
    return { ok: false, error: "Missing rect or window." };
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  });
  if (!dataUrl) return { ok: false, error: "Capture failed." };

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = 1;
  const x = Math.max(0, message.rect.x);
  const y = Math.max(0, message.rect.y);
  const width = Math.max(1, message.rect.width);
  const height = Math.max(1, message.rect.height);

  const canvas = new OffscreenCanvas(Math.ceil(width * scale), Math.ceil(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "Canvas failed." };

  ctx.drawImage(
    bitmap,
    x * scale,
    y * scale,
    width * scale,
    height * scale,
    0,
    0,
    width * scale,
    height * scale
  );

  const previewBlob = await canvas.convertToBlob({ type: "image/png" });
  const previewDataUrl = await blobToDataUrl(previewBlob);
  return { ok: true, dataUrl: previewDataUrl };
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "No details";
    try {
      const json = JSON.parse(text);
      return json?.errorMessages?.join("; ") || json?.message || text;
    } catch {
      return text;
    }
  } catch {
    return "No details";
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `data:${blob.type};base64,${btoa(binary)}`;
}
