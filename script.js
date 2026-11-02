// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(registration => {
      console.log('SW registered:', registration);
      const pwaStatus = document.getElementById('pwa-status');
      if (pwaStatus) {
        pwaStatus.classList.remove('hidden');
        pwaStatus.classList.add('inline-flex');
      }
    }).catch(error => {
      console.log('SW registration failed:', error);
    });
  });
}


// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQF-dVNCimVYFht-LgwEeKT4rEtW-IDphibc5oSV60YBjLxGn4KGT45nU2U58EfBCYbF0UdDxdoe88r/pub?gid=0&single=true&output=csv";
const COMPANY = "Risha Vishal Electrical & Construction Co. Ltd.";

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let allMaterials = [];
let jobs = [];
let currentSuggestions = [];
let selectedSuggestionIndex = -1;
let currentJobIndex = 0;
let pendingItem = null;
let tmpSkuCounter = 0;
let cloudSyncUrl = localStorage.getItem('cloudSyncUrl') || '';

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
window.onload = () => {
  document.getElementById('date').value = new Date().toISOString().split('T')[0];
  document.getElementById('syncUrl').value = cloudSyncUrl;
  addNewSection();
  loadMaterials();
  recalcSummary();
};

// ─────────────────────────────────────────────
//  MATERIALS LOAD & SYNC
// ─────────────────────────────────────────────
async function loadMaterials(forceRefresh = false) {
  const status = document.getElementById('status');
  status.innerHTML = '<span class="material-symbols-outlined text-[14px]">hourglass_empty</span> Loading...';
  
  try {
    if (cloudSyncUrl && forceRefresh) {
        status.innerHTML = '<span class="material-symbols-outlined text-[14px]">cloud_sync</span> Syncing...';
        showToast('Syncing with Cloud...');
        const res = await fetch(cloudSyncUrl, { method: 'GET' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        
        if (data && data.materials) {
             allMaterials = data.materials;
             status.innerHTML = '<span class="material-symbols-outlined text-[14px] text-green-400">check_circle</span> ' + allMaterials.length + ' items';
             showToast('Sync Successful');
             return;
        }
    }

    // Fallback to CSV
    const fetchUrl = forceRefresh ? CSV_URL + '&t=' + Date.now() : CSV_URL;
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const parsed = parseCSV(text);
    if (!parsed.length) throw new Error('Empty');
    allMaterials = parsed;
    status.innerHTML = '<span class="material-symbols-outlined text-[14px] text-green-400">check_circle</span> ' + allMaterials.length + ' items';
    if(forceRefresh) showToast('Catalogue Refreshed from CSV');

  } catch (err) {
    status.innerHTML = '<span class="material-symbols-outlined text-[14px] text-red-400">error</span> Error/Offline';
    console.error(err);
    if(forceRefresh) showToast('Sync Failed (Offline or Error)');
  }
}

async function syncToCloud() {
    if (!cloudSyncUrl) {
        showToast('Please configure Sync URL in Settings');
        openSettingsModal();
        return;
    }
    const state = collectState();
    showToast('Syncing...');
    try {
        const res = await fetch(cloudSyncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast('Sync Successful');
    } catch (err) {
        console.error(err);
        showToast('Sync Failed');
    }
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  return lines.slice(1).map(line => {
    const values = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim()); current = '';
      } else { current += ch; }
    }
    values.push(current.trim());
    const rawPrice = values[3] ? values[3].trim().replace(/[$,TTD ]/g, '') : '';
    const price = rawPrice !== '' && !isNaN(parseFloat(rawPrice)) ? parseFloat(rawPrice) : null;
    return { SKU: values[0]||'', Item: values[1]||'', Unit: values[2]||'', Price: price };
  }).filter(m => m.Item);
}

// ─────────────────────────────────────────────
//  SETTINGS MODAL
// ─────────────────────────────────────────────
function openSettingsModal() {
    document.getElementById('syncUrl').value = cloudSyncUrl;
    document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
}
function saveSettingsModal() {
    cloudSyncUrl = document.getElementById('syncUrl').value.trim();
    localStorage.setItem('cloudSyncUrl', cloudSyncUrl);
    closeSettingsModal();
    showToast('Settings Saved');
}


// ─────────────────────────────────────────────
//  SECTION MANAGEMENT
// ─────────────────────────────────────────────
function addNewSection() {
  const idx = jobs.length;
  jobs.push({ scope: '', addedItems: [], tmpItems: [] });
  const container = document.getElementById('jobSections');
  const el = document.createElement('div');
  el.id = 'job-section-' + idx;
  el.className = 'panel';
  el.dataset.jobIndex = idx;
  el.innerHTML = buildSectionHTML(idx);
  container.appendChild(el);
  if (idx > 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildSectionHTML(idx) {
  const isFirst = idx === 0;
  const headerContent = `
    <div class="flex justify-between items-center mb-4">
      <h2 class="title-white flex items-center gap-2">
        <span class="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">${idx+1}</span>
        Section ${idx+1}
      </h2>
      ${!isFirst ? `<button onclick="removeSection(${idx})" class="text-red-400 p-1"><span class="material-symbols-outlined">delete</span></button>` : ''}
    </div>
  `;

  return `
    ${headerContent}
    
    <div class="mb-5">
      <label class="field-label">Scope of Work</label>
      <textarea id="scope-${idx}" class="field-input" rows="2" placeholder="Brief description..." oninput="jobs[${idx}].scope=this.value">${jobs[idx].scope}</textarea>
    </div>

    <!-- Search Bar -->
    <div class="relative mb-6 z-10">
      <div class="relative">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
        <input id="searchOther-${idx}" type="text" placeholder="Search catalogue..." 
          class="field-input pl-10" oninput="filterOther(${idx})"
          onkeydown="handleSearchKey(event,${idx})" autocomplete="off">
      </div>
      <ul id="suggestionList-${idx}" class="suggestion-list hidden"></ul>
    </div>

    <!-- Lists -->
    <div id="mobileListContainer-${idx}" class="space-y-2 mb-4">
       <!-- Items will be injected here as mobile cards -->
       <div class="text-center py-4 text-sm text-slate-500 italic" id="empty-state-${idx}">No items added yet.</div>
    </div>

    <button onclick="openAddModal(${idx})" class="w-full btn-outline py-3 border-dashed border-slate-500 text-slate-400 hover:text-white hover:border-slate-300">
      <span class="material-symbols-outlined">add</span> Add Custom / Unlisted Item
    </button>
  `;
}

function removeSection(jobIndex) {
  if (jobs.length <= 1) return;
  if (!confirm('Remove this section?')) return;
  saveAllScopes();
  jobs.splice(jobIndex, 1);
  reRenderAllSections();
  currentJobIndex = Math.min(currentJobIndex, jobs.length - 1);
}

function saveAllScopes() {
  jobs.forEach((job, i) => { const el = document.getElementById('scope-' + i); if (el) job.scope = el.value; });
}

function reRenderAllSections() {
  saveAllScopes();
  const container = document.getElementById('jobSections');
  container.innerHTML = '';
  jobs.forEach((_, i) => {
    const el = document.createElement('div');
    el.id = 'job-section-' + i;
    el.className = 'panel';
    el.dataset.jobIndex = i;
    el.innerHTML = buildSectionHTML(i);
    container.appendChild(el);
    renderMobileLists(i);
  });
}

// ─────────────────────────────────────────────
//  SEARCH / SUGGESTIONS
// ─────────────────────────────────────────────
function filterOther(jobIndex) {
  currentJobIndex = jobIndex;
  const searchInput = document.getElementById('searchOther-' + jobIndex);
  const list = document.getElementById('suggestionList-' + jobIndex);
  selectedSuggestionIndex = -1;
  if (!searchInput || !list) { hideSuggestions(); return; }
  const term = searchInput.value.toLowerCase().trim();
  if (!term) { hideSuggestions(); return; }
  currentSuggestions = allMaterials
    .filter(m => m.Item.toLowerCase().includes(term) || m.SKU.toLowerCase().includes(term))
    .slice(0, 15);
  if (!currentSuggestions.length) { hideSuggestions(); return; }
  
  list.innerHTML = currentSuggestions.map((m, i) =>
    `<li id="sug-${jobIndex}-${i}" onmousedown="event.preventDefault()" onclick="selectSuggestion(${i},${jobIndex})">
      <div class="flex flex-col w-full">
        <span class="text-sm font-semibold text-slate-200 truncate">${m.Item}</span>
        <div class="flex justify-between items-center mt-1">
          <span class="font-mono text-[10px] text-blue-400">${m.SKU}</span>
          <span class="text-[10px] text-slate-500 uppercase">${m.Unit}</span>
        </div>
      </div>
    </li>`
  ).join('');
  list.classList.remove('hidden');
}

function hideSuggestions() {
  document.querySelectorAll('[id^="suggestionList-"]').forEach(el => el.classList.add('hidden'));
  currentSuggestions = []; selectedSuggestionIndex = -1;
}

function highlightSuggestion() {
  const list = document.getElementById('suggestionList-' + currentJobIndex);
  if (!list) return;
  Array.from(list.querySelectorAll('li')).forEach((li, i) => {
    if (i === selectedSuggestionIndex) li.classList.add('bg-slate-700');
    else li.classList.remove('bg-slate-700');
  });
}

function handleSearchKey(e, jobIndex) {
  currentJobIndex = jobIndex;
  const list = document.getElementById('suggestionList-' + jobIndex);
  const open = list && !list.classList.contains('hidden');
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) return; selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentSuggestions.length - 1); highlightSuggestion(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) return; selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1); highlightSuggestion(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (open && selectedSuggestionIndex >= 0) selectSuggestion(selectedSuggestionIndex, jobIndex); else addSearchedItem(jobIndex); }
  else if (e.key === 'Escape') { hideSuggestions(); }
}

function selectSuggestion(index, jobIndex) {
  currentJobIndex = jobIndex;
  const m = currentSuggestions[index];
  if (!m) return;
  hideSuggestions();
  const input = document.getElementById('searchOther-' + jobIndex);
  if (input) input.value = '';
  openQtyModal(m);
}

function addSearchedItem(jobIndex) {
  currentJobIndex = jobIndex;
  if (currentSuggestions.length > 0) { selectSuggestion(selectedSuggestionIndex >= 0 ? selectedSuggestionIndex : 0, jobIndex); return; }
}

// ─────────────────────────────────────────────
//  QTY MODAL
// ─────────────────────────────────────────────
function openQtyModal(m) {
  pendingItem = m;
  document.getElementById('qtyModalTitle').textContent = m.Item;
  document.getElementById('qtyModalSku').textContent   = m.SKU;
  document.getElementById('qtyModalUnit').textContent  = m.Unit;
  document.getElementById('qtyModalQty').value = '1';
  document.getElementById('qtyModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('qtyModalQty').select(), 50);
}
function closeQtyModal() { document.getElementById('qtyModal').classList.add('hidden'); pendingItem = null; }
function confirmQtyModal() {
  if (!pendingItem) return;
  addItemToList(pendingItem.SKU, pendingItem.Item, pendingItem.Unit, parseFloat(document.getElementById('qtyModalQty').value) || 1, pendingItem.Price, currentJobIndex);
  closeQtyModal();
}

// ─────────────────────────────────────────────
//  MOBILE LIST RENDERING
// ─────────────────────────────────────────────
function addItemToList(sku, itemName, unit, qty, price, jobIndex) {
  jobIndex = jobIndex ?? currentJobIndex;
  const job = jobs[jobIndex]; if (!job) return;
  qty = qty || 1; price = price !== undefined ? price : null;
  const existing = job.addedItems.find(i => sku !== '—' ? i.SKU === sku : i.Item.toLowerCase() === itemName.toLowerCase());
  if (existing) { existing.Qty += qty; renderMobileLists(jobIndex); return; }
  job.addedItems.push({ SKU: sku, Item: itemName, Unit: unit, Qty: qty, Price: price });
  renderMobileLists(jobIndex);
}

function updateItemQty(jobIndex, type, index, diff) {
  const job = jobs[jobIndex]; if (!job) return;
  const list = type === 'cat' ? job.addedItems : job.tmpItems;
  const item = list[index];
  let newQty = item.Qty + diff;
  if (newQty <= 0) {
    if (confirm('Remove this item?')) list.splice(index, 1);
  } else {
    item.Qty = newQty;
  }
  renderMobileLists(jobIndex);
}

function setItemQty(jobIndex, type, index, val) {
  const job = jobs[jobIndex]; if (!job) return;
  const list = type === 'cat' ? job.addedItems : job.tmpItems;
  let newQty = parseFloat(val);
  if (isNaN(newQty) || newQty <= 0) {
     if (confirm('Remove this item?')) list.splice(index, 1);
     else list[index].Qty = 1;
  } else {
    list[index].Qty = newQty;
  }
  renderMobileLists(jobIndex);
}

function updateTmpPriceMobile(jobIndex, index, val) {
  const job = jobs[jobIndex]; if (!job) return;
  job.tmpItems[index].Price = parseFloat(val) || 0;
  recalcSummary();
  renderMobileLists(jobIndex); // re-render to update line total
}

function renderMobileLists(jobIndex) {
  const job = jobs[jobIndex];
  const container = document.getElementById(`mobileListContainer-${jobIndex}`);
  const emptyState = document.getElementById(`empty-state-${jobIndex}`);
  
  if (!container) return;
  
  // Clear existing items but keep empty state
  Array.from(container.children).forEach(child => {
    if (child.id !== `empty-state-${jobIndex}`) child.remove();
  });

  const hasItems = job.addedItems.length > 0 || job.tmpItems.length > 0;
  if (emptyState) emptyState.style.display = hasItems ? 'none' : 'block';
  
  let html = '';

  // Render Catalogue Items
  job.addedItems.forEach((item, i) => {
    const up = item.Price !== null && item.Price !== undefined ? item.Price : null;
    const tp = up !== null ? (item.Qty * up).toFixed(2) : 'N/A';
    html += buildMobileCard(jobIndex, 'cat', i, item, up, tp);
  });

  // Render Custom Items
  if (job.tmpItems.length > 0 && job.addedItems.length > 0) {
    html += `<div class="text-xs font-bold text-slate-500 uppercase tracking-wider mt-4 mb-2">Custom Items</div>`;
  }
  
  job.tmpItems.forEach((item, i) => {
    const tp = (item.Qty * (item.Price||0)).toFixed(2);
    html += buildMobileCard(jobIndex, 'tmp', i, item, item.Price, tp, true);
  });

  container.insertAdjacentHTML('beforeend', html);
  recalcSummary();
}

function buildMobileCard(jobIndex, type, i, item, up, tp, isCustom = false) {
  const priceInput = isCustom 
    ? `<input type="number" value="${(item.Price||0).toFixed(2)}" class="field-input py-1 px-2 text-xs w-20 text-right" onchange="updateTmpPriceMobile(${jobIndex}, ${i}, this.value)">`
    : `<span class="text-slate-400 text-sm">${up !== null ? '$' + up.toFixed(2) : 'N/A'}</span>`;

  return `
    <div class="mobile-list-item">
      <div class="flex justify-between items-start mb-2">
        <div class="pr-2">
          <div class="font-semibold text-sm leading-tight text-slate-200">${item.Item}</div>
          <div class="flex items-center gap-2 mt-1">
            <span class="font-mono text-[10px] ${isCustom ? 'text-purple-400' : 'text-blue-400'}">${item.SKU}</span>
            <span class="text-[10px] text-slate-500 uppercase">${item.Unit}</span>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold text-emerald-400 text-sm whitespace-nowrap">${tp !== 'N/A' ? '$' + tp : 'N/A'}</div>
          <div class="mt-1">${priceInput}</div>
        </div>
      </div>
      
      <div class="flex items-center justify-between border-t border-slate-700 pt-2 mt-2">
        <div class="flex items-center bg-slate-800 rounded-md overflow-hidden border border-slate-600">
          <button onclick="updateItemQty(${jobIndex}, '${type}', ${i}, -1)" class="px-3 py-1 bg-slate-700 active:bg-slate-600 text-slate-300">-</button>
          <input type="number" value="${item.Qty}" class="w-12 text-center bg-transparent border-none text-sm font-bold text-white p-0 focus:ring-0" onchange="setItemQty(${jobIndex}, '${type}', ${i}, this.value)">
          <button onclick="updateItemQty(${jobIndex}, '${type}', ${i}, 1)" class="px-3 py-1 bg-slate-700 active:bg-slate-600 text-slate-300">+</button>
        </div>
        <button onclick="updateItemQty(${jobIndex}, '${type}', ${i}, -9999)" class="text-red-400 p-2">
           <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────
//  UNLISTED ITEMS
// ─────────────────────────────────────────────
function nextTmpSku() { tmpSkuCounter++; return 'TMP-' + String(tmpSkuCounter).padStart(3,'0'); }

function openAddModal(jobIndex) {
  currentJobIndex = jobIndex;
  document.getElementById('modalItemName').value = '';
  document.getElementById('modalQty').value = '1';
  document.getElementById('modalUnitPrice').value = '0.00';
  document.getElementById('modalSkuPreview').textContent = 'TMP-' + String(tmpSkuCounter+1).padStart(3,'0');
  document.getElementById('addModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('modalItemName').focus(), 50);
}
function closeAddModal() { document.getElementById('addModal').classList.add('hidden'); }
function confirmAddModal() {
  const name = document.getElementById('modalItemName').value.trim();
  if (!name) return;
  jobs[currentJobIndex].tmpItems.push({ 
    SKU: nextTmpSku(), 
    Item: name, 
    Unit: 'each', 
    Qty: parseFloat(document.getElementById('modalQty').value)||1, 
    Price: parseFloat(document.getElementById('modalUnitPrice').value)||0 
  });
  renderMobileLists(currentJobIndex); 
  closeAddModal();
}

// ─────────────────────────────────────────────
//  SUMMARY RECALC
// ─────────────────────────────────────────────
function validatePct(input) { const v = parseFloat(input.value); if (isNaN(v)||v<0) input.value=0; if (v>999) input.value=999; }

function recalcSummary() {
  let matSubtotal = 0, hasNA = false;
  jobs.forEach(job => {
    job.addedItems.forEach(item => { if (item.Price!==null&&item.Price!==undefined) matSubtotal+=item.Qty*item.Price; else hasNA=true; });
    job.tmpItems.forEach(item   => { if (item.Price!==null&&item.Price!==undefined) matSubtotal+=item.Qty*item.Price; else hasNA=true; });
  });

  const markupPct = Math.max(0, parseFloat(document.getElementById('pct-markup').value)||0);
  const vatPct    = Math.max(0, parseFloat(document.getElementById('pct-vat').value)   ||0);
  const markup = matSubtotal * (markupPct/100);
  const vat    = (matSubtotal+markup) * (vatPct/100);

  const labour     = Math.max(0, parseFloat(document.getElementById('labourCost').value)     ||0);
  const inspection = Math.max(0, parseFloat(document.getElementById('inspectionCost').value) ||0);

  const total = matSubtotal + markup + vat + labour + inspection;
  const na = hasNA ? ' + N/A' : '';

  document.getElementById('bar-materials').textContent  = '$' + matSubtotal.toFixed(2) + na;
  document.getElementById('bar-markup').textContent     = '$' + markup.toFixed(2);
  document.getElementById('bar-vat').textContent        = '$' + vat.toFixed(2);
  document.getElementById('bar-labour').textContent     = '$' + labour.toFixed(2);
  document.getElementById('bar-inspection').textContent = '$' + inspection.toFixed(2);
  document.getElementById('bar-total').textContent      = '$' + total.toFixed(2) + na;
}

// ─────────────────────────────────────────────
//  SERIALISE / DESERIALISE
// ─────────────────────────────────────────────
function collectState() {
  saveAllScopes();
  return {
    version:      1,
    savedAt:      new Date().toISOString(),
    customer:     document.getElementById('customer').value,
    address:      document.getElementById('address').value,
    date:         document.getElementById('date').value,
    quoteNo:      document.getElementById('quoteNo').value,
    notes:        document.getElementById('notes').value,
    markupPct:    document.getElementById('pct-markup').value,
    vatPct:       document.getElementById('pct-vat').value,
    tmpSkuCounter,
    labour:     document.getElementById('labourCost').value,
    inspection: document.getElementById('inspectionCost').value,
    jobs: jobs.map(j => ({ scope: j.scope, addedItems: j.addedItems, tmpItems: j.tmpItems }))
  };
}

function applyState(state) {
  document.getElementById('customer').value   = state.customer  || '';
  document.getElementById('address').value    = state.address   || '';
  document.getElementById('date').value       = state.date      || new Date().toISOString().split('T')[0];
  document.getElementById('quoteNo').value    = state.quoteNo   || '';
  document.getElementById('notes').value      = state.notes     || '';
  document.getElementById('pct-markup').value = state.markupPct ?? 27.5;
  document.getElementById('pct-vat').value    = state.vatPct    ?? 12.5;
  tmpSkuCounter = state.tmpSkuCounter || 0;
  document.getElementById('labourCost').value     = state.labour     ?? 0;
  document.getElementById('inspectionCost').value = state.inspection ?? 0;
  jobs = (state.jobs||[]).map(j => ({ scope: j.scope||'', addedItems: j.addedItems||[], tmpItems: j.tmpItems||[] }));
  if (!jobs.length) jobs = [{ scope:'', addedItems:[], tmpItems:[] }];
  reRenderAllSections();
  recalcSummary();
}

function newJob() {
  if (!confirm('Start a new job? This will clear everything.')) return;
  jobs = []; tmpSkuCounter = 0;
  document.getElementById('jobSections').innerHTML = '';
  ['customer','address','quoteNo','notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('date').value = new Date().toISOString().split('T')[0];
  document.getElementById('pct-markup').value = 27.5;
  document.getElementById('pct-vat').value = 12.5;
  document.getElementById('labourCost').value = '0.00';
  document.getElementById('inspectionCost').value = '0.00';
  addNewSection(); recalcSummary();
  showToast('New job started');
}

function saveJobJSON() {
  const state    = collectState();
  const blob     = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8;' });
  const customer = (state.customer||'Job').replace(/[^a-zA-Z0-9]/g,'_');
  const date     = state.date || new Date().toISOString().split('T')[0];
  const filename = 'Job_' + customer + '_' + date + '.json';
  const file     = new File([blob], filename, { type: 'application/json' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Job File' }).catch(() => downloadBlob(blob, filename));
  } else {
    downloadBlob(blob, filename);
  }
  showToast('Saved locally');
}

function loadJobJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = ''; 
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const state = JSON.parse(e.target.result);
      if (!state.jobs || !Array.isArray(state.jobs)) throw new Error('Invalid job file.');
      jobs = []; document.getElementById('jobSections').innerHTML = '';
      applyState(state);
      showToast('Loaded');
    } catch (err) { showToast('Load failed'); }
  };
  reader.readAsText(file);
}

// ─────────────────────────────────────────────
//  EXPORTS (Logic unchanged, collapsed for brevity)
// ─────────────────────────────────────────────
function generatePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PAGE_W=210, PAGE_H=297, ML=15, MR=15, MT=15, MB=20;
  const contentW = PAGE_W - ML - MR;
  let y = MT, pageNum = 1;

  const customer  = document.getElementById('customer').value  || 'Customer';
  const address   = document.getElementById('address').value   || '';
  const dateRaw   = document.getElementById('date').value      || new Date().toISOString().split('T')[0];
  const quoteNo   = document.getElementById('quoteNo').value   || '';
  const notes     = document.getElementById('notes').value     || '';
  const markupPct  = parseFloat(document.getElementById('pct-markup').value)     || 0;
  const vatPct     = parseFloat(document.getElementById('pct-vat').value)        || 0;
  const labour     = Math.max(0, parseFloat(document.getElementById('labourCost').value)     || 0);
  const inspection = Math.max(0, parseFloat(document.getElementById('inspectionCost').value) || 0);
  const dateFmt   = dateRaw ? new Date(dateRaw + 'T00:00:00').toLocaleDateString('en-TT', { year:'numeric', month:'long', day:'numeric' }) : '';

  function addPage() { drawPageNumber(); doc.addPage(); pageNum++; y=MT; drawRunningHeader(); }
  function checkY(n) { if (y+n > PAGE_H-MB) addPage(); }
  function drawPageNumber() {
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text('Page ' + pageNum, PAGE_W/2, PAGE_H-8, { align:'center' });
    doc.text(COMPANY, ML, PAGE_H-8);
    if (quoteNo) doc.text(quoteNo, PAGE_W-MR, PAGE_H-8, { align:'right' });
  }
  function drawRunningHeader() {
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(100,100,100);
    doc.text(COMPANY + (quoteNo ? '  |  ' + quoteNo : ''), ML, y);
    y+=5; doc.setDrawColor(220,220,220); doc.setLineWidth(0.3); doc.line(ML,y,PAGE_W-MR,y); y+=5;
  }
  function hline(c) { doc.setDrawColor(...(c||[220,220,220])); doc.setLineWidth(0.3); doc.line(ML,y,PAGE_W-MR,y); }
  function tableHeader() {
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(100,100,100);
    doc.text('SKU',ML,y); doc.text('QTY',ML+28,y); doc.text('UNIT',ML+40,y); doc.text('DESCRIPTION',ML+60,y);
    doc.text('UNIT $',ML+150,y,{align:'right'}); doc.text('TOTAL TTD',PAGE_W-MR,y,{align:'right'});
    y+=3; hline([180,180,180]); y+=4; doc.setFont('helvetica','normal'); doc.setTextColor(30,30,30);
  }
  function tableRow(item) {
    checkY(8); doc.setFontSize(8.5); doc.setFont('helvetica','normal');
    doc.setTextColor(120,120,120); doc.text(String(item.SKU).substring(0,12),ML,y);
    doc.setTextColor(30,30,30); doc.text(String(item.Qty),ML+28,y); doc.text(String(item.Unit).substring(0,8),ML+40,y);
    const nl = doc.splitTextToSize(item.Item, 65); doc.text(nl,ML+60,y);
    const up = item.Price!==null&&item.Price!==undefined ? item.Price : null;
    const lt = up!==null ? (up*item.Qty).toFixed(2) : 'N/A';
    doc.setTextColor(60,60,60); doc.text(up!==null ? '$'+up.toFixed(2) : 'N/A', ML+150, y, {align:'right'});
    doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30);
    doc.text(lt!=='N/A' ? '$'+lt : 'N/A', PAGE_W-MR, y, {align:'right'});
    doc.setFont('helvetica','normal');
    y += nl.length>1 ? nl.length*5 : 7; hline([240,240,240]); y+=2;
    return up!==null ? up*item.Qty : null;
  }
  function secSubtotal(total, hasNA) {
    checkY(10); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(80,80,80);
    doc.text('Section Subtotal:',ML+90,y); doc.setTextColor(20,20,20);
    doc.text('$'+total.toFixed(2)+(hasNA?' + N/A':''),PAGE_W-MR,y,{align:'right'});
    doc.setFont('helvetica','normal'); y+=8;
  }

  doc.setFillColor(20,24,40); doc.rect(0,0,PAGE_W,38,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(255,255,255); doc.text(COMPANY,ML,14);
  doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(160,175,210); doc.text('Material Cost Sheet',ML,21);
  if (quoteNo) { doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(180,200,255); doc.text('Quote No: '+quoteNo,PAGE_W-MR,14,{align:'right'}); }
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(180,200,255); doc.text('Date: '+dateFmt,PAGE_W-MR,21,{align:'right'});
  y=45;

  doc.setFillColor(240,242,248); doc.roundedRect(ML,y,contentW,18,2,2,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(80,80,80);
  doc.text('CUSTOMER',ML+4,y+6); doc.text('ADDRESS',ML+90,y+6);
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(20,20,20);
  doc.text(customer,ML+4,y+13); doc.text(address,ML+90,y+13);
  y+=24;

  let grandTotal=0, grandNA=false;
  jobs.forEach((job, idx) => {
    if (idx > 0) addPage();
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(50,80,160);
    doc.text('Section '+(idx+1),ML,y); y+=5; hline([100,130,220]); y+=5;
    const sc = job.scope || document.getElementById('scope-'+idx)?.value || '';
    if (sc) {
      doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(80,80,80);
      const sl = doc.splitTextToSize('Scope: '+sc, contentW); checkY(sl.length*5+4); doc.text(sl,ML,y); y+=sl.length*5+4;
    }
    if (job.addedItems.length || job.tmpItems.length) addPage();
    if (job.addedItems.length) {
      checkY(14); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(60,60,60);
      doc.text('MATERIALS FROM CATALOGUE',ML,y); y+=5; tableHeader();
      let st=0,sna=false;
      job.addedItems.forEach(item => { const l=tableRow(item); if(l!==null)st+=l; else sna=true; });
      secSubtotal(st,sna); grandTotal+=st; if(sna)grandNA=true;
    }
    if (job.tmpItems.length) {
      checkY(14); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(60,60,60);
      doc.text('ADDITIONAL / UNLISTED ITEMS',ML,y); y+=5; tableHeader();
      let tt=0,tna=false;
      job.tmpItems.forEach(item => { const l=tableRow(item); if(l!==null)tt+=l; else tna=true; });
      secSubtotal(tt,tna); grandTotal+=tt; if(tna)grandNA=true;
    }
    y+=4;
  });

  if (notes) {
    checkY(16); doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(60,60,60); doc.text('NOTES',ML,y); y+=5;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(80,80,80);
    const nl = doc.splitTextToSize(notes,contentW); checkY(nl.length*5+4); doc.text(nl,ML,y); y+=nl.length*5+8;
  }

  checkY(55);
  const markup = grandTotal*(markupPct/100);
  const vat    = (grandTotal+markup)*(vatPct/100);
  const total  = grandTotal+markup+vat+labour+inspection;
  const naTag  = grandNA ? ' + N/A' : '';
  doc.setFillColor(20,24,40); doc.roundedRect(ML,y,contentW,70,3,3,'F');
  const bL=ML+6, bR=PAGE_W-MR-6; let by=y+9;
  function sl(label,value,big) {
    doc.setFont('helvetica',big?'bold':'normal'); doc.setFontSize(big?10.5:9);
    doc.setTextColor(big?255:180, big?255:195, big?255:230);
    doc.text(label,bL,by); doc.text(value,bR,by,{align:'right'}); by+=big?9:7;
  }
  function sd() { doc.setDrawColor(60,65,100); doc.setLineWidth(0.3); doc.line(bL,by-1,bR,by-1); }
  sl('Materials Subtotal',                     '$'+grandTotal.toFixed(2)+naTag);
  sl('Markup ('+markupPct+'%)',                '$'+markup.toFixed(2));
  sd(); by+=2;
  sl('VAT ('+vatPct+'% on materials+markup)',  '$'+vat.toFixed(2));
  sd(); by+=2;
  sl('Labour',                                 '$'+labour.toFixed(2));
  sl('Inspection',                             '$'+inspection.toFixed(2));
  sd(); by+=3;
  sl('TOTAL QUOTED (TTD)',                     '$'+total.toFixed(2)+naTag, true);

  drawPageNumber();
  const blob = doc.output('blob');
  const fn = 'Quotation_' + customer.replace(/[^a-zA-Z0-9]/g,'_') + '_' + dateRaw + '.pdf';
  const file = new File([blob], fn, { type:'application/pdf' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files:[file] })) {
    navigator.share({ files:[file], title:'Material Cost Sheet' }).catch(() => downloadBlob(blob,fn));
  } else { downloadBlob(blob,fn); }
}

function exportCSV() {
  const customer  = document.getElementById('customer').value  || 'Customer';
  const address   = document.getElementById('address').value   || '';
  const dateRaw   = document.getElementById('date').value      || new Date().toISOString().split('T')[0];
  const quoteNo   = document.getElementById('quoteNo').value   || '';
  const notes     = document.getElementById('notes').value     || '';
  const markupPct = parseFloat(document.getElementById('pct-markup').value) || 0;
  const vatPct    = parseFloat(document.getElementById('pct-vat').value)    || 0;
  const esc = v => typeof v==='number' ? (isFinite(v)?v:'') : '"'+String(v).replace(/"/g,'""')+'"';
  const row = (...cols) => cols.map(esc).join(',');
  const rows = [];
  rows.push(row(COMPANY)); rows.push(row('Material Cost Sheet')); rows.push('');
  rows.push(row('Customer',customer)); rows.push(row('Address',address)); rows.push(row('Date',dateRaw));
  if (quoteNo) rows.push(row('Quote No.',quoteNo)); rows.push('');

  let grand=0, grandNA=false;
  jobs.forEach((job,idx) => {
    rows.push(row('SECTION '+(idx+1)));
    const sc = job.scope || document.getElementById('scope-'+idx)?.value || '';
    if (sc) rows.push(row('Scope',sc)); rows.push('');
    rows.push(row('MATERIALS FROM CATALOGUE'));
    rows.push(row('SKU','Qty','Unit','Description','Unit Price (TTD)','Line Total (TTD)'));
    let st=0,sna=false;
    job.addedItems.forEach(m => {
      const up=m.Price!==null&&m.Price!==undefined?m.Price:null;
      const lt=up!==null?parseFloat((up*m.Qty).toFixed(2)):'N/A';
      rows.push(row(m.SKU,m.Qty,m.Unit,m.Item,up!==null?up:'N/A',lt));
      if(lt!=='N/A')st+=lt; else sna=true;
    });
    rows.push(row('','','','','Section Subtotal',st+(sna?' + N/A':''))); grand+=st; if(sna)grandNA=true; rows.push('');
    if (job.tmpItems.length) {
      rows.push(row('ADDITIONAL / UNLISTED ITEMS'));
      rows.push(row('SKU','Qty','Unit','Description','Unit Price (TTD)','Line Total (TTD)'));
      let tt=0;
      job.tmpItems.forEach(m => { const lt=parseFloat(((m.Price||0)*m.Qty).toFixed(2)); rows.push(row(m.SKU,m.Qty,m.Unit,m.Item,m.Price||0,lt)); tt+=lt; });
      rows.push(row('','','','','Section Subtotal',tt)); grand+=tt; rows.push('');
    }
  });
  const markup=grand*(markupPct/100), vat=(grand+markup)*(vatPct/100), total=grand+markup+vat;
  const naTag=grandNA?' + N/A':'';
  const csvLabour     = Math.max(0, parseFloat(document.getElementById('labourCost').value)     || 0);
  const csvInspection = Math.max(0, parseFloat(document.getElementById('inspectionCost').value) || 0);
  const csvTotal = grand+markup+vat+csvLabour+csvInspection;
  rows.push(row('FINANCIAL SUMMARY'));
  rows.push(row('Materials Subtotal',parseFloat(grand.toFixed(2))));
  rows.push(row('Markup ('+markupPct+'%)',parseFloat(markup.toFixed(2))));
  rows.push(row('VAT ('+vatPct+'% on materials+markup)',parseFloat(vat.toFixed(2))));
  rows.push(row('Labour',parseFloat(csvLabour.toFixed(2))));
  rows.push(row('Inspection',parseFloat(csvInspection.toFixed(2))));
  rows.push(row('TOTAL QUOTED (TTD)',parseFloat(csvTotal.toFixed(2))+naTag));
  rows.push('');
  if (notes) rows.push(row('Notes',notes));
  const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8;' });
  const fn = 'Costing_' + customer.replace(/[^a-zA-Z0-9]/g,'_') + '_' + dateRaw + '.csv';
  const file = new File([blob],fn,{type:'text/csv'});
  if (navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
    navigator.share({files:[file],title:'Material Cost Sheet CSV'}).catch(()=>downloadBlob(blob,fn));
  } else { downloadBlob(blob,fn); }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────
function handleModalOverlayClick(e, modalId) {
  if (e.target.id === modalId) { 
      if(modalId==='addModal')closeAddModal(); 
      if(modalId==='qtyModal')closeQtyModal(); 
      if(modalId==='settingsModal')closeSettingsModal();
  }
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.innerHTML = `<span class="material-symbols-outlined text-sm inline-block align-middle mr-1">check_circle</span> ${msg}`;
  t.classList.add('toast-show');
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('toast-show'),3000);
}

document.addEventListener('keydown', e => { if(e.key==='Escape'){closeAddModal();closeQtyModal();closeSettingsModal();} });
document.addEventListener('click',   e => { if(!e.target.closest('[id^="searchOther-"]')&&!e.target.closest('[id^="suggestionList-"]'))hideSuggestions(); });
