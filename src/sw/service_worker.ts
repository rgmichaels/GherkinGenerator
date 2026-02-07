const MENU_ID = "generate-assert-visible";

type JiraConfig = {
  baseUrl: string;
  email: string;
  token: string;
  mapping: Record<string, string>;
};

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

async function handleJiraCreateIssue(
  message: {
    projectKey?: string;
    summary?: string;
    description?: string;
    stepDef?: string;
    mapping?: string;
    issueType?: string;
    snapshotDataUrl?: string | null;
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
    message.issueType?.toLowerCase() === "bug" ? "Bug" : "Story";

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
    return { ok: false, error: `Jira error (${response.status})` };
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

  const comments: string[] = [];
  if (message.stepDef?.trim()) comments.push(message.stepDef.trim());
  if (message.mapping?.trim()) comments.push(message.mapping.trim());

  for (const comment of comments) {
    await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
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
    });
  }

  return { ok: true, key: issueKey };
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

  await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(config.email, config.token),
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
    body: form,
  });
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `data:${blob.type};base64,${btoa(binary)}`;
}
