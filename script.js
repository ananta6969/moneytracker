/* ============================
           Data model & persistence
           ============================ */
const LS_KEY = "adv_money_wallets_v1";
const LS_META = "adv_money_meta_v1";

let data = JSON.parse(localStorage.getItem(LS_KEY)) || {
    wallets: {}
};
let meta = JSON.parse(localStorage.getItem(LS_META)) || {
    theme: "light",
    hideBalance: false,
    pin: null,
    autoLogoutMinutes: 0,
    lastActive: Date.now()
};

let currentWallet = localStorage.getItem("currentWallet") || null;
let undoStack = []; // simple undo

/* ============================
   Utilities
   ============================ */
function saveAll() {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    localStorage.setItem(LS_META, JSON.stringify(meta));
    if (currentWallet) localStorage.setItem("currentWallet", currentWallet);
}

function uid() { return 'id' + Math.random().toString(36).slice(2, 9); }

function formatCurrency(v) { return "₹" + Number(v || 0).toLocaleString('en-IN'); }

function ensureDateInput() {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10);
    if (!document.getElementById('txDate').value) document.getElementById('txDate').value = iso;
}

/* ============================
   Init UI
   ============================ */
function init() {
    applyTheme();
    buildWalletSelect();
    if (!currentWallet) {
        // if no wallet, create a sample default wallet
        if (Object.keys(data.wallets).length === 0) {
            const name = "Personal";
            data.wallets[name] = { color: "#60a5fa", initial: 10000, transactions: [], created: Date.now() };
            currentWallet = name;
            saveAll();
        } else {
            currentWallet = Object.keys(data.wallets)[0];
        }
    }
    document.getElementById('walletSelect').value = currentWallet;
    document.getElementById('search').value = "";
    ensureDateInput();
    renderAll();
    startInactivityWatcher();
}

/* ============================
   Wallet functions
   ============================ */
function buildWalletSelect() {
    const sel = document.getElementById('walletSelect');
    sel.innerHTML = "";
    for (const name of Object.keys(data.wallets)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    }
}

function addWallet() {
    const name = prompt("Wallet name (e.g. Personal, Business, Savings):");
    if (!name) return;
    if (data.wallets[name]) { alert("Wallet exists!"); return; }
    const initial = parseFloat(prompt("Initial balance (number)", "0") || "0");
    data.wallets[name] = { color: randomColor(), initial: isNaN(initial) ? 0 : initial, transactions: [], created: Date.now() };
    currentWallet = name;
    saveAll();
    buildWalletSelect();
    document.getElementById('walletSelect').value = currentWallet;
    renderAll();
}

function randomColor() {
    const colors = ["#60a5fa", "#34d399", "#f97316", "#fb7185", "#a78bfa", "#f59e0b", "#ef4444"];
    return colors[Math.floor(Math.random() * colors.length)];
}

function changeWallet() {
    currentWallet = document.getElementById('walletSelect').value;
    localStorage.setItem("currentWallet", currentWallet);
    renderAll();
}

function openWalletManager() {
    // modal with list + rename/delete/duplicate/color
    const cont = document.createElement('div');
    cont.style.padding = "14px";
    cont.innerHTML = `<h3>Manage Wallets</h3><div id="wmList" style="display:flex;flex-direction:column;gap:8px;margin-top:8px"></div>
    <div style="margin-top:10px"><button class="btn ghost" onclick="closeModal()">Close</button></div>`;
    showModal(cont);
    const list = document.getElementById('wmList');
    list.innerHTML = "";
    for (const name of Object.keys(data.wallets)) {
        const w = data.wallets[name];
        const el = document.createElement('div');
        el.style.display = "flex"; el.style.justifyContent = "space-between"; el.style.alignItems = "center";
        el.innerHTML = `<div>
        <strong style="color:${w.color}">${name}</strong>
        <div class="small">Initial: ${formatCurrency(w.initial)}, Transactions: ${w.transactions.length}</div>
      </div>
      <div>
        <button class="btn ghost" onclick="renameWallet('${escape(name)}')">Rename</button>
        <button class="btn ghost" onclick="duplicateWallet('${escape(name)}')">Duplicate</button>
        <button class="btn ghost" onclick="pickColor('${escape(name)}')">Color</button>
        <button class="btn warn" onclick="deleteWallet('${escape(name)}')">Delete</button>
      </div>`;
        list.appendChild(el);
    }
}

function renameWallet(encodedName) {
    const name = unescape(encodedName);
    const newName = prompt("Rename wallet:", name);
    if (!newName || newName === name) return;
    if (data.wallets[newName]) { alert("Name exists"); return; }
    data.wallets[newName] = data.wallets[name];
    delete data.wallets[name];
    if (currentWallet === name) currentWallet = newName;
    saveAll(); buildWalletSelect(); renderAll(); closeModal();
}

function duplicateWallet(encodedName) {
    const name = unescape(encodedName);
    const copyName = name + " Copy";
    data.wallets[copyName] = JSON.parse(JSON.stringify(data.wallets[name]));
    saveAll(); buildWalletSelect(); renderAll(); closeModal();
}

function pickColor(encodedName) {
    const name = unescape(encodedName);
    const w = data.wallets[name];
    const cont = document.createElement('div');
    cont.style.padding = "10px";
    cont.innerHTML = `<h3>Pick Color for ${name}</h3>
    <input type="color" id="colorPicker" value="${w.color}" />
    <div style="margin-top:10px"><button class="btn" onclick="saveColor('${escape(name)}')">Save</button>
    <button class="btn ghost" onclick="closeModal()">Cancel</button></div>`;
    showModal(cont);
}

function saveColor(encodedName) {
    const name = unescape(encodedName);
    const val = document.getElementById('colorPicker').value;
    data.wallets[name].color = val;
    saveAll(); renderAll(); closeModal();
}

function deleteWallet(encodedName) {
    const name = unescape(encodedName);
    if (!confirm("Delete wallet " + name + " and all its transactions?")) return;
    delete data.wallets[name];
    if (currentWallet === name) currentWallet = Object.keys(data.wallets)[0] || null;
    saveAll(); buildWalletSelect(); renderAll(); closeModal();
}

/* ============================
   Transactions
   ============================ */
function addTransaction() {
    if (!currentWallet) { alert("Create/select a wallet first"); return; }
    const amt = parseFloat(document.getElementById('amount').value);
    if (isNaN(amt) || amt <= 0) { alert("Enter valid amount"); return; }
    const type = document.getElementById('type').value;
    const desc = document.getElementById('description').value || "";
    const cat = document.getElementById('category').value;
    const date = document.getElementById('txDate').value || new Date().toISOString().slice(0, 10);
    const notes = document.getElementById('notes').value || "";
    const tx = { id: uid(), amount: amt, type, description: desc, category: cat, date, notes, created: Date.now() };
    data.wallets[currentWallet].transactions.push(tx);
    undoStack.push({ action: 'add', wallet: currentWallet, tx });
    saveAll(); clearForm(); renderAll();
}

function clearForm() {
    document.getElementById('amount').value = "";
    document.getElementById('description').value = "";
    document.getElementById('notes').value = "";
    ensureDateInput();
}

function editTransaction(wallet, txId) {
    const tx = data.wallets[wallet].transactions.find(t => t.id === txId);
    if (!tx) return;
    // show modal with editable fields
    const cont = document.createElement('div');
    cont.style.padding = "12px";
    cont.innerHTML = `<h3>Edit Transaction</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      <input id="eAmount" type="number" value="${tx.amount}" />
      <select id="eType"><option ${tx.type === 'income' ? 'selected' : ''} value="income">Income</option><option ${tx.type === 'expense' ? 'selected' : ''} value="expense">Expense</option></select>
      <input id="eDesc" type="text" value="${escapeHtml(tx.description)}" />
      <input id="eCat" type="text" value="${escapeHtml(tx.category)}" />
      <input id="eDate" type="date" value="${tx.date}" />
      <textarea id="eNotes">${escapeHtml(tx.notes)}</textarea>
      <div style="display:flex;gap:8px"><button class="btn" onclick="saveEdit('${wallet}','${txId}')">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>
    </div>`;
    showModal(cont);
}

function saveEdit(wallet, txId) {
    const tx = data.wallets[wallet].transactions.find(t => t.id === txId);
    if (!tx) return;
    const before = JSON.parse(JSON.stringify(tx));
    tx.amount = parseFloat(document.getElementById('eAmount').value) || tx.amount;
    tx.type = document.getElementById('eType').value;
    tx.description = document.getElementById('eDesc').value;
    tx.category = document.getElementById('eCat').value;
    tx.date = document.getElementById('eDate').value;
    tx.notes = document.getElementById('eNotes').value;
    undoStack.push({ action: 'edit', wallet, before, after: JSON.parse(JSON.stringify(tx)) });
    saveAll(); renderAll(); closeModal();
}

function deleteTransaction(wallet, txId) {
    if (!confirm("Delete this transaction?")) return;
    const idx = data.wallets[wallet].transactions.findIndex(t => t.id === txId);
    if (idx === -1) return;
    const removed = data.wallets[wallet].transactions.splice(idx, 1)[0];
    undoStack.push({ action: 'delete', wallet, tx: removed });
    saveAll(); renderAll();
}

function undoLast() {
    const item = undoStack.pop();
    if (!item) { alert("Nothing to undo"); return; }
    if (item.action === 'add') {
        const arr = data.wallets[item.wallet].transactions;
        const idx = arr.findIndex(t => t.id === item.tx.id);
        if (idx !== -1) arr.splice(idx, 1);
    } else if (item.action === 'delete') {
        data.wallets[item.wallet].transactions.push(item.tx);
    } else if (item.action === 'edit') {
        const tx = data.wallets[item.wallet].transactions.find(t => t.id === item.before.id);
        if (tx) {
            Object.assign(tx, item.before);
        }
    }
    saveAll(); renderAll();
}

/* ============================
   Rendering / History / Chart
   ============================ */
function getCurrentWalletData() {
    if (!currentWallet) return null;
    return data.wallets[currentWallet];
}

function computeBalance(walletName) {
    const w = data.wallets[walletName];
    let bal = Number(w.initial || 0);
    for (const t of w.transactions) {
        bal += (t.type === 'income' ? t.amount : -t.amount);
    }
    return bal;
}

function renderAll() {
    buildWalletSelect();
    document.getElementById('walletSelect').value = currentWallet || "";
    const w = getCurrentWalletData();
    if (!w) {
        document.getElementById('walletName').innerText = "No wallet";
        document.getElementById('balance').innerText = "₹0";
        document.getElementById('initialBal').innerText = "₹0";
        document.getElementById('history').innerHTML = "";
        return;
    }
    document.getElementById('walletName').innerText = currentWallet;
    document.getElementById('initialBal').innerText = formatCurrency(w.initial);
    const bal = computeBalance(currentWallet);
    document.getElementById('balance').innerText = meta.hideBalance ? "*****" : formatCurrency(bal);
    // apply wallet color
    document.querySelectorAll('.balance-box').forEach(el => {
        el.style.borderLeft = `6px solid ${w.color || '#60a5fa'}`;
    });
    renderHistory();
    renderChart();
}

/* History render with filter/search/sort */
function renderHistory() {
    const listEl = document.getElementById('history'); listEl.innerHTML = "";
    const w = getCurrentWalletData();
    if (!w) return;
    const filter = document.getElementById('filter').value;
    const q = document.getElementById('search').value.toLowerCase().trim();
    let items = [...w.transactions];
    // search
    if (q) {
        items = items.filter(t => (t.description || "").toLowerCase().includes(q) || (t.notes || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q));
    }
    // filter
    if (filter !== "all") items = items.filter(t => t.type === filter);
    // sort
    const sort = document.getElementById('sort').value;
    if (sort === "newest") items.sort((a, b) => b.created - a.created);
    else if (sort === "oldest") items.sort((a, b) => a.created - b.created);
    else if (sort === "amount_desc") items.sort((a, b) => b.amount - a.amount);
    else if (sort === "amount_asc") items.sort((a, b) => a.amount - b.amount);

    if (items.length === 0) {
        listEl.innerHTML = "<div class='small'>No transactions</div>"; return;
    }

    for (const t of items) {
        const el = document.createElement('div'); el.className = "tx " + t.type;
        el.innerHTML = `<div>
        <div><strong>${t.type === 'income' ? '+ ' : '- '}${formatCurrency(t.amount)}</strong> <span class="small">• ${t.category}</span></div>
        <div class="meta">${escapeHtml(t.description)} • ${t.date} ${t.notes ? '• ' + escapeHtml(t.notes) : ''}</div>
      </div>
      <div class="actions">
        <button title="Edit" onclick="editTransaction('${currentWallet}','${t.id}')">✏️</button>
        <button title="Delete" onclick="deleteTransaction('${currentWallet}','${t.id}')">🗑️</button>
      </div>`;
        listEl.appendChild(el);
    }
}

/* ============================
   Chart (simple canvas)
   ============================ */
function renderChart() {
    const canvas = document.getElementById('chart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = getCurrentWalletData();
    if (!w) return;
    // build monthly income/expense for last 6 months
    const months = [], now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), income: 0, expense: 0 });
    }
    for (const t of w.transactions) {
        const d = new Date(t.date);
        for (const m of months) {
            const md = new Date("20" + m.label.split('/')[1], new Date(m.label).getMonth()); // not used
        }
        // find matching month by year+month
        const idx = months.findIndex(m => {
            const mparts = m.label.split(' ');
            // parse approx: "Oct 25"
            const mon = m.label.split(' ')[0];
            const dt = new Date();
            const monIndex = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(mon);
            return dt.getFullYear() - (new Date().getFullYear() - (new Date().getFullYear())), true;
        });
    }
    // Simpler: compute by month index
    const map = {};
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.getFullYear() + '-' + (d.getMonth() + 1);
        map[key] = { label: d.toLocaleString('default', { month: 'short' }), income: 0, expense: 0 };
    }
    for (const t of w.transactions) {
        const dt = new Date(t.date);
        const key = dt.getFullYear() + '-' + (dt.getMonth() + 1);
        if (map[key]) {
            if (t.type === 'income') map[key].income += t.amount;
            else map[key].expense += t.amount;
        }
    }
    const keys = Object.keys(map);
    const incomeArr = keys.map(k => map[k].income);
    const expenseArr = keys.map(k => map[k].expense);
    const labels = keys.map(k => map[k].label);
    // draw simple bars
    const padding = 20, chartW = canvas.width - padding * 2, chartH = canvas.height - padding * 2;
    const maxVal = Math.max(...incomeArr, ...expenseArr, 10);
    const colWidth = chartW / (keys.length * 2 + (keys.length - 1) * 0.5);
    // draw axes
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.beginPath();
    ctx.moveTo(padding, padding); ctx.lineTo(padding, padding + chartH); ctx.lineTo(padding + chartW, padding + chartH); ctx.stroke();
    // draw bars
    keys.forEach((k, i) => {
        const x0 = padding + i * (colWidth * 2 + colWidth * 0.5);
        const incH = (incomeArr[i] / maxVal) * chartH;
        const expH = (expenseArr[i] / maxVal) * chartH;
        // income bar
        ctx.fillStyle = 'rgba(34,197,94,0.9)';
        ctx.fillRect(x0, padding + chartH - incH, colWidth, incH);
        // expense bar
        ctx.fillStyle = 'rgba(239,68,68,0.9)';
        ctx.fillRect(x0 + colWidth, padding + chartH - expH, colWidth, expH);
        // labels
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.font = '11px Arial';
        ctx.fillText(labels[i], x0, padding + chartH + 14);
    });
}

/* ============================
   Export / Import / Print
   ============================ */
function exportCSV() {
    const w = getCurrentWalletData(); if (!w) { alert("No wallet"); return; }
    const rows = [['id', 'date', 'type', 'amount', 'category', 'description', 'notes']];
    for (const t of w.transactions) rows.push([t.id, t.date, t.type, t.amount, t.category, escapeCsv(t.description), escapeCsv(t.notes)]);
    const blob = new Blob([rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    downloadURL(url, `${currentWallet.replace(/\s+/g, '_')}_transactions.csv`);
    URL.revokeObjectURL(url);
}

function exportJSON() {
    const payload = { meta, data, currentWallet };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadURL(url, `money_backup_${new Date().toISOString().slice(0, 10)}.json`);
    URL.revokeObjectURL(url);
}

function downloadURL(url, name) {
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

function printReport() {
    const w = getCurrentWalletData(); if (!w) { alert("No wallet"); return; }
    // build printable html
    const lines = [];
    lines.push(`<h1>${escapeHtml(currentWallet)} — Report</h1>`);
    lines.push(`<h3>Balance: ${formatCurrency(computeBalance(currentWallet))}</h3>`);
    lines.push(`<h4>Transactions</h4>`);
    lines.push(`<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Category</th><th>Description</th></tr></thead><tbody>`);
    for (const t of w.transactions) {
        lines.push(`<tr><td>${t.date}</td><td>${t.type}</td><td>${formatCurrency(t.amount)}</td><td>${escapeHtml(t.category)}</td><td>${escapeHtml(t.description)}</td></tr>`);
    }
    lines.push(`</tbody></table>`);
    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<html><head><title>Report</title></head><body>${lines.join('')}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
}

/* Import JSON backup */
function openSettings() {
    // show settings modal
    const cont = document.createElement('div'); cont.style.padding = "12px"; cont.innerHTML = `
    <h3>Settings</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      <label>Theme: <select id="setTheme"><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Hide balance: <input type="checkbox" id="setHide"></label>
      <label>Auto logout (minutes, 0 disable): <input id="setAuto" type="number" min="0" value="${meta.autoLogoutMinutes || 0}"></label>
      <div style="display:flex;gap:8px"><button class="btn" onclick="saveSettings()">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>
      <hr/>
      <div><button class="btn ghost" onclick="triggerImport()">Import JSON Backup</button> <input type="file" id="importFile" style="display:none" accept=".json" onchange="handleImport(event)"/></div>
      <div style="margin-top:8px">
        <button class="btn ghost" onclick="setPin()">Set/Change PIN</button>
        <button class="btn ghost" onclick="clearPin()">Clear PIN</button>
        <button class="btn ghost" onclick="undoLast()">Undo last</button>
      </div>
    </div>`;
    showModal(cont);
    document.getElementById('setTheme').value = meta.theme || 'light';
    document.getElementById('setHide').checked = !!meta.hideBalance;
}

function saveSettings() {
    const th = document.getElementById('setTheme').value;
    const hid = document.getElementById('setHide').checked;
    const auto = parseInt(document.getElementById('setAuto').value) || 0;
    meta.theme = th; meta.hideBalance = hid; meta.autoLogoutMinutes = auto;
    saveAll(); applyTheme(); renderAll(); closeModal();
}

function triggerImport() { document.getElementById('importFile').click(); }
function handleImport(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const obj = JSON.parse(reader.result);
            if (obj.data && obj.meta) { if (confirm("Replace current data with imported backup?")) { data = obj.data; meta = obj.meta; currentWallet = obj.currentWallet || Object.keys(data.wallets)[0] || null; saveAll(); renderAll(); closeModal(); alert("Imported"); } }
            else if (obj.wallets) { data = obj; saveAll(); renderAll(); closeModal(); alert("Imported"); }
            else alert("Invalid backup file");
        } catch (err) { alert("Invalid JSON"); }
    }
    reader.readAsText(f);
}

/* ============================
   PIN Lock
   ============================ */
function setPin() {
    const pin = prompt("Enter numeric PIN (4-6 digits):");
    if (!pin) return;
    if (!/^\d{4,6}$/.test(pin)) { alert("PIN must be 4-6 digits"); return; }
    meta.pin = btoa(pin); // simple obfuscation — browser-only
    saveAll(); alert("PIN saved"); closeModal();
}
function clearPin() {
    if (!meta.pin) { alert("No PIN set"); return; }
    if (!confirm("Clear PIN?")) return;
    meta.pin = null; saveAll(); alert("PIN cleared"); closeModal();
}
function lockApp() {
    if (!meta.pin) { alert("Set a PIN first in Settings"); openSettings(); return; }
    showLockScreen();
}
function showLockScreen() {
    const cont = document.createElement('div'); cont.style.padding = "12px";
    cont.innerHTML = `<h3>Locked</h3><div>Enter PIN to unlock</div>
    <input id="pinInput" type="password" style="margin-top:8px;padding:8px;border-radius:8px;border:1px solid #ddd" />
    <div style="margin-top:8px"><button class="btn" onclick="unlockApp()">Unlock</button></div>`;
    showModal(cont, false);
}
function unlockApp() {
    const val = document.getElementById('pinInput').value;
    if (btoa(val) === meta.pin) { closeModal(); resetActivity(); alert("Unlocked"); }
    else alert("Wrong PIN");
}

/* ============================
   Theme / Hide balance
   ============================ */
function applyTheme() {
    document.documentElement.setAttribute('data-theme', meta.theme === 'dark' ? 'dark' : 'light');
    document.getElementById('themeBtn').innerText = meta.theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    document.getElementById('hideBtn').innerText = meta.hideBalance ? 'Show Balance' : 'Hide Balance';
}
function toggleTheme() { meta.theme = meta.theme === 'dark' ? 'light' : 'dark'; saveAll(); applyTheme(); }
function toggleHideBalance() { meta.hideBalance = !meta.hideBalance; saveAll(); renderAll(); applyTheme(); }

/* ============================
   Modal helpers
   ============================ */
function showModal(el, closeOnBg = true) {
    const container = document.getElementById('modalContainer');
    container.innerHTML = "";
    const overlay = document.createElement('div'); overlay.style.position = 'fixed'; overlay.style.left = 0; overlay.style.top = 0; overlay.style.right = 0; overlay.style.bottom = 0;
    overlay.style.background = 'rgba(0,0,0,0.4)'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center'; overlay.style.zIndex = 9999;
    overlay.onclick = (ev) => { if (ev.target === overlay && closeOnBg) closeModal(); };
    const box = document.createElement('div'); box.style.background = 'var(--card)'; box.style.padding = '14px'; box.style.borderRadius = '10px'; box.style.minWidth = '320px'; box.style.maxWidth = '90%';
    box.appendChild(el); overlay.appendChild(box); container.appendChild(overlay); container.style.display = 'block';
}
function closeModal() { document.getElementById('modalContainer').innerHTML = ""; document.getElementById('modalContainer').style.display = 'none'; }

/* ============================
   Helpers
   ============================ */
function escapeHtml(s) { if (!s) return ""; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeCsv(s) { if (s == null) return ""; return String(s).replace(/"/g, '""'); }

/* ============================
   Inactivity / Auto logout
   ============================ */
let inactivityTimer = null;
function startInactivityWatcher() {
    resetActivity();
    ['mousemove', 'keydown', 'touchstart'].forEach(evt => window.addEventListener(evt, resetActivity));
}
function resetActivity() {
    meta.lastActive = Date.now(); saveAll();
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (meta.autoLogoutMinutes && meta.autoLogoutMinutes > 0) {
        inactivityTimer = setTimeout(() => { if (meta.pin) showLockScreen(); else { alert("Auto-logout (no PIN set)"); } }, meta.autoLogoutMinutes * 60 * 1000);
    }
}

/* ============================
   Small utils
   ============================ */
function download(filename, text) {
    const a = document.createElement('a'); a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

/* ============================
   Small helpers for escaping in modal fields
   ============================ */
function escapeHtmlAttr(s) { return String(s).replace(/"/g, '&quot;'); }

/* ============================
   Startup
   ============================ */
init();

/* Expose some functions to console for easy use */
window.saveAll = saveAll;
window.undoLast = undoLast;
window.lockApp = lockApp;
window.exportCSV = exportCSV;
window.exportJSON = exportJSON;
window.printReport = printReport;