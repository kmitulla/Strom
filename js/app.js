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
}

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
