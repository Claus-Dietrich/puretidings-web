// PureTidings Web - Ultra-Robust Launcher (RECOVERY VERSION)
const SUPABASE_URL = 'https://lujvogyndoryofuffntr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1anZvZ3luZG9yeW9mdWZmbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzI3ODYsImV4cCI6MjA5NzAwODc4Nn0.UEEN01ZKzcdkbP5ktOm35UgWwYQbbwTkM4K0u9_b09w';

let db;
let currentUser = null;
let userData = {
    feed_tree: [],
    favorited_links: [],
    read_links: [],
    duration_cache: {}
};

function setStatus(msg) {
    const el = document.getElementById('auth-status');
    if (el) el.innerText = msg;
    console.log("Status:", msg);
}

async function init() {
    console.log("App-Start...");
    if (!window.supabase) {
        alert("Supabase konnte nicht geladen werden. Bitte Internetverbindung prüfen.");
        return;
    }

    try {
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log("DB bereit.");
    } catch (e) {
        console.error("DB Error:", e);
    }

    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (loginBtn) loginBtn.onclick = handleLogin;
    if (logoutBtn) logoutBtn.onclick = handleLogout;

    db.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth Event:", event);
        const authOverlay = document.getElementById('auth-overlay');
        const appContainer = document.getElementById('app-container');

        if (session) {
            currentUser = session.user;
            if (authOverlay) authOverlay.style.display = 'none';
            if (appContainer) appContainer.style.display = 'flex';
            await loadApp(session.user);
        } else {
            if (authOverlay) authOverlay.style.display = 'flex';
            if (appContainer) appContainer.style.display = 'none';
        }
    });
}

async function handleLogin() {
    const email = document.getElementById('email-input').value.trim();
    if (!email) return alert('Bitte E-Mail eingeben');
    setStatus("Sende Magic Link...");
    const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) alert("Fehler: " + error.message);
    else setStatus("Link gesendet! Bitte E-Mails prüfen.");
}

async function handleLogout() {
    await db.auth.signOut();
    location.reload();
}

async function loadApp(user) {
    console.log("Lade Nutzerdaten für:", user.email);
    const userBadge = document.getElementById('user-badge');
    if (userBadge) userBadge.innerText = user.email;

    try {
        let { data, error } = await db.from('user_settings').select('*').eq('id', user.id).single();
        if (error && error.code === 'PGRST116') {
            console.log("Neues Profil wird erstellt...");
            const { data: n, error: e } = await db.from('user_settings').insert([{ id: user.id, email: user.email }]).select().single();
            data = n;
        }

        if (data) {
            userData = {
                feed_tree: data.feed_tree || [],
                favorited_links: data.favorited_links || [],
                read_links: data.read_links || [],
                duration_cache: data.duration_cache || {}
            };
            console.log("Daten geladen:", userData);
        }

        renderSidebar(userData.feed_tree);
        calculateAllUnreadCounts();
    } catch (e) {
        console.error("Fehler in loadApp:", e);
    }
}

function renderSidebar(tree) {
    console.log("Zeichne Sidebar...");
    const container = document.getElementById('feed-tree-container');
    if (!container) return;

    container.innerHTML = `
        <div style="padding:15px 10px;">
            <div onclick="showView('all')" style="padding:8px 10px; cursor:pointer; color:#eee; display:flex; gap:10px; background:#222; border-radius:6px; margin-bottom:5px;">🏠 All Posts</div>
            <div onclick="showView('favorites')" style="padding:8px 10px; cursor:pointer; color:#aaa; display:flex; gap:10px;">⭐ Favorites</div>
        </div>
        <h3 style="padding:10px 20px; font-size:11px; color:#555; text-transform:uppercase; margin:10px 0 5px 0;">Feeds</h3>
        <ul id="sidebar-feed-list" style="list-style:none; padding:0;"></ul>
    `;

    const list = document.getElementById('sidebar-feed-list');
    if (!tree || tree.length === 0) {
        list.innerHTML = '<li style="padding:10px 20px; color:#666; font-size:12px;">Keine Feeds vorhanden.</li>';
        return;
    }

    function walk(nodes) {
        nodes.forEach((n, index) => {
            if (n.type === 'feed') {
                const li = document.createElement('li');
                li.style.padding = '8px 20px'; li.style.cursor = 'pointer'; li.style.color = '#ccc'; li.style.fontSize = '13px';
                li.style.display = 'flex'; li.style.alignItems = 'center';
                // Einfache ID ohne btoa Risiko
                const safeId = "feed-" + index + "-" + Math.random().toString(36).substr(2, 5);
                li.innerHTML = `<span style="margin-right:8px;">📰</span> <span style="flex:1;">${n.name}</span> <span class="badge-${index}" style="background:#4a90e2; color:white; font-size:10px; padding:1px 6px; border-radius:10px; display:none;"></span>`;
                li.onclick = () => loadFeedPosts(n.url, n.name);
                list.appendChild(li);
            }
            if (n.children) walk(n.children);
        });
    }
    walk(tree);
}

async function loadFeedPosts(url, name) {
    const container = document.getElementById('posts-container');
    container.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><div>Lade...</div></div>';

    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const txt = await res.text();
        const xml = new DOMParser().parseFromString(txt, "text/xml");
        const items = xml.querySelectorAll('item, entry');

        container.innerHTML = `<div class="feed-header">${name}</div>`;
        items.forEach(item => {
            const title = item.querySelector('title')?.textContent || 'Kein Titel';
            const link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href');
            
            const div = document.createElement('div');
            div.className = 'post-row';
            div.innerHTML = `
                <div class="post-thumbnail">📰</div>
                <div class="post-info"><div class="post-title">${title}</div></div>
                <div class="post-actions"><button class="action-btn" onclick="openReader({title:'${title}', link:'${link}'})">👓</button></div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        container.innerHTML = `<div style="padding:20px; color:red;">Fehler: ${e.message}</div>`;
    }
}

function showView(v) { alert("Ansicht " + v + " folgt!"); }
async function calculateAllUnreadCounts() { console.log("Zähler-Berechnung im Hintergrund..."); }
function closeReader() { document.getElementById('reader-overlay').style.display = 'none'; document.body.style.overflow = 'auto'; }

window.onload = init;
