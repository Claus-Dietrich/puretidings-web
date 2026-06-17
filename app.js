// PureTidings Web - Bulletproof High-Performance Launcher
const SUPABASE_URL = 'https://lujvogyndoryofuffntr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1anZvZ3luZG9yeW9mdWZmbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzI3ODYsImV4cCI6MjA5NzAwODc4Nn0.UEEN01ZKzcdkbP5ktOm35UgWwYQbbwTkM4K0u9_b09w';

let db;
let currentUser = null;
let userData = { feed_tree: [], favorited_links: [], read_links: [], duration_cache: {} };

// --- UI SCHALTER (Zentral & Sicher) ---
function toggleUI(isLoggedIn) {
    const auth = document.getElementById('auth-overlay');
    const app = document.getElementById('app-container');
    console.log("Toggle UI:", isLoggedIn ? "APP" : "AUTH");
    
    if (auth && app) {
        if (isLoggedIn) {
            auth.style.display = 'none';
            app.style.display = 'flex';
        } else {
            auth.style.display = 'flex';
            app.style.display = 'none';
        }
    }
}

// --- INITIALISIERUNG ---
async function init() {
    console.log("🚀 Init gestartet...");
    
    // Failsafe: Wenn nach 4s nichts passiert, Login zeigen
    const failsafe = setTimeout(() => {
        if (!currentUser) toggleUI(false);
    }, 4000);

    // 0. Service Worker Cleanup
    if ('serviceWorker' in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) await r.unregister();
        } catch(e) {}
    }

    if (!window.supabase) {
        console.error("Supabase fehlt!");
        return;
    }

    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Event Listener
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const emailInput = document.getElementById('email-input');
    const passInput = document.getElementById('password-input');

    if (loginBtn) loginBtn.onclick = handleLogin;
    if (logoutBtn) logoutBtn.onclick = handleLogout;
    
    [emailInput, passInput].forEach(el => {
        if (el) el.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };
    });

    // Auth State
    db.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth Event:", event);
        if (session) {
            clearTimeout(failsafe);
            currentUser = session.user;
            toggleUI(true);
            await loadApp(session.user);
        } else {
            currentUser = null;
            toggleUI(false);
        }
    });
}

// --- AUTH AKTIONEN ---
async function handleLogin() {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value;
    if (!email) return alert('E-Mail fehlt');
    
    document.getElementById('auth-status').innerText = "Verarbeite...";
    
    if (password) {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
    } else {
        const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) alert(error.message);
        else alert("Magic Link wurde gesendet!");
    }
}

async function handleLogout() {
    console.log("Logging out...");
    toggleUI(false); // Sofort umschalten für visuelles Feedback
    await db.auth.signOut();
    localStorage.clear();
    location.reload();
}

// --- DATEN & SYNC ---
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
    } catch (e) { console.error("LoadApp Error:", e); }
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

let syncTimer = null;
function sync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
        if (!currentUser) return;
        await db.from('user_settings').update({
            favorited_links: userData.favorited_links,
            read_links: userData.read_links,
            duration_cache: userData.duration_cache
        }).eq('id', currentUser.id);
    }, 1000);
}

function safeId(str) {
    if (!str) return 'id-unknown';
    try { return 'id-' + btoa(unescape(encodeURIComponent(str))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16); }
    catch(e) { return 'id-' + Math.random().toString(36).substr(2, 8); }
}

// --- UI RENDERING ---
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

async function loadFeedPosts(url, feedName = '') {
    const container = document.getElementById('posts-container');
    container.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><div style="color:#888; font-size:14px;">Lade Artikel...</div></div>';
    
    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const txt = await res.text();
        const xml = new DOMParser().parseFromString(txt, "text/xml");
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
            const mediaGroup = item.getElementsByTagName('media:group')[0];
            const ytThumb = mediaGroup?.getElementsByTagName('media:thumbnail')[0]?.getAttribute('url');
            const mediaThumbnail = item.getElementsByTagName('media:thumbnail')[0]?.getAttribute('url');
            const featuredImg = item.querySelector('featured_image')?.textContent;

            if (ytId) thumbnail = ytThumb || `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
            else if (featuredImg) thumbnail = featuredImg;
            else if (mediaThumbnail) thumbnail = mediaThumbnail;
            else { const imgMatch = (desc + encoded).match(/<img[^>]+src=["']([^">']+)["']/i); if (imgMatch) thumbnail = imgMatch[1]; }
            if (thumbnail && !thumbnail.startsWith('http')) try { thumbnail = new URL(thumbnail, new URL(url).origin).href; } catch(e) {}

            const isRead = userData.read_links.includes(link);
            const isFav = userData.favorited_links.includes(link);
            const row = document.createElement('div'); row.className = 'post-row';
            if (isRead) row.style.opacity = '0.5';
            
            row.innerHTML = `
                <div class="post-thumbnail" style="${thumbnail ? `background-image:url('${thumbnail}')` : ''}; background-size:cover; background-position:center;">${!thumbnail ? '📰' : ''}</div>
                <div class="post-info">
                    <div class="post-title" style="${isRead ? 'font-weight:normal' : 'font-weight:600'}">${title}</div>
                    <div class="post-meta"><span>${getRelativeTime(pubDate)}</span><span class="duration-placeholder" style="margin-left:auto; color:#555;"></span></div>
                </div>
                <div class="post-actions">
                    <button class="action-btn fav-btn" style="color:${isFav ? 'gold' : '#fff'} !important;">${isFav ? '⭐' : '☆'}</button>
                    <button class="action-btn reader-trigger">👓</button>
                    <a href="${link}" target="_blank" class="action-btn">🔗</a>
                </div>
            `;
            const postData = { title, link, desc: desc + encoded, ytId, thumbnail, duration: '' };
            const durSpan = row.querySelector('.duration-placeholder');
            if (ytId || link.includes('youtube.com')) fetchYoutubeDuration(link, durSpan, postData);
            else durSpan.innerText = `(${calculateReadingTime(desc+encoded)} min read)`;

            row.querySelector('.post-title').onclick = () => { markAsRead(link); openReader(postData); };
            row.querySelector('.reader-trigger').onclick = () => { markAsRead(link); openReader(postData); };
            row.querySelector('.fav-btn').onclick = (e) => { e.stopPropagation(); toggleFavorite(link); };
            container.appendChild(row);
        });
    } catch (e) { container.innerHTML = `<div style="padding:20px; color:red;">${e.message}</div>`; }
}

// --- WEITERE FUNKTIONEN (Sicherheits-Kopien) ---
async function fetchYoutubeDuration(url, element, postData) {
    if (userData.duration_cache[url]) {
        element.innerText = userData.duration_cache[url];
        postData.duration = userData.duration_cache[url];
        return;
    }
    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const html = await res.text();
        const durationMatch = html.match(/<meta\s+itemprop="duration"\s+content="([^"]+)">/) || html.match(/"approxDurationMs":"(\d+)"/);
        if (durationMatch) {
            const match = durationMatch[1].match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            const seconds = match ? (parseInt(match[1]||0)*3600)+(parseInt(m[2]||0)*60)+parseInt(m[3]||0) : Math.floor(parseInt(durationMatch[1])/1000);
            const formatted = `(${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')})`;
            element.innerText = formatted;
            userData.duration_cache[url] = formatted;
            postData.duration = formatted;
            sync();
        }
    } catch (e) {}
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

async function markAsRead(link) {
    if (!userData.read_links.includes(link)) {
        userData.read_links.push(link);
        sync();
        document.querySelectorAll('.post-row').forEach(row => { if (row.querySelector('a')?.href === link) row.style.opacity = '0.5'; });
    }
}

async function toggleFavorite(link) {
    const idx = userData.favorited_links.indexOf(link);
    if (idx > -1) userData.favorited_links.splice(idx, 1);
    else userData.favorited_links.push(link);
    sync();
    // Re-render aktuelle Ansicht oder nur Button updaten
    const row = Array.from(document.querySelectorAll('.post-row')).find(r => r.querySelector('a')?.href === link);
    if (row) {
        const btn = row.querySelector('.fav-btn');
        const isFav = userData.favorited_links.includes(link);
        btn.innerHTML = isFav ? '⭐' : '☆';
        btn.style.color = isFav ? 'gold !important' : '#fff !important';
    }
}

async function openReader(post) {
    const overlay = document.getElementById('reader-overlay');
    const body = document.getElementById('reader-body');
    overlay.style.display = 'block'; document.body.style.overflow = 'hidden';
    body.innerHTML = '<div class="spinner"></div>';
    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: post.link }) });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const base = doc.createElement('base'); base.href = post.link; doc.head.appendChild(base);
        const reader = new Readability(doc).parse();
        if (reader) {
            body.innerHTML = `<div style="display:flex; gap:20px; align-items:flex-start; margin-bottom:25px; border-bottom:1px solid #333; padding-bottom:20px;"><img src="${post.thumbnail || '128.png'}" style="width:100px; height:70px; object-fit:cover; border-radius:6px; border:1px solid #444; background:#222;"><div style="flex:1;"><h1 style="margin:0 0 8px 0; font-size:22px; color:#ff9800;">${reader.title}</h1><div style="font-size:14px;"><a href="${post.link}" target="_blank" style="color:#4a90e2; text-decoration:underline;">Read Original Article</a><span style="color:#666; margin-left:10px;">(${post.duration || calculateReadingTime(reader.textContent) + ' min read'})</span></div></div></div><div style="font-size:16px; line-height:1.7; color:#eee;">${reader.content}</div>`;
        }
    } catch (e) { body.innerHTML = `<div style="text-align:center; padding:20px;"><div style="color:red; margin-bottom:15px;">Fehler: ${e.message}</div><a href="${post.link}" target="_blank" style="display:inline-block; padding:10px 20px; background:#ff9800; color:white; text-decoration:none; border-radius:6px;">Original öffnen</a></div>`; }
}

function closeReader() { document.getElementById('reader-overlay').style.display = 'none'; document.body.style.overflow = 'auto'; }
window.onkeydown = (e) => { if (e.key === 'Escape') closeReader(); };
function showView(t) { if (t==='favorites') renderFavorites(); else document.getElementById('posts-container').innerHTML = `<div style="padding:40px; text-align:center; color:#888;">Wähle einen Feed aus.</div>`; }
async function renderFavorites() {
    const container = document.getElementById('posts-container');
    container.innerHTML = `<div class="feed-header">⭐ Meine Favoriten</div>`;
    if (userData.favorited_links.length === 0) { container.innerHTML += '<div style="padding:40px; text-align:center; color:#888;">Noch keine Favoriten.</div>'; return; }
    userData.favorited_links.forEach(link => {
        const div = document.createElement('div'); div.className = 'post-row';
        div.innerHTML = `<div class="post-thumbnail">⭐</div><div class="post-info"><div class="post-title">${link}</div></div><div class="post-actions"><button class="action-btn" onclick="toggleFavorite('${link}')">🗑️</button><a href="${link}" target="_blank" class="action-btn">🔗</a></div>`;
        container.appendChild(div);
    });
}

window.onload = init;
