// PureTidings Web - Bulletproof Persistence Launcher
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

// Hilfsfunktion: Zeigt Fehlermeldung direkt auf der Seite an (für besseres Debugging)
function showErrorOnScreen(msg) {
    const container = document.getElementById('posts-container');
    if (container) {
        container.innerHTML = `<div style="padding:40px; color:#ff4444; text-align:center;">
            <h3>Etwas ist schiefgelaufen</h3>
            <p>${msg}</p>
            <button onclick="location.reload()" style="padding:10px 20px; background:#444; color:white; border:none; border-radius:5px; cursor:pointer;">Seite neu laden</button>
        </div>`;
    }
}

async function init() {
    console.log("🚀 PureTidings Init...");
    
    // 0. Service Worker radikal entfernen (verhindert hängende alte Versionen)
    if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (let r of regs) await r.unregister();
    }

    if (!window.supabase) {
        showErrorOnScreen("Supabase Bibliothek konnte nicht geladen werden.");
        return;
    }

    try {
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        
        // 1. Explizite Prüfung der bestehenden Session beim Start
        const { data: { session }, error } = await db.auth.getSession();
        if (error) throw error;

        if (session) {
            console.log("Session gefunden:", session.user.email);
            currentUser = session.user;
            toggleUI(true);
            await loadApp(session.user);
        } else {
            console.log("Keine Session. Zeige Login.");
            toggleUI(false);
        }

        // 2. Listener für spätere Status-Änderungen (Login/Logout)
        db.auth.onAuthStateChange(async (event, session) => {
            console.log("Auth Event:", event);
            if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                toggleUI(true);
                await loadApp(session.user);
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                toggleUI(false);
            }
        });

    } catch (e) {
        console.error("Init Fatal Error:", e);
        showErrorOnScreen(e.message);
    }

    // Button Events
    document.getElementById('login-btn').onclick = handleLogin;
    document.getElementById('logout-btn').onclick = handleLogout;
    
    // Enter-Key Support
    const emailInput = document.getElementById('email-input');
    const passInput = document.getElementById('password-input');
    [emailInput, passInput].forEach(el => {
        if (el) el.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };
    });
}

function toggleUI(isLoggedIn) {
    const auth = document.getElementById('auth-overlay');
    const app = document.getElementById('app-container');
    if (!auth || !app) return;
    auth.style.display = isLoggedIn ? 'none' : 'flex';
    app.style.display = isLoggedIn ? 'flex' : 'none';
}

async function handleLogin() {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value;
    if (!email) return alert('E-Mail eingeben');
    
    document.getElementById('auth-status').innerText = "Verarbeite...";
    if (password) {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
    } else {
        const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) alert(error.message);
        else alert("Magic Link gesendet!");
    }
}

async function handleLogout() {
    toggleUI(false);
    await db.auth.signOut();
    localStorage.clear();
    location.reload();
}

async function loadApp(user) {
    const userBadge = document.getElementById('user-badge');
    if (userBadge) userBadge.innerText = user.email;
    
    try {
        let { data, error } = await db.from('user_settings').select('*').eq('id', user.id).single();
        if (error && error.code === 'PGRST116') {
            const { data: n } = await db.from('user_settings').insert([{ id: user.id, email: user.email }]).select().single();
            data = n;
        }

        if (data) {
            userData = {
                feed_tree: data.feed_tree || [],
                favorited_links: data.favorited_links || [],
                read_links: data.read_links || [],
                duration_cache: data.duration_cache || {}
            };
        }
        
        renderSidebar(userData.feed_tree);
        checkProStatus(data || {});
        calculateAllUnreadCounts();

    } catch (e) { showErrorOnScreen("Fehler beim Laden der Profildaten: " + e.message); }
}

function checkProStatus(data) {
    const btn = document.getElementById('upgrade-btn');
    if (btn) {
        if (data.is_pro) btn.classList.add('hidden');
        else {
            btn.href = `https://buy.polar.sh/polar_cl_hyHl1QpZkQfPWmUapDe4fshQi2MJzxfcLwPjE2AIaLr?metadata[user_id]=${currentUser.id}&customer_email=${encodeURIComponent(currentUser.email)}`;
            btn.classList.remove('hidden');
        }
    }
}

// --- SIDEBAR & COUNTERS ---

function safeId(str) {
    if (!str) return 'id-unknown';
    try { return 'id-' + btoa(unescape(encodeURIComponent(str))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16); }
    catch(e) { return 'id-' + Math.random().toString(36).substr(2, 8); }
}

function renderSidebar(tree) {
    const container = document.getElementById('feed-tree-container');
    if (!container) return;
    
    container.innerHTML = `
        <div style="padding:15px 10px;">
            <div onclick="showView('all')" class="sidebar-item" style="padding:8px 10px; cursor:pointer; color:#eee; font-size:13px; display:flex; align-items:center; gap:10px; background:#222; border-radius:6px; margin-bottom:5px;"><span>🏠</span> All Posts</div>
            <div onclick="showView('favorites')" class="sidebar-item" style="padding:8px 10px; cursor:pointer; color:#aaa; font-size:13px; display:flex; align-items:center; gap:10px;"><span>⭐</span> Favorites</div>
        </div>
        <h3 style="padding:10px 20px; font-size:11px; color:#555; text-transform:uppercase; margin:10px 0 5px 0;">My Feeds</h3>
        <div id="feed-list-items"></div>
    `;
    
    const list = document.getElementById('feed-list-items');
    const ul = document.createElement('ul'); ul.style.listStyle = 'none'; ul.style.padding = '0';
    
    function walk(nodes) {
        nodes.forEach(n => {
            if (n.type === 'feed' && n.url) {
                const li = document.createElement('li');
                li.id = `sidebar-feed-${safeId(n.url)}`;
                li.style.padding = '8px 20px'; li.style.cursor = 'pointer'; li.style.fontSize = '13px'; li.style.color = '#ccc';
                li.style.display = 'flex'; li.style.alignItems = 'center';
                li.innerHTML = `<span style="margin-right:8px; opacity:0.6;">📰</span> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${n.name}</span><span class="unread-count" style="font-size:10px; background:#4a90e2; color:white; padding:1px 6px; border-radius:10px; margin-left:5px; display:none;">0</span>`;
                li.onclick = () => loadFeedPosts(n.url, n.name);
                ul.appendChild(li);
            }
            if (n.children) walk(n.children);
        });
    }
    walk(tree);
    list.appendChild(ul);
}

async function calculateAllUnreadCounts() {
    const feeds = [];
    function walk(nodes) { nodes.forEach(n => { if (n.type === 'feed' && n.url) feeds.push(n); if (n.children) walk(n.children); }); }
    walk(userData.feed_tree);

    for (const feed of feeds) {
        try {
            const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: feed.url }) });
            if (!res.ok) continue;
            const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
            const items = xml.querySelectorAll('item, entry');
            let unread = 0;
            items.forEach(item => {
                const link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href');
                if (link && !userData.read_links.includes(link)) unread++;
            });
            const countEl = document.querySelector(`#sidebar-feed-${safeId(feed.url)} .unread-count`);
            if (countEl && unread > 0) { countEl.innerText = unread; countEl.style.display = 'inline-block'; }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 400));
    }
}

// --- UTILS ---

function getRelativeTime(dateStr) {
    if (!dateStr) return '';
    const then = new Date(dateStr);
    if (isNaN(then)) return '';
    const diff = Math.floor((new Date() - then) / 1000); 
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min. ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hours ago';
    return then.toLocaleDateString();
}

function calculateReadingTime(text) {
    const words = (text || '').replace(/<[^>]*>?/gm, '').trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 225));
}

// --- FEED LOADING ---

async function loadFeedPosts(url, feedName = '') {
    const container = document.getElementById('posts-container');
    container.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><div>Lade Artikel...</div></div>';
    
    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
        const items = xml.querySelectorAll('item, entry');
        container.innerHTML = `<div class="feed-header">${feedName || 'Feed'}</div>`;
        
        items.forEach(item => {
            const title = item.querySelector('title')?.textContent || 'Kein Titel';
            let link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || '#';
            const desc = item.querySelector('description, summary, media\\:description')?.textContent || '';
            const encoded = item.querySelector('encoded')?.textContent || '';
            const pubDate = item.querySelector('pubDate, published, updated, dc\\:date')?.textContent || '';
            let thumbnail = '';
            const ytId = item.querySelector('yt\\:videoId, videoId')?.textContent || '';
            if (ytId) thumbnail = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
            const row = document.createElement('div'); row.className = 'post-row';
            const isRead = userData.read_links.includes(link);
            if (isRead) row.style.opacity = '0.5';
            row.innerHTML = `<div class="post-thumbnail" style="${thumbnail ? `background-image:url('${thumbnail}')` : ''}; background-size:cover; background-position:center;">${!thumbnail ? '📰' : ''}</div><div class="post-info"><div class="post-title" style="${isRead ? 'font-weight:normal' : 'font-weight:600'}">${title}</div><div class="post-meta"><span>${getRelativeTime(pubDate)}</span><span style="margin-left:auto; color:#555;">(${calculateReadingTime(desc+encoded)} min read)</span></div></div><div class="post-actions"><button class="action-btn fav-btn">☆</button><button class="action-btn">👓</button></div>`;
            row.onclick = () => openReader({title, link, desc: desc+encoded, thumbnail});
            container.appendChild(row);
        });
    } catch (e) { container.innerHTML = `<div style="padding:20px; color:red;">${e.message}</div>`; }
}

async function openReader(post) {
    const overlay = document.getElementById('reader-overlay');
    const body = document.getElementById('reader-body');
    overlay.style.display = 'block'; document.body.style.overflow = 'hidden';
    body.innerHTML = '<div class="spinner"></div>';
    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: post.link }) });
        const reader = new Readability(new DOMParser().parseFromString(await res.text(), "text/html")).parse();
        if (reader) {
            body.innerHTML = `<h1 style="color:#ff9800;">${reader.title}</h1><div style="font-size:16px; line-height:1.7; color:#eee;">${reader.content}</div>`;
        }
    } catch (e) { body.innerHTML = `Fehler: ${e.message}`; }
}

function closeReader() { document.getElementById('reader-overlay').style.display = 'none'; document.body.style.overflow = 'auto'; }
window.onkeydown = (e) => { if (e.key === 'Escape') closeReader(); };
window.onload = init;
