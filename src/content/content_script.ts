type SelectorCandidate = {
  kind: "byRole" | "byLabel" | "byPlaceholder" | "byTestId" | "byText" | "css";
  selector: string;
  reason: string;
};

type CaptureResult = {
  ok: boolean;
  error?: string;
  data?: {
    url: string;
    title: string;
    pageKey: string;
    role: string | null;
    name: string | null;
    outerHTML: string;
    elementKey: string;
    selectors: SelectorCandidate[];
    warnings: string[];
  };
};

let lastRightClickedElement: Element | null = null;

document.addEventListener(
  "contextmenu",
  (event) => {
    if (event.target && event.target instanceof Element) {
      lastRightClickedElement = event.target as Element;
    }
  },
  true
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "capture-and-copy") {
    void handleCaptureAndCopy()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }
  return false;
});

async function handleCaptureAndCopy(): Promise<CaptureResult> {
  const target = pickTargetElement();
  if (!target) {
    return { ok: false, error: "No element found." };
  }

  const capture = buildCapture(target);
  const output = formatClipboard(capture);
  await writeClipboard(output);
  showOverlay(output, {
    title: capture.title,
    elementKey: capture.elementKey,
    url: capture.url,
  });
  return { ok: true, data: capture };
}

function pickTargetElement(): Element | null {
  if (lastRightClickedElement && document.contains(lastRightClickedElement)) {
    return lastRightClickedElement;
  }
  const active = document.activeElement;
  if (active && active !== document.body) return active;
  return document.body;
}

function buildCapture(element: Element) {
  const url = window.location.href;
  const title = document.title || "";
  const pageKey = buildPageKey(url, title);
  const role = getRole(element);
  const name = getAccessibleName(element);
  const outerHTML = getOuterHtmlSnippet(element);

  const selectors = buildSelectors(element, role, name);
  const elementKey = buildElementKey(element, role, name, selectors);
  const warnings = buildWarnings(selectors, name, element);

  return {
    url,
    title,
    pageKey,
    role,
    name,
    outerHTML,
    elementKey,
    selectors,
    warnings,
  };
}

function getRole(element: Element): string | null {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;

  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && (element as HTMLAnchorElement).href) return "link";
  if (tag === "img") return "img";
  if (tag === "input") {
    const type = (element as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return null;
}

function getAccessibleName(element: Element): string | null {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeWhitespace(ariaLabel);

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    if (text) return normalizeWhitespace(text);
  }

  if (element instanceof HTMLImageElement) {
    const alt = element.getAttribute("alt");
    if (alt) return normalizeWhitespace(alt);
  }

  const labelText = findLabelText(element);
  if (labelText) return normalizeWhitespace(labelText);

  const placeholder = (element as HTMLInputElement).getAttribute?.("placeholder");
  if (placeholder) return normalizeWhitespace(placeholder);

  const title = element.getAttribute("title");
  if (title) return normalizeWhitespace(title);

  const text = element.textContent?.trim();
  if (text) return normalizeWhitespace(text);

  return null;
}

function findLabelText(element: Element): string | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element.id) {
    const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
    if (label?.textContent) return label.textContent;
  }
  const parentLabel = element.closest("label");
  if (parentLabel?.textContent) return parentLabel.textContent;
  return null;
}

function buildSelectors(
  element: Element,
  role: string | null,
  name: string | null
): SelectorCandidate[] {
  const selectors: SelectorCandidate[] = [];

  if (role && name) {
    selectors.push({
      kind: "byRole",
      selector: `getByRole('${escapeQuotes(role)}', { name: '${escapeQuotes(name)}' })`,
      reason: "Accessible role + name",
    });
  } else if (role) {
    selectors.push({
      kind: "byRole",
      selector: `getByRole('${escapeQuotes(role)}')`,
      reason: "Accessible role",
    });
  }

  const labelText = findLabelText(element);
  if (labelText) {
    selectors.push({
      kind: "byLabel",
      selector: `getByLabel('${escapeQuotes(normalizeWhitespace(labelText))}')`,
      reason: "Associated label",
    });
  }

  const placeholder = (element as HTMLInputElement).getAttribute?.("placeholder");
  if (placeholder) {
    selectors.push({
      kind: "byPlaceholder",
      selector: `getByPlaceholder('${escapeQuotes(normalizeWhitespace(placeholder))}')`,
      reason: "Placeholder text",
    });
  }

  const testId =
    element.getAttribute("data-testid") ||
    element.getAttribute("data-test-id") ||
    (element as HTMLElement).dataset?.testid;
  if (testId) {
    selectors.push({
      kind: "byTestId",
      selector: `getByTestId('${escapeQuotes(testId)}')`,
      reason: "data-testid",
    });
  }

  const textContent = normalizeWhitespace(element.textContent || "");
  if (textContent) {
    selectors.push({
      kind: "byText",
      selector: `getByText('${escapeQuotes(textContent)}')`,
      reason: "Visible text",
    });
  }

  selectors.push({
    kind: "css",
    selector: buildCssSelector(element),
    reason: "CSS fallback",
  });

  return selectors;
}

function buildElementKey(
  element: Element,
  role: string | null,
  name: string | null,
  selectors: SelectorCandidate[]
): string {
  const id = (element as HTMLElement).id;
  const text = name || id || element.tagName.toLowerCase();
  const base = text.replace(/[^a-zA-Z0-9\s_-]/g, " ").trim();
  const words = base.split(/\s+/).filter(Boolean);
  const rolePrefix = role ? `${role}_` : "";
  const raw = `${rolePrefix}${words.join("_")}`.toLowerCase();
  const compact = raw.replace(/_+/g, "_").slice(0, 40);
  if (compact.length > 0) return compact;
  const fallback = selectors[0]?.kind || "element";
  return `element_${fallback}`;
}

function buildWarnings(
  selectors: SelectorCandidate[],
  name: string | null,
  element: Element
): string[] {
  const warnings: string[] = [];
  const hasCss = selectors.some((s) => s.kind === "css");
  if (hasCss) warnings.push("A) CSS fallback included");

  if (name && looksDynamicText(name)) {
    warnings.push("B) Text looks dynamic (numbers or variable tokens)");
  }

  const textContent = normalizeWhitespace(element.textContent || "");
  if (textContent) {
    const sameTextCount = countElementsByText(textContent);
    if (sameTextCount > 1) {
      warnings.push("C) Multiple elements share the same text");
    }
  }

  return warnings;
}

function looksDynamicText(text: string): boolean {
  return /\d{2,}/.test(text) || /#\d+/.test(text);
}

function countElementsByText(text: string): number {
  const matches = Array.from(document.querySelectorAll("body *")).filter(
    (el) => normalizeWhitespace(el.textContent || "") === text
  );
  return matches.length;
}

function buildCssSelector(element: Element): string {
  if (!(element instanceof Element)) return "";
  const id = (element as HTMLElement).id;
  if (id) return `#${cssEscape(id)}`;

  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && current.tagName.toLowerCase() !== "html" && depth < 4) {
    const tag = current.tagName.toLowerCase();
    const className = current.className
      ? `.${Array.from(current.classList)
          .slice(0, 2)
          .map(cssEscape)
          .join(".")}`
      : "";
    const siblingIndex = getSiblingIndex(current);
    const nth = siblingIndex > 0 ? `:nth-of-type(${siblingIndex})` : "";
    parts.unshift(`${tag}${className}${nth}`);
    current = current.parentElement;
    depth += 1;
  }
  return parts.join(" > ") || element.tagName.toLowerCase();
}

function getSiblingIndex(element: Element): number {
  if (!element.parentElement) return 0;
  const siblings = Array.from(element.parentElement.children).filter(
    (child) => child.tagName === element.tagName
  );
  const index = siblings.indexOf(element);
  return index >= 0 ? index + 1 : 0;
}

function getOuterHtmlSnippet(element: Element): string {
  const html = element.outerHTML || "";
  const cleaned = html.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 200) return cleaned;
  return `${cleaned.slice(0, 200)}…`;
}

function formatClipboard(capture: {
  url: string;
  title: string;
  pageKey: string;
  role: string | null;
  name: string | null;
  outerHTML: string;
  elementKey: string;
  selectors: SelectorCandidate[];
  warnings: string[];
}): string {
  return [
    `Given I am on the "${capture.pageKey}" page`,
    `Then the "${capture.elementKey}" should be visible`,
  ].join("\n");
}

function buildPageKey(url: string, title: string): string {
  const titleKey = normalizeWhitespace(title);
  return titleKey || "home";
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeQuotes(value: string): string {
  return value.replace(/'/g, "\\'");
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
}

function showOverlay(
  text: string,
  meta: { title: string; elementKey: string; url: string }
): void {
  const existing = document.getElementById("test-authoring-helper-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "test-authoring-helper-overlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.25)";
  overlay.style.zIndex = "2147483647";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const card = document.createElement("div");
  card.style.width = "min(860px, 92vw)";
  card.style.maxHeight = "85vh";
  card.style.background = "#ffffff";
  card.style.borderRadius = "12px";
  card.style.boxShadow = "0 20px 60px rgba(0,0,0,0.35)";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.overflow = "hidden";
  card.style.border = "1px solid #e0d8cc";

  const header = document.createElement("div");
  header.style.background = "#1f1f1f";
  header.style.color = "#ffffff";
  header.style.padding = "12px 16px";
  header.style.fontFamily = "system-ui, -apple-system, sans-serif";
  header.style.fontWeight = "600";
  header.textContent = "Copied to clipboard";

  const body = document.createElement("div");
  body.style.padding = "12px 16px";
  body.style.overflow = "auto";
  body.style.background = "#f8f4ee";

  const keywordBar = document.createElement("div");
  keywordBar.style.display = "flex";
  keywordBar.style.flexWrap = "wrap";
  keywordBar.style.gap = "8px";
  keywordBar.style.marginBottom = "10px";

  const gherkinKeywords = [
    "Feature",
    "Rule",
    "Background",
    "Scenario",
    "Scenario Outline",
    "Examples",
    "Given",
    "When",
    "Then",
    "And",
    "But",
  ];

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.width = "100%";
  textarea.style.minHeight = "220px";
  textarea.style.resize = "vertical";
  textarea.style.margin = "0";
  textarea.style.padding = "10px";
  textarea.style.whiteSpace = "pre-wrap";
  textarea.style.wordBreak = "break-word";
  textarea.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
  textarea.style.fontSize = "13px";
  textarea.style.color = "#1f1f1f";
  textarea.style.border = "1px solid #e0d8cc";
  textarea.style.borderRadius = "8px";
  textarea.style.background = "#ffffff";

  const makeKeywordButton = (keyword: string) => {
    const button = document.createElement("button");
    button.textContent = keyword;
    button.style.padding = "6px 10px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid #1f1f1f";
    button.style.background = "#ffffff";
    button.style.color = "#1f1f1f";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
    button.addEventListener("click", () => {
      insertAtCursor(textarea, `${keyword} `);
      textarea.focus();
      updateCopyState();
    });
    return button;
  };

  gherkinKeywords.forEach((keyword) => {
    keywordBar.appendChild(makeKeywordButton(keyword));
  });

  const jiraPanel = document.createElement("div");
  jiraPanel.style.marginTop = "12px";
  jiraPanel.style.padding = "12px";
  jiraPanel.style.borderRadius = "10px";
  jiraPanel.style.border = "1px solid #e0d8cc";
  jiraPanel.style.background = "#ffffff";

  const jiraTitle = document.createElement("div");
  jiraTitle.textContent = "Create Jira Ticket";
  jiraTitle.style.fontWeight = "600";
  jiraTitle.style.marginBottom = "8px";
  jiraTitle.style.fontFamily = "system-ui, -apple-system, sans-serif";

  const jiraRow = document.createElement("div");
  jiraRow.style.display = "flex";
  jiraRow.style.gap = "8px";
  jiraRow.style.flexWrap = "wrap";

  const projectSelect = document.createElement("select");
  projectSelect.style.flex = "1 1 200px";
  projectSelect.style.padding = "8px 10px";
  projectSelect.style.borderRadius = "8px";
  projectSelect.style.border = "1px solid #e0d8cc";

  const summaryInput = document.createElement("input");
  summaryInput.type = "text";
  summaryInput.style.flex = "2 1 320px";
  summaryInput.style.padding = "8px 10px";
  summaryInput.style.borderRadius = "8px";
  summaryInput.style.border = "1px solid #e0d8cc";
  summaryInput.value = `UI: ${meta.elementKey} should be visible`;

  const jiraActions = document.createElement("div");
  jiraActions.style.display = "flex";
  jiraActions.style.justifyContent = "space-between";
  jiraActions.style.alignItems = "center";
  jiraActions.style.marginTop = "10px";
  jiraActions.style.gap = "8px";

  const jiraStatus = document.createElement("div");
  jiraStatus.style.fontSize = "12px";
  jiraStatus.style.color = "#4b4b4b";

  const jiraLink = document.createElement("a");
  jiraLink.style.fontSize = "12px";
  jiraLink.style.color = "#1f1f1f";
  jiraLink.style.marginLeft = "8px";
  jiraLink.style.textDecoration = "underline";
  jiraLink.style.display = "none";
  jiraLink.target = "_blank";

  const jiraButton = document.createElement("button");
  jiraButton.textContent = "Create Jira Ticket";
  jiraButton.style.padding = "8px 14px";
  jiraButton.style.borderRadius = "8px";
  jiraButton.style.border = "1px solid #1f1f1f";
  jiraButton.style.background = "#1f1f1f";
  jiraButton.style.color = "#ffffff";
  jiraButton.style.cursor = "pointer";

  const optionsButton = document.createElement("button");
  optionsButton.textContent = "Jira Settings";
  optionsButton.style.padding = "8px 14px";
  optionsButton.style.borderRadius = "8px";
  optionsButton.style.border = "1px solid #1f1f1f";
  optionsButton.style.background = "#ffffff";
  optionsButton.style.color = "#1f1f1f";
  optionsButton.style.cursor = "pointer";
  optionsButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open-options" });
  });

  jiraRow.appendChild(projectSelect);
  jiraRow.appendChild(summaryInput);
  const jiraStatusWrap = document.createElement("div");
  jiraStatusWrap.style.display = "flex";
  jiraStatusWrap.style.alignItems = "center";
  jiraStatusWrap.appendChild(jiraStatus);
  jiraStatusWrap.appendChild(jiraLink);

  jiraActions.appendChild(jiraStatusWrap);
  jiraActions.appendChild(optionsButton);
  jiraActions.appendChild(jiraButton);
  jiraPanel.appendChild(jiraTitle);
  jiraPanel.appendChild(jiraRow);
  jiraPanel.appendChild(jiraActions);

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.justifyContent = "flex-end";
  footer.style.gap = "8px";
  footer.style.padding = "10px 16px 14px";
  footer.style.background = "#ffffff";

  const originalText = text;
  const copyButton = document.createElement("button");
  copyButton.textContent = "Copy";
  copyButton.style.padding = "8px 14px";
  copyButton.style.borderRadius = "8px";
  copyButton.style.border = "1px solid #1f1f1f";
  copyButton.style.background = "#ffffff";
  copyButton.style.color = "#1f1f1f";
  copyButton.style.cursor = "pointer";
  copyButton.disabled = true;
  copyButton.style.opacity = "0.5";
  copyButton.style.cursor = "not-allowed";

  const updateCopyState = () => {
    const isDirty = textarea.value !== originalText;
    copyButton.disabled = !isDirty;
    copyButton.style.opacity = isDirty ? "1" : "0.5";
    copyButton.style.cursor = isDirty ? "pointer" : "not-allowed";
  };

  textarea.addEventListener("input", updateCopyState);

  copyButton.addEventListener("click", async () => {
    if (copyButton.disabled) return;
    await writeClipboard(textarea.value);
    header.textContent = "Copied to clipboard";
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1200);
    updateCopyState();
  });

  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.padding = "8px 14px";
  closeButton.style.borderRadius = "8px";
  closeButton.style.border = "1px solid #1f1f1f";
  closeButton.style.background = "#1f1f1f";
  closeButton.style.color = "#ffffff";
  closeButton.style.cursor = "pointer";
  closeButton.addEventListener("click", () => overlay.remove());

  body.appendChild(keywordBar);
  body.appendChild(textarea);
  body.appendChild(jiraPanel);
  footer.appendChild(copyButton);
  footer.appendChild(closeButton);
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  void loadJiraProjects(projectSelect, jiraStatus).then((defaultKey) => {
    if (defaultKey) {
      projectSelect.value = defaultKey;
    }
  });

  jiraButton.addEventListener("click", () => {
    const projectKey = projectSelect.value;
    const summary = summaryInput.value.trim();
    const description = `${text}\\n\\nURL: ${meta.url}`;

    jiraStatus.textContent = "Creating ticket...";
    jiraLink.style.display = "none";
    chrome.runtime.sendMessage(
      { type: "jira:create-issue", projectKey, summary, description },
      async (response) => {
        if (chrome.runtime.lastError) {
          jiraStatus.textContent = chrome.runtime.lastError.message;
          return;
        }
        if (!response?.ok) {
          jiraStatus.textContent = response?.error || "Failed to create issue";
          return;
        }
        jiraStatus.textContent = `Created ${response.key}`;
        const baseUrl = await getJiraBaseUrl();
        if (baseUrl) {
          jiraLink.href = `${baseUrl}/browse/${response.key}`;
          jiraLink.textContent = "Open";
          jiraLink.style.display = "inline";
        }
      }
    );
  });
}

function insertAtCursor(textarea: HTMLTextAreaElement, insertText: string): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${insertText}${after}`;
  const cursor = start + insertText.length;
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
}

async function loadJiraProjects(
  select: HTMLSelectElement,
  status: HTMLElement
): Promise<string | null> {
  select.innerHTML = "";
  const loading = document.createElement("option");
  loading.textContent = "Loading projects...";
  loading.value = "";
  select.appendChild(loading);

  const config = (await chrome.storage.local.get("jiraConfig")) as {
    jiraConfig?: { mapping?: Record<string, string> };
  };
  const mapping = config.jiraConfig?.mapping || {};
  const hostname = window.location.hostname.toLowerCase();
  const defaultKey = mapping[hostname] || null;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "jira:list-projects" }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = chrome.runtime.lastError.message;
        select.innerHTML = "";
        const option = document.createElement("option");
        option.textContent = "Configure Jira in settings";
        option.value = "";
        select.appendChild(option);
        resolve(defaultKey);
        return;
      }
      if (!response?.ok) {
        status.textContent = response?.error || "Configure Jira in settings";
        select.innerHTML = "";
        const option = document.createElement("option");
        option.textContent = "Configure Jira in settings";
        option.value = "";
        select.appendChild(option);
        resolve(defaultKey);
        return;
      }

      select.innerHTML = "";
      const projects = response.projects as { key: string; name: string }[];
      projects.forEach((project) => {
        const option = document.createElement("option");
        option.value = project.key;
        option.textContent = `${project.key} — ${project.name}`;
        select.appendChild(option);
      });

      status.textContent = "";
      resolve(defaultKey);
    });
  });
}

async function getJiraBaseUrl(): Promise<string | null> {
  const config = (await chrome.storage.local.get("jiraConfig")) as {
    jiraConfig?: { baseUrl?: string };
  };
  const baseUrl = config.jiraConfig?.baseUrl?.trim();
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}
