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
    void handleJiraCreateIssue(message).then(sendResponse);
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

async function handleJiraCreateIssue(message: {
  projectKey?: string;
  summary?: string;
  description?: string;
}) {
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
        issuetype: { name: "Task" },
      },
    }),
  });

  if (!response.ok) {
    return { ok: false, error: `Jira error (${response.status})` };
  }

  const payload = await response.json();
  return { ok: true, key: payload.key };
}
