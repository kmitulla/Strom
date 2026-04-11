// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyAYsDzIjruH3Ydw31wjfhmy9Yz6wAKIdPI",
    authDomain: "stromtool-c107b.firebaseapp.com",
    projectId: "stromtool-c107b",
    storageBucket: "stromtool-c107b.firebasestorage.app",
    messagingSenderId: "517105673322",
    appId: "1:517105673322:web:df70758e85b9391b091613",
    measurementId: "G-2WQ1FGKX0D"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============ STATE ============
let currentUser = null;    // { id, username, isAdmin }
let currentComparison = null;
let breakEvenChart = null;

// Tracker state
let trackerReadings = [];
let trackerContracts = [];
let consumptionChart = null;
let currentChartPeriod = 'month';

// ============ HELPERS ============
async function hashPassword(pw) {
    const enc = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function showModal(id) {
    document.getElementById(id).classList.add('active');
}
function hideModal(id) {
    document.getElementById(id).classList.remove('active');
}

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
}

function formatEuro(n) {
    return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

// ============ AUTH ============
async function initAdmin() {
    const adminRef = doc(db, 'users', 'admin');
    const snap = await getDoc(adminRef);
    if (!snap.exists()) {
        await setDoc(adminRef, {
            username: 'admin',
            passwordHash: await hashPassword('admin'),
            isAdmin: true,
            needsPasswordSet: false,
            createdAt: new Date().toISOString()
        });
    }
}

async function login(username, password) {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '==', username.toLowerCase().trim()));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Benutzer nicht gefunden');

    const userDoc = snap.docs[0];
    const userData = userDoc.data();

    // Check if user needs to set password first
    if (userData.needsPasswordSet) {
        return { needsPasswordSet: true, userId: userDoc.id, username: userData.username, isAdmin: userData.isAdmin };
    }

    const hash = await hashPassword(password);
    if (hash !== userData.passwordHash) throw new Error('Falsches Passwort');

    return { userId: userDoc.id, username: userData.username, isAdmin: userData.isAdmin };
}

// ============ LOGIN SCREEN ============
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    try {
        const result = await login(username, password);
        if (result.needsPasswordSet) {
            currentUser = result;
            showScreen('setpw-screen');
            return;
        }
        currentUser = result;
        localStorage.setItem('strom_user', JSON.stringify({ userId: result.userId, username: result.username, isAdmin: result.isAdmin }));
        enterApp();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// ============ SET PASSWORD SCREEN ============
document.getElementById('setpw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('setpw-error');
    errEl.textContent = '';
    const pw1 = document.getElementById('setpw-new').value;
    const pw2 = document.getElementById('setpw-confirm').value;
    if (pw1 !== pw2) { errEl.textContent = 'Passwörter stimmen nicht überein'; return; }

    try {
        await updateDoc(doc(db, 'users', currentUser.userId), {
            passwordHash: await hashPassword(pw1),
            needsPasswordSet: false
        });
        localStorage.setItem('strom_user', JSON.stringify({ userId: currentUser.userId, username: currentUser.username, isAdmin: currentUser.isAdmin }));
        toast('Passwort gespeichert!');
        enterApp();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// ============ ENTER APP ============
function enterApp() {
    document.getElementById('btn-admin').style.display = currentUser.isAdmin ? '' : 'none';
    showScreen('dashboard-screen');
    loadComparisons();
    updateTrackerCard();
}

// ============ SETTINGS ============
document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('changepw-old').value = '';
    document.getElementById('changepw-new').value = '';
    document.getElementById('changepw-confirm').value = '';
    document.getElementById('changepw-msg').textContent = '';
    showScreen('settings-screen');
});
document.getElementById('btn-back-settings').addEventListener('click', () => showScreen('dashboard-screen'));

document.getElementById('changepw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('changepw-msg');
    msgEl.textContent = '';
    msgEl.className = 'error-text';

    const oldPw = document.getElementById('changepw-old').value;
    const newPw = document.getElementById('changepw-new').value;
    const confirmPw = document.getElementById('changepw-confirm').value;

    if (newPw !== confirmPw) { msgEl.textContent = 'Passwörter stimmen nicht überein'; return; }

    try {
        const userSnap = await getDoc(doc(db, 'users', currentUser.userId));
        const userData = userSnap.data();
        const oldHash = await hashPassword(oldPw);
        if (oldHash !== userData.passwordHash) { msgEl.textContent = 'Altes Passwort ist falsch'; return; }

        await updateDoc(doc(db, 'users', currentUser.userId), { passwordHash: await hashPassword(newPw) });
        msgEl.textContent = 'Passwort geändert!';
        msgEl.className = 'error-text success-text';
        toast('Passwort geändert!');
    } catch (err) {
        msgEl.textContent = err.message;
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem('strom_user');
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-error').textContent = '';
    showScreen('login-screen');
});

// ============ ADMIN ============
document.getElementById('btn-admin').addEventListener('click', () => {
    showScreen('admin-screen');
    loadUsers();
});
document.getElementById('btn-back-admin').addEventListener('click', () => showScreen('dashboard-screen'));

async function loadUsers() {
    const list = document.getElementById('users-list');
    list.innerHTML = '<div class="loading-spinner" style="margin:2rem auto;display:block;"></div>';
    const snap = await getDocs(collection(db, 'users'));
    list.innerHTML = '';

    snap.forEach(d => {
        const u = d.data();
        const card = document.createElement('div');
        card.className = 'card user-card';
        card.innerHTML = `
            <div class="user-info">
                <div class="card-title">
                    ${esc(u.username)}
                    ${u.isAdmin ? '<span class="user-badge badge-admin">Admin</span>' : ''}
                    ${u.needsPasswordSet ? '<span class="user-badge badge-nopw">Kein PW</span>' : ''}
                </div>
                <div class="card-subtitle">Erstellt: ${u.createdAt ? new Date(u.createdAt).toLocaleDateString('de-DE') : '–'}</div>
            </div>
            <div class="provider-actions">
                <button class="btn btn-icon" title="Namen ändern" data-action="edit-name" data-id="${d.id}">✏️</button>
                <button class="btn btn-icon" title="Passwort ändern" data-action="edit-pw" data-id="${d.id}">🔑</button>
                <button class="btn btn-icon" title="Passwort zurücksetzen" data-action="reset-pw" data-id="${d.id}">🔄</button>
                ${d.id !== 'admin' ? `<button class="btn btn-icon btn-danger-icon" title="Löschen" data-action="delete-user" data-id="${d.id}">🗑️</button>` : ''}
            </div>
        `;
        list.appendChild(card);
    });

    // Event delegation
    list.onclick = async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'delete-user') {
            if (!confirm('Benutzer wirklich löschen?')) return;
            await deleteDoc(doc(db, 'users', id));
            toast('Benutzer gelöscht');
            loadUsers();
        } else if (action === 'edit-name') {
            const newName = prompt('Neuer Benutzername:');
            if (!newName) return;
            await updateDoc(doc(db, 'users', id), { username: newName.toLowerCase().trim() });
            toast('Name geändert');
            loadUsers();
        } else if (action === 'edit-pw') {
            const newPw = prompt('Neues Passwort:');
            if (newPw === null) return;
            await updateDoc(doc(db, 'users', id), { passwordHash: await hashPassword(newPw), needsPasswordSet: false });
            toast('Passwort geändert');
            loadUsers();
        } else if (action === 'reset-pw') {
            if (!confirm('Passwort zurücksetzen? Der Benutzer kann beim nächsten Login ein neues Passwort vergeben.')) return;
            await updateDoc(doc(db, 'users', id), { passwordHash: '', needsPasswordSet: true });
            toast('Passwort zurückgesetzt');
            loadUsers();
        }
    };
}

document.getElementById('btn-add-user').addEventListener('click', () => {
    document.getElementById('user-modal-title').textContent = 'Neuer Benutzer';
    document.getElementById('user-name').value = '';
    document.getElementById('user-pass').value = '';
    document.getElementById('user-is-admin').checked = false;
    document.getElementById('user-edit-id').value = '';
    showModal('user-modal');
});

document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('user-name').value.toLowerCase().trim();
    const password = document.getElementById('user-pass').value;
    const isAdmin = document.getElementById('user-is-admin').checked;

    if (!username) return;

    const userId = username.replace(/[^a-z0-9_-]/g, '_');

    const existingSnap = await getDoc(doc(db, 'users', userId));
    if (existingSnap.exists()) {
        toast('Benutzername existiert bereits');
        return;
    }

    await setDoc(doc(db, 'users', userId), {
        username,
        passwordHash: password ? await hashPassword(password) : '',
        isAdmin,
        needsPasswordSet: !password,
        createdAt: new Date().toISOString()
    });

    hideModal('user-modal');
    toast('Benutzer angelegt');
    loadUsers();
});

// ============ COMPARISONS ============
async function loadComparisons() {
    const list = document.getElementById('comparisons-list');
    list.innerHTML = '<div class="loading-spinner" style="margin:2rem auto;display:block;"></div>';

    const snap = await getDocs(collection(db, `users/${currentUser.userId}/comparisons`));
    list.innerHTML = '';

    if (snap.empty) {
        list.innerHTML = '<p class="empty-state">Noch keine Vergleiche vorhanden.<br>Erstelle deinen ersten Stromvergleich!</p>';
        return;
    }

    snap.forEach(d => {
        const c = d.data();
        const card = document.createElement('div');
        card.className = 'card card-clickable';
        card.innerHTML = `
            <div class="card-title">⚡ ${esc(c.name)}</div>
            <div class="card-subtitle">${c.providers ? c.providers.length : 0} Anbieter · ${c.kwh || '–'} kWh</div>
        `;
        card.onclick = () => openComparison(d.id, c);
        list.appendChild(card);
    });
}

document.getElementById('btn-new-comparison').addEventListener('click', () => {
    document.getElementById('comparison-modal-title').textContent = 'Neuer Vergleich';
    document.getElementById('comparison-name').value = '';
    showModal('comparison-modal');
});

document.getElementById('comparison-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('comparison-name').value.trim();
    if (!name) return;

    if (currentComparison && currentComparison._editing) {
        await updateDoc(doc(db, `users/${currentUser.userId}/comparisons`, currentComparison.id), { name });
        currentComparison.data.name = name;
        document.getElementById('comparison-title').textContent = name;
        hideModal('comparison-modal');
        toast('Name geändert');
        return;
    }

    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const data = { name, providers: [], kwh: 0, createdAt: new Date().toISOString() };
    await setDoc(doc(db, `users/${currentUser.userId}/comparisons`, newId), data);
    hideModal('comparison-modal');
    toast('Vergleich erstellt');
    openComparison(newId, data);
});

// ============ COMPARISON DETAIL ============
function openComparison(id, data) {
    currentComparison = { id, data };
    document.getElementById('comparison-title').textContent = data.name;
    document.getElementById('kwh-input').value = data.kwh || '';
    showScreen('comparison-screen');
    renderProviders();
    updateResults();
}

document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    currentComparison = null;
    showScreen('dashboard-screen');
    loadComparisons();
});

document.getElementById('btn-edit-comparison').addEventListener('click', () => {
    document.getElementById('comparison-modal-title').textContent = 'Vergleich umbenennen';
    document.getElementById('comparison-name').value = currentComparison.data.name;
    currentComparison._editing = true;
    showModal('comparison-modal');
});

document.getElementById('btn-delete-comparison').addEventListener('click', async () => {
    if (!confirm('Vergleich wirklich löschen?')) return;
    await deleteDoc(doc(db, `users/${currentUser.userId}/comparisons`, currentComparison.id));
    currentComparison = null;
    toast('Vergleich gelöscht');
    showScreen('dashboard-screen');
    loadComparisons();
});

document.getElementById('kwh-input').addEventListener('input', async (e) => {
    if (!currentComparison) return;
    const kwh = parseFloat(e.target.value) || 0;
    currentComparison.data.kwh = kwh;
    await updateDoc(doc(db, `users/${currentUser.userId}/comparisons`, currentComparison.id), { kwh });
    updateResults();
});

// ============ PROVIDERS ============
document.getElementById('btn-add-provider').addEventListener('click', () => {
    document.getElementById('provider-modal-title').textContent = 'Anbieter hinzufügen';
    document.getElementById('provider-form').reset();
    document.getElementById('provider-bonus').value = '0';
    document.getElementById('provider-sonderbonus').value = '0';
    document.getElementById('provider-edit-index').value = '-1';
    showModal('provider-modal');
});

document.getElementById('provider-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = {
        name: document.getElementById('provider-name').value.trim(),
        kwhPrice: parseFloat(document.getElementById('provider-kwh-price').value) || 0,
        baseFee: parseFloat(document.getElementById('provider-base-fee').value) || 0,
        bonus: parseFloat(document.getElementById('provider-bonus').value) || 0,
        sonderbonus: parseFloat(document.getElementById('provider-sonderbonus').value) || 0
    };

    const idx = parseInt(document.getElementById('provider-edit-index').value);
    if (!currentComparison.data.providers) currentComparison.data.providers = [];

    if (idx >= 0) {
        currentComparison.data.providers[idx] = provider;
    } else {
        currentComparison.data.providers.push(provider);
    }

    await updateDoc(doc(db, `users/${currentUser.userId}/comparisons`, currentComparison.id), {
        providers: currentComparison.data.providers
    });

    hideModal('provider-modal');
    toast(idx >= 0 ? 'Anbieter aktualisiert' : 'Anbieter hinzugefügt');
    renderProviders();
    updateResults();
});

function renderProviders() {
    const list = document.getElementById('providers-list');
    const providers = currentComparison.data.providers || [];
    list.innerHTML = '';

    if (providers.length === 0) {
        list.innerHTML = '<p class="empty-state">Noch keine Anbieter hinzugefügt.</p>';
        return;
    }

    providers.forEach((p, i) => {
        const card = document.createElement('div');
        card.className = 'card provider-card';
        card.innerHTML = `
            <div class="provider-info">
                <div class="card-title">${esc(p.name)}</div>
                <div class="provider-details">
                    <span>${p.kwhPrice} ct/kWh</span>
                    <span>${formatEuro(p.baseFee)}/Monat</span>
                    <span>Bonus: ${formatEuro(p.bonus)}</span>
                    <span>Sonder: ${formatEuro(p.sonderbonus)}</span>
                </div>
            </div>
            <div class="provider-actions">
                <button class="btn btn-icon" title="Bearbeiten" data-edit="${i}">✏️</button>
                <button class="btn btn-icon btn-danger-icon" title="Löschen" data-delete="${i}">🗑️</button>
            </div>
        `;
        list.appendChild(card);
    });

    list.onclick = async (e) => {
        const editBtn = e.target.closest('[data-edit]');
        const delBtn = e.target.closest('[data-delete]');

        if (editBtn) {
            const idx = parseInt(editBtn.dataset.edit);
            const p = providers[idx];
            document.getElementById('provider-modal-title').textContent = 'Anbieter bearbeiten';
            document.getElementById('provider-name').value = p.name;
            document.getElementById('provider-kwh-price').value = p.kwhPrice;
            document.getElementById('provider-base-fee').value = p.baseFee;
            document.getElementById('provider-bonus').value = p.bonus;
            document.getElementById('provider-sonderbonus').value = p.sonderbonus;
            document.getElementById('provider-edit-index').value = idx;
            showModal('provider-modal');
        }

        if (delBtn) {
            const idx = parseInt(delBtn.dataset.delete);
            if (!confirm(`"${providers[idx].name}" wirklich entfernen?`)) return;
            currentComparison.data.providers.splice(idx, 1);
            await updateDoc(doc(db, `users/${currentUser.userId}/comparisons`, currentComparison.id), {
                providers: currentComparison.data.providers
            });
            toast('Anbieter entfernt');
            renderProviders();
            updateResults();
        }
    };
}

// ============ RESULTS & CHART ============

// Cost at a given kWh consumption point (cumulative over the year)
function calcCostAtKwh(provider, consumedKwh) {
    const consumption = consumedKwh * (provider.kwhPrice / 100);
    const base = provider.baseFee * 12;
    const bonus = provider.bonus + provider.sonderbonus;
    return consumption + base - bonus;
}

function calcYearlyCost(provider, kwh) {
    return calcCostAtKwh(provider, kwh);
}

function calcMonthlyCost(provider, kwh) {
    return calcYearlyCost(provider, kwh) / 12;
}

const chartColors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1'
];

// Axis config event listeners
document.getElementById('axis-x-max').addEventListener('input', () => updateResults());
document.getElementById('axis-y-max').addEventListener('input', () => updateResults());

function updateResults() {
    const providers = currentComparison.data.providers || [];
    const kwh = currentComparison.data.kwh || 0;
    const section = document.getElementById('results-section');

    if (providers.length < 1 || kwh <= 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    // X-axis: kWh, with annual consumption at ~2/3 of the axis
    const autoXMax = Math.ceil(kwh * 1.5 / 100) * 100; // 1.5x = annual at 2/3
    const userXMax = parseFloat(document.getElementById('axis-x-max').value);
    const xMax = (userXMax > 0) ? userXMax : autoXMax;

    // Generate data points along kWh axis (0 to xMax, ~30 points)
    const numPoints = 30;
    const step = xMax / numPoints;
    const kwhPoints = Array.from({ length: numPoints + 1 }, (_, i) => Math.round(i * step));

    const datasets = providers.map((p, i) => {
        const data = kwhPoints.map(x => ({
            x,
            y: Math.round(calcCostAtKwh(p, x) * 100) / 100
        }));
        return {
            label: p.name,
            data,
            borderColor: chartColors[i % chartColors.length],
            backgroundColor: chartColors[i % chartColors.length] + '20',
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 10,
            borderWidth: 2.5,
            fill: false
        };
    });

    // Y-axis max
    const autoYMax = Math.max(...providers.map(p => calcCostAtKwh(p, xMax)));
    const userYMax = parseFloat(document.getElementById('axis-y-max').value);
    const yMax = (userYMax > 0) ? userYMax : undefined;

    // Vertical annotation line at annual consumption
    const annualLinePlugin = {
        id: 'annualLine',
        afterDraw(chart) {
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;
            const ctx = chart.ctx;
            const xPixel = xScale.getPixelForValue(kwh);
            if (xPixel < xScale.left || xPixel > xScale.right) return;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.5;
            ctx.moveTo(xPixel, yScale.top);
            ctx.lineTo(xPixel, yScale.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#64748b';
            ctx.font = '11px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${kwh.toLocaleString('de-DE')} kWh/Jahr`, xPixel, yScale.top - 6);
            ctx.restore();
        }
    };

    // Render chart
    const canvas = document.getElementById('breakeven-chart');
    if (breakEvenChart) breakEvenChart.destroy();
    breakEvenChart = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            showLine: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        title: ctx => `${ctx[0].parsed.x.toLocaleString('de-DE')} kWh`,
                        label: ctx => `${ctx.dataset.label}: ${formatEuro(ctx.parsed.y)}`
                    }
                }
            },
            layout: { padding: { top: 20 } },
            scales: {
                y: {
                    title: { display: true, text: 'Jahreskosten (€)', font: { size: 11 } },
                    ticks: { callback: v => v.toLocaleString('de-DE') + ' €' },
                    max: yMax,
                    beginAtZero: false
                },
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Stromverbrauch (kWh)', font: { size: 11 } },
                    ticks: { callback: v => v.toLocaleString('de-DE') },
                    max: xMax,
                    min: 0
                }
            }
        },
        plugins: [annualLinePlugin]
    });

    // Ranking with monthly + yearly cost + Abschlag
    const ranked = providers.map((p, i) => ({
        ...p,
        index: i,
        yearlyCost: calcYearlyCost(p, kwh),
        monthlyCost: calcMonthlyCost(p, kwh),
        // Abschlag = actual monthly bill (Grundgebühr + Arbeitspreis/Monat, ohne Boni)
        abschlag: p.baseFee + (kwh / 12) * (p.kwhPrice / 100)
    })).sort((a, b) => a.yearlyCost - b.yearlyCost);

    const bestCost = ranked[0].yearlyCost;

    const rankList = document.getElementById('ranking-list');
    rankList.innerHTML = '';
    ranked.forEach((p, pos) => {
        const diff = p.yearlyCost - bestCost;
        const item = document.createElement('div');
        item.className = `card ranking-item${pos === 0 ? ' highlight' : ''}`;
        item.innerHTML = `
            <div class="ranking-pos">${pos + 1}</div>
            <div class="ranking-info">
                <div class="ranking-name">${esc(p.name)}</div>
                <div class="ranking-cost">
                    ${formatEuro(p.monthlyCost)}/Monat · ${formatEuro(p.yearlyCost)}/Jahr
                    ${pos > 0 ? `<br><span class="diff-positive">+${formatEuro(diff)} vs. ${esc(ranked[0].name)}</span>` : ''}
                </div>
                <div class="abschlag-info">Voraussichtl. Abschlag: <strong>${formatEuro(p.abschlag)}</strong>/Monat</div>
            </div>
            <div class="ranking-price">${formatEuro(p.monthlyCost)}<br><small style="color:var(--text-secondary);font-weight:400;font-size:0.75rem">/Monat</small></div>
        `;
        rankList.appendChild(item);
    });

    // Diff table: pairwise differences
    if (ranked.length >= 2) {
        const diffDiv = document.getElementById('diff-table');
        let html = '<h3>Preisdifferenz (Jahr)</h3><table class="diff-table"><thead><tr><th>Anbieter</th>';
        ranked.forEach(p => { html += `<th>${esc(p.name)}</th>`; });
        html += '</tr></thead><tbody>';
        ranked.forEach((row, ri) => {
            html += `<tr><td><strong>${esc(row.name)}</strong></td>`;
            ranked.forEach((col, ci) => {
                const diff = row.yearlyCost - col.yearlyCost;
                if (ri === ci) {
                    html += `<td class="diff-zero">–</td>`;
                } else {
                    const cls = diff > 0 ? 'diff-positive' : 'diff-negative';
                    const sign = diff > 0 ? '+' : '';
                    html += `<td class="${cls}">${sign}${formatEuro(diff)}</td>`;
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        diffDiv.innerHTML = html;
        diffDiv.style.display = '';
    } else {
        document.getElementById('diff-table').style.display = 'none';
    }

    // Fazit
    const fazitBox = document.getElementById('fazit-box');
    if (ranked.length >= 2) {
        const best = ranked[0];
        const second = ranked[1];
        const saving = second.yearlyCost - best.yearlyCost;
        fazitBox.innerHTML = `
            <strong>Fazit:</strong> Bei einem Jahresverbrauch von <strong>${kwh.toLocaleString('de-DE')} kWh</strong>
            ist <strong>${esc(best.name)}</strong> mit <strong>${formatEuro(best.monthlyCost)}/Monat</strong>
            (${formatEuro(best.yearlyCost)}/Jahr) der günstigste Anbieter.
            Du sparst <strong>${formatEuro(saving)}/Jahr</strong> (${formatEuro(saving / 12)}/Monat) im Vergleich zu ${esc(second.name)}.
            ${best.bonus + best.sonderbonus > 0 ? ` Dabei sind Boni von insgesamt ${formatEuro(best.bonus + best.sonderbonus)} berücksichtigt.` : ''}
        `;
    } else if (ranked.length === 1) {
        const best = ranked[0];
        fazitBox.innerHTML = `
            <strong>Fazit:</strong> Bei einem Jahresverbrauch von <strong>${kwh.toLocaleString('de-DE')} kWh</strong>
            belaufen sich die Kosten bei <strong>${esc(best.name)}</strong> auf
            <strong>${formatEuro(best.monthlyCost)}/Monat</strong> (${formatEuro(best.yearlyCost)}/Jahr).
            ${best.bonus + best.sonderbonus > 0 ? ` Boni von ${formatEuro(best.bonus + best.sonderbonus)} sind bereits abgezogen.` : ''}
            Füge weitere Anbieter hinzu, um zu vergleichen!
        `;
    }

    // Update forecast if value is entered
    updateForecast();
}

// ============ FORECAST ============
document.getElementById('forecast-kwh').addEventListener('input', () => updateForecast());

function updateForecast() {
    const providers = currentComparison ? (currentComparison.data.providers || []) : [];
    const baseKwh = currentComparison ? (currentComparison.data.kwh || 0) : 0;
    const forecastKwh = parseFloat(document.getElementById('forecast-kwh').value) || 0;
    const resultsDiv = document.getElementById('forecast-results');

    if (providers.length < 1 || forecastKwh <= 0 || baseKwh <= 0) {
        resultsDiv.style.display = 'none';
        return;
    }
    resultsDiv.style.display = '';

    // Base ranking (to compare winner changes)
    const baseRanked = providers.map((p, i) => ({
        name: p.name, index: i, yearlyCost: calcYearlyCost(p, baseKwh)
    })).sort((a, b) => a.yearlyCost - b.yearlyCost);
    const baseWinner = baseRanked[0].name;

    // Forecast ranking
    const ranked = providers.map((p, i) => ({
        ...p,
        index: i,
        yearlyCost: calcYearlyCost(p, forecastKwh),
        monthlyCost: calcMonthlyCost(p, forecastKwh),
        abschlag: p.baseFee + (forecastKwh / 12) * (p.kwhPrice / 100),
        baseYearlyCost: calcYearlyCost(p, baseKwh)
    })).sort((a, b) => a.yearlyCost - b.yearlyCost);

    const forecastWinner = ranked[0].name;
    const winnerChanged = forecastWinner !== baseWinner;
    const bestCost = ranked[0].yearlyCost;
    const kwhDiff = forecastKwh - baseKwh;
    const kwhDiffSign = kwhDiff > 0 ? '+' : '';

    const rankList = document.getElementById('forecast-ranking');
    rankList.innerHTML = '';
    ranked.forEach((p, pos) => {
        const diff = p.yearlyCost - bestCost;
        const costChange = p.yearlyCost - p.baseYearlyCost;
        const changeCls = costChange > 0 ? 'forecast-up' : costChange < 0 ? 'forecast-down' : 'forecast-same';
        const changeSign = costChange > 0 ? '+' : '';
        const item = document.createElement('div');
        item.className = `card ranking-item${pos === 0 ? ' highlight' : ''}`;
        item.innerHTML = `
            <div class="ranking-pos">${pos + 1}</div>
            <div class="ranking-info">
                <div class="ranking-name">
                    ${esc(p.name)}
                    ${pos === 0 && winnerChanged ? '<span class="forecast-winner-change">Neu #1</span>' : ''}
                </div>
                <div class="ranking-cost">
                    ${formatEuro(p.monthlyCost)}/Monat · ${formatEuro(p.yearlyCost)}/Jahr
                    ${pos > 0 ? `<br><span class="diff-positive">+${formatEuro(diff)} vs. ${esc(ranked[0].name)}</span>` : ''}
                </div>
                <div class="forecast-change ${changeCls}">
                    ${changeSign}${formatEuro(costChange)}/Jahr vs. aktuellem Verbrauch
                </div>
                <div class="abschlag-info">Voraussichtl. Abschlag: <strong>${formatEuro(p.abschlag)}</strong>/Monat</div>
            </div>
            <div class="ranking-price">${formatEuro(p.monthlyCost)}<br><small style="color:var(--text-secondary);font-weight:400;font-size:0.75rem">/Monat</small></div>
        `;
        rankList.appendChild(item);
    });

    // Forecast Fazit
    const fazitBox = document.getElementById('forecast-fazit');
    const best = ranked[0];
    if (winnerChanged && ranked.length >= 2) {
        const saving = ranked[1].yearlyCost - best.yearlyCost;
        fazitBox.innerHTML = `
            <strong>Achtung:</strong> Bei <strong>${forecastKwh.toLocaleString('de-DE')} kWh</strong>
            (${kwhDiffSign}${kwhDiff.toLocaleString('de-DE')} kWh) wechselt der günstigste Anbieter!
            <strong>${esc(best.name)}</strong> wäre dann mit <strong>${formatEuro(best.yearlyCost)}/Jahr</strong>
            der beste Tarif (statt ${esc(baseWinner)} bei ${baseKwh.toLocaleString('de-DE')} kWh).
            Ersparnis: <strong>${formatEuro(saving)}/Jahr</strong>.
        `;
    } else if (ranked.length >= 2) {
        fazitBox.innerHTML = `
            <strong>Forecast:</strong> Bei <strong>${forecastKwh.toLocaleString('de-DE')} kWh</strong>
            (${kwhDiffSign}${kwhDiff.toLocaleString('de-DE')} kWh) bleibt <strong>${esc(best.name)}</strong>
            der günstigste Anbieter mit <strong>${formatEuro(best.yearlyCost)}/Jahr</strong>
            (${formatEuro(best.monthlyCost)}/Monat).
        `;
    } else {
        fazitBox.innerHTML = `
            <strong>Forecast:</strong> Bei <strong>${forecastKwh.toLocaleString('de-DE')} kWh</strong>
            kosten dich <strong>${esc(best.name)}</strong> <strong>${formatEuro(best.yearlyCost)}/Jahr</strong>
            (${formatEuro(best.monthlyCost)}/Monat).
        `;
    }

    // Nachzahlung / Rückzahlung
    const kwhDelta = forecastKwh - baseKwh; // positive = mehr verbraucht, negative = weniger
    const nachList = document.getElementById('nachzahlung-list');
    nachList.innerHTML = '';

    // Sort by absolute nachzahlung (least payment / most refund first)
    const nachRanked = providers.map(p => ({
        name: p.name,
        nachzahlung: kwhDelta * (p.kwhPrice / 100) // nur Verbrauchspreis
    })).sort((a, b) => a.nachzahlung - b.nachzahlung);

    nachRanked.forEach(p => {
        const isPay = p.nachzahlung > 0;
        const isZero = p.nachzahlung === 0;
        const label = isZero ? 'Keine Differenz' : isPay ? 'Nachzahlung' : 'Rückzahlung';
        const cls = isZero ? '' : isPay ? 'pay' : 'refund';
        const item = document.createElement('div');
        item.className = 'card nachzahlung-item';
        item.innerHTML = `
            <div class="ranking-info">
                <div class="ranking-name">${esc(p.name)}</div>
                <div class="nachzahlung-label ${cls}">${label}</div>
            </div>
            <div class="nachzahlung-amount ${cls}">${isPay ? '+' : ''}${formatEuro(p.nachzahlung)}</div>
        `;
        nachList.appendChild(item);
    });
}

// ============ TRACKER ============

// Dashboard card
document.getElementById('btn-open-tracker').addEventListener('click', () => {
    showScreen('tracker-screen');
    loadTracker();
});
document.getElementById('btn-back-tracker').addEventListener('click', () => {
    showScreen('dashboard-screen');
    loadComparisons();
    updateTrackerCard();
});

async function updateTrackerCard() {
    try {
        const snap = await getDocs(collection(db, `users/${currentUser.userId}/meterReadings`));
        const subtitle = document.getElementById('tracker-subtitle');
        if (snap.size === 0) {
            subtitle.textContent = 'Noch keine Zählerstände erfasst';
        } else {
            let latest = '';
            snap.forEach(d => {
                const date = d.data().date;
                if (date > latest) latest = date;
            });
            subtitle.textContent = `${snap.size} Einträge · Letzte Ablesung: ${new Date(latest).toLocaleDateString('de-DE')}`;
        }
    } catch (e) { /* ignore */ }
}

async function loadTracker() {
    await Promise.all([loadReadings(), loadContracts()]);
    renderReadings();
    renderContracts();
    renderConsumptionChart();
    updateTrackerKPIs();
    checkCancellationReminder();
}

async function loadReadings() {
    const snap = await getDocs(collection(db, `users/${currentUser.userId}/meterReadings`));
    trackerReadings = [];
    snap.forEach(d => {
        trackerReadings.push({ id: d.id, ...d.data() });
    });
    trackerReadings.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadContracts() {
    const snap = await getDocs(collection(db, `users/${currentUser.userId}/contracts`));
    trackerContracts = [];
    snap.forEach(d => {
        trackerContracts.push({ id: d.id, ...d.data() });
    });
    trackerContracts.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// Contract helpers
function getContractForDate(dateStr) {
    if (trackerContracts.length === 0) return null;
    const matching = trackerContracts
        .filter(c => c.startDate <= dateStr && (!c.endDate || c.endDate >= dateStr))
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    return matching[0] || null;
}

function getActiveContract() {
    return getContractForDate(new Date().toISOString().slice(0, 10));
}

function getBonusPerDay(contract) {
    if (!contract.bonus || !contract.startDate || !contract.endDate) return 0;
    const days = (new Date(contract.endDate) - new Date(contract.startDate)) / (1000 * 60 * 60 * 24);
    return days > 0 ? contract.bonus / days : 0;
}

function calcPeriodCost(consumption, rawLabel, period) {
    let dateStr;
    if (period === 'day') dateStr = rawLabel;
    else if (period === 'month') dateStr = rawLabel + '-15';
    else dateStr = rawLabel + '-07-01';

    const contract = getContractForDate(dateStr);
    if (!contract) return null;

    const consumptionCost = consumption * (contract.kwhPrice / 100);
    const bonusPerDay = getBonusPerDay(contract);

    let baseFee, bonusCredit;
    if (period === 'day') {
        baseFee = contract.baseFee / 30.44;
        bonusCredit = bonusPerDay;
    } else if (period === 'month') {
        baseFee = contract.baseFee;
        bonusCredit = bonusPerDay * 30.44;
    } else {
        baseFee = contract.baseFee * 12;
        bonusCredit = bonusPerDay * 365.25;
    }

    return Math.max(0, Math.round((consumptionCost + baseFee - bonusCredit) * 100) / 100);
}

// ============ READINGS CRUD ============
function renderReadings() {
    const list = document.getElementById('readings-list');
    list.innerHTML = '';

    if (trackerReadings.length === 0) {
        list.innerHTML = '<p class="empty-state">Noch keine Zählerstände erfasst.<br>Erfasse deinen ersten Zählerstand!</p>';
        return;
    }

    const sorted = [...trackerReadings].reverse();
    sorted.forEach((r, idx) => {
        const actualIdx = trackerReadings.length - 1 - idx;
        const prev = actualIdx > 0 ? trackerReadings[actualIdx - 1] : null;
        const consumption = prev ? r.value - prev.value : null;
        const days = prev ? Math.max(1, (new Date(r.date) - new Date(prev.date)) / (1000 * 60 * 60 * 24)) : null;

        const card = document.createElement('div');
        card.className = 'card reading-card';
        card.innerHTML = `
            <div class="reading-info">
                <div class="card-title">${new Date(r.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                <div class="card-subtitle">
                    Zählerstand: <strong>${r.value.toLocaleString('de-DE')} kWh</strong>
                    ${consumption !== null
                        ? `<br>Verbrauch: ${Math.round(consumption).toLocaleString('de-DE')} kWh in ${Math.round(days)} Tagen (${(consumption / days).toFixed(1)} kWh/Tag)`
                        : '<br>Erster Eintrag'}
                </div>
            </div>
            <div class="provider-actions">
                <button class="btn btn-icon" title="Bearbeiten" data-edit-reading="${r.id}">✏️</button>
                <button class="btn btn-icon btn-danger-icon" title="Löschen" data-delete-reading="${r.id}">🗑️</button>
            </div>
        `;
        list.appendChild(card);
    });

    list.onclick = async (e) => {
        const editBtn = e.target.closest('[data-edit-reading]');
        const delBtn = e.target.closest('[data-delete-reading]');

        if (editBtn) {
            const id = editBtn.dataset.editReading;
            const reading = trackerReadings.find(r => r.id === id);
            if (!reading) return;
            document.getElementById('reading-modal-title').textContent = 'Zählerstand bearbeiten';
            document.getElementById('reading-date').value = reading.date;
            document.getElementById('reading-value').value = reading.value;
            document.getElementById('reading-edit-id').value = id;
            showModal('reading-modal');
        }

        if (delBtn) {
            const id = delBtn.dataset.deleteReading;
            if (!confirm('Zählerstand wirklich löschen?')) return;
            await deleteDoc(doc(db, `users/${currentUser.userId}/meterReadings`, id));
            toast('Zählerstand gelöscht');
            await loadReadings();
            renderReadings();
            renderConsumptionChart();
            updateTrackerKPIs();
        }
    };
}

document.getElementById('btn-add-reading').addEventListener('click', () => {
    document.getElementById('reading-modal-title').textContent = 'Zählerstand erfassen';
    document.getElementById('reading-form').reset();
    document.getElementById('reading-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('reading-edit-id').value = '';
    showModal('reading-modal');
});

document.getElementById('reading-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = document.getElementById('reading-date').value;
    const value = parseFloat(document.getElementById('reading-value').value);
    const editId = document.getElementById('reading-edit-id').value;

    if (!date || isNaN(value)) return;

    if (editId) {
        await updateDoc(doc(db, `users/${currentUser.userId}/meterReadings`, editId), { date, value });
        toast('Zählerstand aktualisiert');
    } else {
        const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await setDoc(doc(db, `users/${currentUser.userId}/meterReadings`, newId), {
            date, value, createdAt: new Date().toISOString()
        });
        toast('Zählerstand gespeichert');
    }

    hideModal('reading-modal');
    await loadReadings();
    renderReadings();
    renderConsumptionChart();
    updateTrackerKPIs();
});

// ============ CONTRACTS ============
document.getElementById('btn-contract-settings').addEventListener('click', () => openContractModal());
document.getElementById('btn-add-contract').addEventListener('click', () => openContractModal());

function openContractModal(contract) {
    if (contract) {
        document.getElementById('contract-modal-title').textContent = 'Vertrag bearbeiten';
        document.getElementById('contract-name').value = contract.name || '';
        document.getElementById('contract-start').value = contract.startDate || '';
        document.getElementById('contract-end').value = contract.endDate || '';
        document.getElementById('contract-kwh-price').value = contract.kwhPrice || '';
        document.getElementById('contract-base-fee').value = contract.baseFee || '';
        document.getElementById('contract-bonus').value = contract.bonus || 0;
        document.getElementById('contract-cancel-date').value = contract.reminderDate || '';
        document.getElementById('contract-edit-id').value = contract.id;
    } else {
        document.getElementById('contract-modal-title').textContent = 'Vertrag anlegen';
        document.getElementById('contract-form').reset();
        document.getElementById('contract-bonus').value = '0';
        document.getElementById('contract-edit-id').value = '';
    }
    showModal('contract-modal');
}

document.getElementById('contract-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        name: document.getElementById('contract-name').value.trim(),
        startDate: document.getElementById('contract-start').value,
        endDate: document.getElementById('contract-end').value || null,
        kwhPrice: parseFloat(document.getElementById('contract-kwh-price').value) || 0,
        baseFee: parseFloat(document.getElementById('contract-base-fee').value) || 0,
        bonus: parseFloat(document.getElementById('contract-bonus').value) || 0,
        reminderDate: document.getElementById('contract-cancel-date').value || null,
        createdAt: new Date().toISOString()
    };

    const editId = document.getElementById('contract-edit-id').value;

    if (editId) {
        await updateDoc(doc(db, `users/${currentUser.userId}/contracts`, editId), data);
        toast('Vertrag aktualisiert');
    } else {
        const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await setDoc(doc(db, `users/${currentUser.userId}/contracts`, newId), data);
        toast('Vertrag gespeichert');
    }

    hideModal('contract-modal');
    await loadContracts();
    renderContracts();
    renderConsumptionChart();
    updateTrackerKPIs();
    checkCancellationReminder();
});

function renderContracts() {
    const list = document.getElementById('contracts-list');
    list.innerHTML = '';

    if (trackerContracts.length === 0) {
        list.innerHTML = '<p class="empty-state">Keine Verträge hinterlegt.<br>Lege deinen ersten Vertrag an!</p>';
        return;
    }

    trackerContracts.forEach(c => {
        const bonusMonthly = getBonusPerDay(c) * 30.44;
        const card = document.createElement('div');
        card.className = 'card reading-card';
        card.innerHTML = `
            <div class="reading-info">
                <div class="card-title">${esc(c.name)}</div>
                <div class="card-subtitle">
                    ${new Date(c.startDate).toLocaleDateString('de-DE')} – ${c.endDate ? new Date(c.endDate).toLocaleDateString('de-DE') : 'unbefristet'}
                    <br>${c.kwhPrice} ct/kWh · ${formatEuro(c.baseFee)}/Monat
                    ${c.bonus ? ` · Bonus: ${formatEuro(c.bonus)}` : ''}
                    ${bonusMonthly > 0 ? ` (${formatEuro(bonusMonthly)}/Mo)` : ''}
                    ${c.reminderDate ? `<br>Kündigung: ${new Date(c.reminderDate).toLocaleDateString('de-DE')}` : ''}
                </div>
            </div>
            <div class="provider-actions">
                <button class="btn btn-icon" title="Bearbeiten" data-edit-contract="${c.id}">✏️</button>
                <button class="btn btn-icon btn-danger-icon" title="Löschen" data-delete-contract="${c.id}">🗑️</button>
            </div>
        `;
        list.appendChild(card);
    });

    list.onclick = async (e) => {
        const editBtn = e.target.closest('[data-edit-contract]');
        const delBtn = e.target.closest('[data-delete-contract]');

        if (editBtn) {
            const id = editBtn.dataset.editContract;
            const contract = trackerContracts.find(c => c.id === id);
            if (contract) openContractModal(contract);
        }

        if (delBtn) {
            const id = delBtn.dataset.deleteContract;
            if (!confirm('Vertrag wirklich löschen?')) return;
            await deleteDoc(doc(db, `users/${currentUser.userId}/contracts`, id));
            toast('Vertrag gelöscht');
            await loadContracts();
            renderContracts();
            renderConsumptionChart();
            updateTrackerKPIs();
            checkCancellationReminder();
        }
    };
}

// ============ CONSUMPTION CHART ============
function calcConsumptionSegments() {
    if (trackerReadings.length < 2) return [];
    const segments = [];
    for (let i = 1; i < trackerReadings.length; i++) {
        const prev = trackerReadings[i - 1];
        const curr = trackerReadings[i];
        const consumption = curr.value - prev.value;
        const d1 = new Date(prev.date);
        const d2 = new Date(curr.date);
        const days = Math.max(1, (d2 - d1) / (1000 * 60 * 60 * 24));
        segments.push({
            fromDate: prev.date,
            toDate: curr.date,
            consumption,
            days,
            dailyRate: consumption / days
        });
    }
    return segments;
}

function aggregateByPeriod(segments, period) {
    const buckets = {};

    segments.forEach(seg => {
        const d1 = new Date(seg.fromDate);
        const d2 = new Date(seg.toDate);
        let current = new Date(d1);

        while (current < d2) {
            let key;
            if (period === 'day') {
                key = current.toISOString().slice(0, 10);
            } else if (period === 'month') {
                key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
            } else {
                key = `${current.getFullYear()}`;
            }

            if (!buckets[key]) buckets[key] = 0;
            buckets[key] += seg.dailyRate;
            current.setDate(current.getDate() + 1);
        }
    });

    return Object.entries(buckets)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, value]) => ({ label, value: Math.round(value * 10) / 10 }));
}

function formatPeriodLabel(label, period) {
    if (period === 'day') {
        return new Date(label).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    } else if (period === 'month') {
        const [y, m] = label.split('-');
        const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
        return `${months[parseInt(m) - 1]} ${y}`;
    }
    return label;
}

function renderConsumptionChart() {
    const segments = calcConsumptionSegments();
    const canvas = document.getElementById('consumption-chart');

    if (consumptionChart) consumptionChart.destroy();

    if (segments.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const period = currentChartPeriod === 'all' ? 'month' : currentChartPeriod;
    let data = aggregateByPeriod(segments, period);

    // Limit data points for readability
    if (currentChartPeriod === 'day' && data.length > 90) {
        data = data.slice(-90);
    } else if (currentChartPeriod === 'month' && data.length > 24) {
        data = data.slice(-24);
    }

    const labels = data.map(d => formatPeriodLabel(d.label, period));
    const values = data.map(d => d.value);

    const showCostBars = document.getElementById('chart-cost-bars').checked && trackerContracts.length > 0;

    const datasets = [{
        label: 'Verbrauch (kWh)',
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: data.length > 30 ? 0 : 3,
        pointHitRadius: 10,
        borderWidth: 2.5,
        yAxisID: 'y'
    }];

    if (showCostBars) {
        const costs = data.map((d, i) => calcPeriodCost(d.value, d.label, period));
        const hasCosts = costs.some(c => c !== null);
        if (hasCosts) {
            datasets.push({
                type: 'bar',
                label: 'Kosten (€)',
                data: costs.map(c => c || 0),
                backgroundColor: 'rgba(245, 158, 11, 0.35)',
                borderColor: '#f59e0b',
                borderWidth: 1,
                yAxisID: 'y1',
                order: 1
            });
        }
    }

    const scales = {
        y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'kWh', font: { size: 11 } },
            ticks: { callback: v => v.toLocaleString('de-DE') },
            beginAtZero: true
        },
        x: {
            ticks: {
                maxRotation: 45,
                font: { size: 10 },
                maxTicksLimit: 12
            }
        }
    };

    if (showCostBars) {
        scales.y1 = {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: '€', font: { size: 11 } },
            ticks: { callback: v => v.toLocaleString('de-DE') + ' €' },
            beginAtZero: true,
            grid: { drawOnChartArea: false }
        };
    }

    // Separator line plugin
    const separatorEnabled = document.getElementById('chart-separator').checked;
    const separatorDate = document.getElementById('chart-separator-date').value;
    const separatorPlugin = {
        id: 'separatorLine',
        afterDraw(chart) {
            if (!separatorEnabled || !separatorDate) return;
            // Find the label index closest to the separator date
            let sepLabel;
            const period = currentChartPeriod === 'all' ? 'month' : currentChartPeriod;
            if (period === 'day') {
                sepLabel = new Date(separatorDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
            } else if (period === 'month') {
                const [y, m] = separatorDate.split('-');
                const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
                sepLabel = `${months[parseInt(m) - 1]} ${y}`;
            } else {
                sepLabel = separatorDate.split('-')[0];
            }
            const idx = chart.data.labels.indexOf(sepLabel);
            if (idx < 0) return;
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;
            const xPixel = xScale.getPixelForValue(idx);
            if (xPixel < xScale.left || xPixel > xScale.right) return;
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.moveTo(xPixel, yScale.top);
            ctx.lineTo(xPixel, yScale.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 10px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Trennlinie', xPixel, yScale.top - 4);
            ctx.restore();
        }
    };

    consumptionChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            if (ctx.datasetIndex === 0) return `Verbrauch: ${ctx.parsed.y.toLocaleString('de-DE')} kWh`;
                            return `Kosten: ${formatEuro(ctx.parsed.y)}`;
                        }
                    }
                }
            },
            layout: { padding: { top: 14 } },
            scales
        },
        plugins: [separatorPlugin]
    });
}

// Period toggle
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentChartPeriod = btn.dataset.period;
        renderConsumptionChart();
    });
});

// Cost bars toggle
document.getElementById('chart-cost-bars').addEventListener('change', () => renderConsumptionChart());

// Separator line toggle
document.getElementById('chart-separator').addEventListener('change', (e) => {
    document.getElementById('separator-date-group').style.display = e.target.checked ? '' : 'none';
    if (!e.target.checked) {
        renderConsumptionChart();
    }
});
document.getElementById('chart-separator-date').addEventListener('change', () => {
    renderConsumptionChart();
});

// ============ TRACKER KPIs ============
function updateTrackerKPIs() {
    const segments = calcConsumptionSegments();

    const kpiAvg = document.getElementById('kpi-avg-yearly');
    const kpiTrend = document.getElementById('kpi-trend');
    const kpiCostYearly = document.getElementById('kpi-cost-yearly');
    const kpiCostMonthly = document.getElementById('kpi-cost-monthly');

    if (segments.length === 0) {
        kpiAvg.textContent = '– kWh';
        kpiTrend.textContent = '–';
        kpiTrend.className = 'kpi-value';
        kpiCostYearly.textContent = '–';
        kpiCostMonthly.textContent = '–';
        return;
    }

    const totalConsumption = segments.reduce((sum, s) => sum + s.consumption, 0);
    const totalDays = segments.reduce((sum, s) => sum + s.days, 0);
    const avgDailyConsumption = totalConsumption / totalDays;
    const avgYearlyConsumption = Math.round(avgDailyConsumption * 365);

    kpiAvg.textContent = `${avgYearlyConsumption.toLocaleString('de-DE')} kWh`;

    // Trend: compare last 90 days vs overall average
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let recentConsumption = 0;
    let recentDays = 0;
    segments.forEach(seg => {
        const segStart = new Date(seg.fromDate);
        const segEnd = new Date(seg.toDate);
        const overlapStart = new Date(Math.max(segStart, ninetyDaysAgo));
        const overlapEnd = new Date(Math.min(segEnd, now));

        if (overlapEnd > overlapStart) {
            const overlapDays = (overlapEnd - overlapStart) / (1000 * 60 * 60 * 24);
            recentConsumption += seg.dailyRate * overlapDays;
            recentDays += overlapDays;
        }
    });

    if (recentDays > 30) {
        const recentDailyAvg = recentConsumption / recentDays;
        const diffPercent = ((recentDailyAvg - avgDailyConsumption) / avgDailyConsumption) * 100;

        if (Math.abs(diffPercent) < 3) {
            kpiTrend.textContent = '→ Stabil';
            kpiTrend.className = 'kpi-value kpi-trend-stable';
        } else if (diffPercent > 0) {
            kpiTrend.textContent = `↑ +${diffPercent.toFixed(0)}% mehr`;
            kpiTrend.className = 'kpi-value kpi-trend-up';
        } else {
            kpiTrend.textContent = `↓ ${diffPercent.toFixed(0)}% weniger`;
            kpiTrend.className = 'kpi-value kpi-trend-down';
        }
    } else {
        kpiTrend.textContent = 'Zu wenig Daten';
        kpiTrend.className = 'kpi-value kpi-trend-stable';
    }

    // Cost KPIs - use currently active contract
    const activeContract = getActiveContract();
    if (activeContract) {
        const yearlyConsumptionCost = avgYearlyConsumption * (activeContract.kwhPrice / 100);
        const yearlyBaseFee = activeContract.baseFee * 12;
        const bonusPerDay = getBonusPerDay(activeContract);
        const yearlyBonus = bonusPerDay * 365.25;
        const yearlyCost = yearlyConsumptionCost + yearlyBaseFee - yearlyBonus;
        const monthlyCost = yearlyCost / 12;

        kpiCostYearly.textContent = formatEuro(yearlyCost);
        kpiCostMonthly.textContent = formatEuro(monthlyCost);
    } else if (trackerContracts.length > 0) {
        kpiCostYearly.textContent = 'Kein aktiver';
        kpiCostMonthly.textContent = 'Kein aktiver';
    } else {
        kpiCostYearly.textContent = 'Kein Vertrag';
        kpiCostMonthly.textContent = 'Kein Vertrag';
    }
}

// ============ CANCELLATION REMINDER ============
function checkCancellationReminder() {
    const banner = document.getElementById('cancellation-banner');
    const text = document.getElementById('cancellation-text');

    const today = new Date().toISOString().slice(0, 10);
    const alerts = [];

    trackerContracts.forEach(c => {
        if (!c.reminderDate) return;
        const reminderDate = c.reminderDate;

        if (today >= reminderDate) {
            const daysAgo = Math.floor((new Date(today) - new Date(reminderDate)) / (1000 * 60 * 60 * 24));
            if (daysAgo === 0) {
                alerts.push(`Heute: Kündigung "${c.name}"!`);
            } else {
                alerts.push(`"${c.name}" Kündigung vor ${daysAgo} Tagen fällig!`);
            }
        } else {
            const daysUntil = Math.ceil((new Date(reminderDate) - new Date(today)) / (1000 * 60 * 60 * 24));
            if (daysUntil <= 30) {
                alerts.push(`"${c.name}" Kündigung in ${daysUntil} Tagen (${new Date(reminderDate).toLocaleDateString('de-DE')})`);
            }
        }
    });

    if (alerts.length > 0) {
        banner.style.display = '';
        text.textContent = alerts.join(' | ');
    } else {
        banner.style.display = 'none';
    }
}

// ============ EXCEL EXPORT ============
document.getElementById('btn-export-readings').addEventListener('click', () => {
    if (trackerReadings.length > 0) {
        document.getElementById('export-from').value = trackerReadings[0].date;
        document.getElementById('export-to').value = trackerReadings[trackerReadings.length - 1].date;
    } else {
        document.getElementById('export-from').value = '';
        document.getElementById('export-to').value = '';
    }
    showModal('export-modal');
});

document.getElementById('export-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fromDate = document.getElementById('export-from').value;
    const toDate = document.getElementById('export-to').value;

    let readings = [...trackerReadings];
    if (fromDate) readings = readings.filter(r => r.date >= fromDate);
    if (toDate) readings = readings.filter(r => r.date <= toDate);

    if (readings.length === 0) {
        toast('Keine Daten im gewählten Zeitraum');
        return;
    }

    const exportData = readings.map((r, i) => {
        const prev = i > 0 ? readings[i - 1] : null;
        const consumption = prev ? r.value - prev.value : null;
        const days = prev ? Math.max(1, (new Date(r.date) - new Date(prev.date)) / (1000 * 60 * 60 * 24)) : null;

        const row = {
            'Datum': r.date,
            'Zählerstand (kWh)': r.value,
            'Verbrauch (kWh)': consumption !== null ? Math.round(consumption * 10) / 10 : '',
            'Tage seit letzter Ablesung': days !== null ? Math.round(days) : '',
            'Ø Verbrauch/Tag (kWh)': consumption !== null && days ? Math.round(consumption / days * 10) / 10 : ''
        };

        const contract = getContractForDate(r.date);
        if (contract && consumption !== null) {
            const bonusPerDay = getBonusPerDay(contract);
            const costDays = days || 1;
            const cost = consumption * (contract.kwhPrice / 100) + contract.baseFee / 30.44 * costDays - bonusPerDay * costDays;
            row['Vertrag'] = contract.name;
            row['Kosten (€)'] = Math.round(Math.max(0, cost) * 100) / 100;
        }

        return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Zählerstände');

    const colWidths = Object.keys(exportData[0]).map(key => ({
        wch: Math.max(key.length + 2, ...exportData.map(r => String(r[key] || '').length + 2))
    }));
    ws['!cols'] = colWidths;

    const fileName = `Stromzaehler_${fromDate || 'alle'}_${toDate || 'alle'}.xlsx`;
    XLSX.writeFile(wb, fileName);
    hideModal('export-modal');
    toast('Excel exportiert!');
});

// ============ MODAL CLOSE ============
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        hideModal(modalId);
        if (currentComparison) currentComparison._editing = false;
    });
});
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            hideModal(modal.id);
            if (currentComparison) currentComparison._editing = false;
        }
    });
});

// ============ ESCAPE HTML ============
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============ INIT ============
async function init() {
    await initAdmin();

    // Check saved session
    const saved = localStorage.getItem('strom_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            // Verify user still exists
            const snap = await getDoc(doc(db, 'users', currentUser.userId));
            if (snap.exists()) {
                enterApp();
                return;
            }
        } catch (e) { }
        localStorage.removeItem('strom_user');
    }

    showScreen('login-screen');
}

init();
