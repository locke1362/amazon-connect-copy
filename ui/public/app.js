const API = "";
let exportData = null;
let importData = null;

const COMPONENT_DEFS = [
  { key: "prompts", label: "Prompts", icon: "🔊" },
  { key: "hours", label: "Hours of Operations", icon: "🕐" },
  { key: "queues", label: "Queues", icon: "📋" },
  { key: "routingProfiles", label: "Routing Profiles", icon: "🔀" },
  { key: "modules", label: "Contact Flow Modules", icon: "🧩" },
  { key: "flows", label: "Contact Flows", icon: "📞" },
];

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`.tab:nth-child(${tab === "export" ? 1 : 2})`).classList.add("active");
  document.getElementById(`panel-${tab}`).classList.add("active");
}

function setStatus(id, type, msg) {
  const el = document.getElementById(id);
  el.className = `status ${type}`;
  el.innerHTML = msg;
}

function clearStatus(id) {
  const el = document.getElementById(id);
  el.className = "status";
  el.innerHTML = "";
}

function getInstanceValue(prefix) {
  const dropdown = document.getElementById(`${prefix}-alias`);
  const manual = document.getElementById(`${prefix}-alias-manual`);
  return manual.value.trim() || dropdown.value;
}

// ─── LIST INSTANCES ───

async function listInstances(prefix) {
  const profile = document.getElementById(`${prefix}-profile`).value.trim();
  const region = document.getElementById(`${prefix}-region`).value.trim();
  const statusId = prefix === "src" ? "export-status" : "import-status";
  const btn = document.getElementById(`btn-list-${prefix}`);

  btn.disabled = true;
  btn.textContent = "Loading...";
  clearStatus(statusId);

  try {
    const params = new URLSearchParams();
    if (profile) params.set("profile", profile);
    if (region) params.set("region", region);

    const res = await fetch(`${API}/api/instances?${params}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to list instances");
    }

    const instances = await res.json();
    populateDropdown(prefix, instances, false);

    if (instances.length === 0) {
      setStatus(statusId, "info", `No instances in ${region || "us-east-1"}. Try "Scan All Regions" to search everywhere.`);
    } else {
      setStatus(statusId, "success", `Found ${instances.length} instance(s) in ${region || "us-east-1"}.`);
    }
  } catch (e) {
    setStatus(statusId, "error", e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "List Instances";
  }
}

async function scanRegions(prefix) {
  const profile = document.getElementById(`${prefix}-profile`).value.trim();
  const statusId = prefix === "src" ? "export-status" : "import-status";
  const btn = document.getElementById(`btn-scan-${prefix}`);

  btn.disabled = true;
  btn.textContent = "Scanning...";
  clearStatus(statusId);

  try {
    const params = new URLSearchParams();
    if (profile) params.set("profile", profile);

    const res = await fetch(`${API}/api/scan-regions?${params}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to scan regions");
    }

    const instances = await res.json();
    populateDropdown(prefix, instances, true);

    if (instances.length === 0) {
      setStatus(statusId, "error", "No Connect instances found in any region. Check your AWS credentials/profile.");
    } else {
      setStatus(statusId, "success", `Found ${instances.length} instance(s) across all regions.`);
    }
  } catch (e) {
    setStatus(statusId, "error", e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Scan All Regions";
  }
}

function populateDropdown(prefix, instances, showRegion) {
  const select = document.getElementById(`${prefix}-alias`);
  select.innerHTML = "";

  if (instances.length === 0) {
    select.innerHTML = '<option value="">No instances found</option>';
    return;
  }

  select.innerHTML = '<option value="">— select an instance —</option>';
  for (const inst of instances) {
    const opt = document.createElement("option");
    opt.value = inst.alias || inst.id;
    opt.dataset.region = inst.region || "";
    const regionLabel = showRegion && inst.region ? ` [${inst.region}]` : "";
    opt.textContent = `${inst.alias} (${inst.id})${regionLabel}`;
    select.appendChild(opt);
  }

  // Auto-fill region when user picks from scan results
  if (showRegion) {
    select.onchange = () => {
      const selected = select.options[select.selectedIndex];
      if (selected && selected.dataset.region) {
        document.getElementById(`${prefix}-region`).value = selected.dataset.region;
      }
    };
  }
}

// ─── EXPORT ───

async function fetchComponents() {
  const alias = getInstanceValue("src");
  const profile = document.getElementById("src-profile").value.trim();
  const region = document.getElementById("src-region").value.trim();

  if (!alias) {
    setStatus("export-status", "error", "Please enter an instance alias.");
    return;
  }

  const btn = document.getElementById("btn-fetch");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Fetching...';
  clearStatus("export-status");

  try {
    // Fetch all components to get counts
    const allKeys = COMPONENT_DEFS.map((c) => c.key);
    const res = await fetch(`${API}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: profile || undefined,
        region: region || "us-east-1",
        instanceAlias: alias,
        components: allKeys,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to fetch");
    }

    exportData = await res.json();
    renderExportGrid();
    document.getElementById("export-components").style.display = "block";
    setStatus("export-status", "success", `Connected to instance "${alias}" successfully.`);
  } catch (e) {
    setStatus("export-status", "error", e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Fetch Components";
  }
}

function renderExportGrid() {
  const grid = document.getElementById("export-grid");
  grid.innerHTML = "";
  for (const def of COMPONENT_DEFS) {
    const items = exportData.components[def.key] || [];
    const count = Array.isArray(items) ? items.length : 0;
    const card = document.createElement("div");
    card.className = "component-card selected";
    card.innerHTML = `
      <span class="component-icon">${def.icon}</span>
      <div class="info">
        <div class="name">${def.label}</div>
        <div class="count">${count} item${count !== 1 ? "s" : ""}</div>
      </div>
      <input type="checkbox" checked data-key="${def.key}" onclick="event.stopPropagation()">
    `;
    card.onclick = () => {
      const cb = card.querySelector("input");
      cb.checked = !cb.checked;
      card.classList.toggle("selected", cb.checked);
      syncSelectAll("export");
    };
    card.querySelector("input").onchange = () => {
      card.classList.toggle("selected", card.querySelector("input").checked);
      syncSelectAll("export");
    };
    grid.appendChild(card);
  }
  syncSelectAll("export");
}

function toggleAllExport(checked) {
  document.querySelectorAll("#export-grid input[type=checkbox]").forEach((cb) => {
    cb.checked = checked;
    cb.closest(".component-card").classList.toggle("selected", checked);
  });
}

function toggleAllImport(checked) {
  document.querySelectorAll("#import-grid input[type=checkbox]").forEach((cb) => {
    cb.checked = checked;
    cb.closest(".component-card").classList.toggle("selected", checked);
  });
}

function syncSelectAll(panel) {
  const gridId = panel === "export" ? "export-grid" : "import-grid";
  const selectAllId = panel === "export" ? "export-select-all" : "import-select-all";
  const boxes = document.querySelectorAll(`#${gridId} input[type=checkbox]`);
  const allChecked = [...boxes].every((cb) => cb.checked);
  document.getElementById(selectAllId).checked = allChecked;
}

function getSelectedExportKeys() {
  return [...document.querySelectorAll("#export-grid input[type=checkbox]:checked")].map(
    (cb) => cb.dataset.key
  );
}

function downloadExport() {
  const selected = getSelectedExportKeys();
  if (selected.length === 0) {
    setStatus("export-status", "error", "Select at least one component to export.");
    return;
  }

  // Filter export data to only selected components
  const filtered = {
    instance: exportData.instance,
    components: {},
  };
  for (const key of selected) {
    if (exportData.components[key]) {
      filtered.components[key] = exportData.components[key];
    }
  }

  const blob = new Blob([JSON.stringify(filtered, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `connect-export-${exportData.instance.InstanceAlias || exportData.instance.Id || "instance"}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("export-status", "success", "Export downloaded.");
}

// ─── IMPORT ───

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importData = JSON.parse(e.target.result);
      showImportLoaded(file.name);
    } catch (err) {
      setStatus("import-status", "error", "Invalid JSON file.");
    }
  };
  reader.readAsText(file);
}

// Drag and drop
const dropZone = document.getElementById("drop-zone");
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        importData = JSON.parse(ev.target.result);
        showImportLoaded(file.name);
      } catch (err) {
        setStatus("import-status", "error", "Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }
});

function showImportLoaded(filename) {
  document.getElementById("drop-zone").style.display = "none";
  document.getElementById("import-loaded").style.display = "block";
  const alias = importData.instance?.InstanceAlias || importData.instance?.alias || "unknown";
  document.getElementById("loaded-badge").textContent = `Loaded: ${filename} (source: ${alias})`;
  document.getElementById("import-config").style.display = "block";
  renderImportGrid();
  clearStatus("import-status");
}

function clearImport() {
  importData = null;
  document.getElementById("drop-zone").style.display = "block";
  document.getElementById("import-loaded").style.display = "none";
  document.getElementById("import-config").style.display = "none";
  document.getElementById("import-results").innerHTML = "";
  document.getElementById("file-input").value = "";
  clearStatus("import-status");
}

function renderImportGrid() {
  const grid = document.getElementById("import-grid");
  grid.innerHTML = "";
  for (const def of COMPONENT_DEFS) {
    const items = importData.components?.[def.key] || [];
    const count = Array.isArray(items) ? items.length : 0;
    if (count === 0) continue;
    const card = document.createElement("div");
    card.className = "component-card selected";
    card.innerHTML = `
      <span class="component-icon">${def.icon}</span>
      <div class="info">
        <div class="name">${def.label}</div>
        <div class="count">${count} item${count !== 1 ? "s" : ""}</div>
      </div>
      <input type="checkbox" checked data-key="${def.key}" onclick="event.stopPropagation()">
    `;
    card.onclick = () => {
      const cb = card.querySelector("input");
      cb.checked = !cb.checked;
      card.classList.toggle("selected", cb.checked);
      syncSelectAll("import");
    };
    card.querySelector("input").onchange = () => {
      card.classList.toggle("selected", card.querySelector("input").checked);
      syncSelectAll("import");
    };
    grid.appendChild(card);
  }
  syncSelectAll("import");
}

function getSelectedImportKeys() {
  return [...document.querySelectorAll("#import-grid input[type=checkbox]:checked")].map(
    (cb) => cb.dataset.key
  );
}

async function restoreComponents() {
  const alias = getInstanceValue("dst");
  const profile = document.getElementById("dst-profile").value.trim();
  const region = document.getElementById("dst-region").value.trim();
  const selected = getSelectedImportKeys();

  if (!alias) {
    setStatus("import-status", "error", "Please enter a destination instance alias.");
    return;
  }
  if (selected.length === 0) {
    setStatus("import-status", "error", "Select at least one component to restore.");
    return;
  }

  const btn = document.getElementById("btn-restore");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Restoring...';
  clearStatus("import-status");
  document.getElementById("import-results").innerHTML = "";

  try {
    const res = await fetch(`${API}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: profile || undefined,
        region: region || "us-east-1",
        instanceAlias: alias,
        exportData: importData,
        components: selected,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to restore");
    }

    const results = await res.json();
    renderImportResults(results);

    const totalOps = results.created.length + results.updated.length;
    if (results.errors.length === 0) {
      setStatus("import-status", "success", `Restore complete. ${totalOps} operations performed.`);
    } else {
      setStatus(
        "import-status",
        "error",
        `Restore finished with ${results.errors.length} error(s). ${totalOps} operations succeeded.`
      );
    }
  } catch (e) {
    setStatus("import-status", "error", e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Restore to Destination";
  }
}

function renderImportResults(results) {
  const container = document.getElementById("import-results");
  let html = "";
  for (const item of results.created) {
    html += `<div class="item">✅ Created: ${item}</div>`;
  }
  for (const item of results.updated) {
    html += `<div class="item">🔄 Updated: ${item}</div>`;
  }
  for (const item of results.errors) {
    html += `<div class="item error-item">❌ ${item}</div>`;
  }
  container.innerHTML = html;
}
