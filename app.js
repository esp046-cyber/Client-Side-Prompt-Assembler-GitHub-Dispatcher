import { Octokit } from "https://esm.sh/@octokit/rest";

/* ---------------------------------------------------------
   Element references
--------------------------------------------------------- */
const clientScopeEl = document.getElementById("clientScope");
const hardwareConstraintsEl = document.getElementById("hardwareConstraints");
const availableResourcesEl = document.getElementById("availableResources");
const generatePromptBtn = document.getElementById("generatePromptBtn");
const promptPreviewWrap = document.getElementById("promptPreviewWrap");
const promptPreview = document.getElementById("promptPreview");

const taskJsonEl = document.getElementById("taskJson");
const repoOwnerEl = document.getElementById("repoOwner");
const repoNameEl = document.getElementById("repoName");
const ghTokenEl = document.getElementById("ghToken");
const rememberTokenEl = document.getElementById("rememberToken");
const dispatchBtn = document.getElementById("dispatchBtn");
const dispatchBtnLabel = document.getElementById("dispatchBtnLabel");
const dispatchSpinner = document.getElementById("dispatchSpinner");
const statusLog = document.getElementById("statusLog");

/* ---------------------------------------------------------
   Persisted settings (local storage only, opt-in)
   NOTE: local storage is not encrypted. Only enable "remember"
   on a trusted personal device.
--------------------------------------------------------- */
const STORAGE_KEY = "scadaPmHubSettings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const settings = JSON.parse(raw);
    repoOwnerEl.value = settings.repoOwner || "";
    repoNameEl.value = settings.repoName || "";
    ghTokenEl.value = settings.ghToken || "";
    rememberTokenEl.checked = true;
  } catch (err) {
    console.warn("Could not load saved settings:", err);
  }
}

function saveSettings() {
  if (!rememberTokenEl.checked) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      repoOwner: repoOwnerEl.value.trim(),
      repoName: repoNameEl.value.trim(),
      ghToken: ghTokenEl.value.trim(),
    })
  );
}

loadSettings();

/* ---------------------------------------------------------
   Prompt Assembler
--------------------------------------------------------- */
function buildMasterPrompt() {
  const scope = clientScopeEl.value.trim() || "(not provided)";
  const constraints = hardwareConstraintsEl.value.trim() || "(not provided)";
  const resources = availableResourcesEl.value.trim() || "(not provided)";

  return `You are an expert SCADA project manager. Using the information below, produce a detailed Work Breakdown Structure (WBS) for this project.

=== CLIENT SCOPE ===
${scope}

=== HARDWARE / PLC CONSTRAINTS ===
${constraints}

=== AVAILABLE RESOURCES ===
${resources}

=== OUTPUT REQUIREMENTS ===
Return ONLY a JSON array of task objects, with no extra commentary or markdown formatting. Each object must follow this exact shape:

[
  {
    "title": "Short, actionable task title",
    "body": "A clear description of the task, including relevant technical detail, acceptance criteria, and any dependencies.",
    "labels": ["optional", "label", "strings"]
  }
]

Break the project down into concrete, sequenced tasks suitable for direct upload as GitHub Issues (e.g. engineering, procurement, configuration, testing, commissioning, documentation phases as applicable).`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn("Clipboard API failed, falling back:", err);
    // Fallback for older/insecure contexts
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (fallbackErr) {
      console.warn("Fallback copy failed:", fallbackErr);
    }
    document.body.removeChild(textarea);
    return success;
  }
}

generatePromptBtn.addEventListener("click", async () => {
  const prompt = buildMasterPrompt();
  promptPreview.value = prompt;
  promptPreviewWrap.classList.remove("hidden");

  const copied = await copyToClipboard(prompt);
  if (copied) {
    generatePromptBtn.textContent = "Copied to Clipboard ✓";
  } else {
    generatePromptBtn.textContent = "Generated (copy manually below)";
  }
  setTimeout(() => {
    generatePromptBtn.textContent = "Generate Master Prompt";
  }, 2500);
});

/* ---------------------------------------------------------
   GitHub Dispatcher
--------------------------------------------------------- */
function logStatus(message, type = "info") {
  statusLog.classList.remove("hidden");
  const line = document.createElement("div");
  const colors = {
    info: "text-slate-300",
    success: "text-emerald-400",
    error: "text-rose-400",
  };
  line.className = colors[type] || colors.info;
  line.textContent = message;
  statusLog.appendChild(line);
  statusLog.scrollTop = statusLog.scrollHeight;
}

function setDispatchLoading(isLoading) {
  dispatchBtn.disabled = isLoading;
  dispatchSpinner.classList.toggle("hidden", !isLoading);
  dispatchBtnLabel.textContent = isLoading ? "Dispatching..." : "Dispatch to GitHub";
}

function validateTasks(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("Task JSON is not valid JSON. Check for trailing commas or unescaped characters.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Task JSON must be an array of task objects.");
  }
  if (parsed.length === 0) {
    throw new Error("Task array is empty — nothing to dispatch.");
  }
  parsed.forEach((task, i) => {
    if (!task || typeof task !== "object" || !task.title || typeof task.title !== "string") {
      throw new Error(`Task at index ${i} is missing a required "title" string.`);
    }
  });
  return parsed;
}

dispatchBtn.addEventListener("click", async () => {
  statusLog.innerHTML = "";
  statusLog.classList.add("hidden");

  const owner = repoOwnerEl.value.trim();
  const repo = repoNameEl.value.trim();
  const token = ghTokenEl.value.trim();
  const rawJson = taskJsonEl.value.trim();

  if (!owner || !repo || !token) {
    logStatus("Please fill in Repo Owner, Repo Name, and GitHub PAT.", "error");
    alert("Missing GitHub Repo Owner, Repo Name, or Personal Access Token.");
    return;
  }

  let tasks;
  try {
    tasks = validateTasks(rawJson);
  } catch (err) {
    logStatus(err.message, "error");
    alert(err.message);
    return;
  }

  saveSettings();

  const octokit = new Octokit({ auth: token });

  setDispatchLoading(true);
  logStatus(`Starting dispatch of ${tasks.length} task(s) to ${owner}/${repo}...`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const response = await octokit.rest.issues.create({
        owner,
        repo,
        title: task.title,
        body: task.body || "",
        labels: Array.isArray(task.labels) ? task.labels : undefined,
      });
      successCount++;
      logStatus(`✓ [${i + 1}/${tasks.length}] Created issue #${response.data.number}: "${task.title}"`, "success");
    } catch (err) {
      failCount++;
      const message = err?.response?.data?.message || err.message || "Unknown error";
      logStatus(`✗ [${i + 1}/${tasks.length}] Failed: "${task.title}" — ${message}`, "error");
    }
  }

  setDispatchLoading(false);

  if (failCount === 0) {
    logStatus(`All ${successCount} issue(s) created successfully.`, "success");
    alert(`Success: ${successCount} issue(s) created in ${owner}/${repo}.`);
  } else {
    logStatus(`Finished with ${successCount} succeeded, ${failCount} failed.`, "error");
    alert(`Dispatch finished: ${successCount} succeeded, ${failCount} failed. See log for details.`);
  }
});

/* Persist settings whenever the checkbox or fields change */
[repoOwnerEl, repoNameEl, ghTokenEl].forEach((el) =>
  el.addEventListener("change", () => {
    if (rememberTokenEl.checked) saveSettings();
  })
);
rememberTokenEl.addEventListener("change", saveSettings);
