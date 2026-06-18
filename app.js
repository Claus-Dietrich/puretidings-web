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

    // Search Support
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.oninput = (e) => handleSearch(e.target.value);
    }
}

function handleSearch(query) {
    const q = query.toLowerCase().trim();
    const rows = document.querySelectorAll('.post-row');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(q) ? 'flex' : 'none';
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
        <div id="feed-list-items" style="padding-bottom: 20px;"></div>
    `;
    
    const list = document.getElementById('feed-list-items');
    
    function walk(nodes, parentEl, level = 0) {
        nodes.forEach(n => {
            const li = document.createElement('div');
            li.style.padding = `6px 15px 6px ${20 + (level * 15)}px`;
            li.style.cursor = 'pointer';
            li.style.fontSize = '13px';
            li.style.color = '#ccc';
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.className = 'sidebar-item-row';

            if (n.type === 'folder') {
                li.innerHTML = `<span class="folder-toggle" style="margin-right:8px; width:12px; font-family:monospace; opacity:0.5;">▼</span> <span style="font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#888;">${n.name.toUpperCase()}</span>`;
                li.onclick = (e) => {
                    const toggle = li.querySelector('.folder-toggle');
                    const childrenContainer = li.nextElementSibling;
                    const isHidden = childrenContainer.style.display === 'none';
                    childrenContainer.style.display = isHidden ? 'block' : 'none';
                    toggle.innerText = isHidden ? '▼' : '▶';
                    e.stopPropagation();
                };
                parentEl.appendChild(li);
                
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children';
                parentEl.appendChild(childrenContainer);
                walk(n.children || [], childrenContainer, level + 1);
            } else if (n.type === 'feed' && n.url) {
                const id = safeId(n.url);
                li.id = `sidebar-feed-${id}`;
                const favicon = `https://www.google.com/s2/favicons?sz=32&domain=${new URL(n.url).hostname}`;
                li.innerHTML = `<img src="${favicon}" style="width:16px; height:16px; margin-right:10px; border-radius:2px; opacity:0.8;" onerror="this.src='128.png'"> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${n.name}</span><span class="unread-count" style="font-size:10px; background:#4a90e2; color:white; padding:1px 6px; border-radius:10px; margin-left:5px; display:none;">0</span>`;
                li.onclick = () => loadFeedPosts(n.url, n.name);
                parentEl.appendChild(li);
            }
        });
    }
    walk(tree, list);
}

function showView(view) {
    if (view === 'all') {
        // Todo: Implement All Posts view
        alert('All Posts View wird noch implementiert');
    } else if (view === 'favorites') {
        // Todo: Implement Favorites view
        alert('Favorites View wird noch implementiert');
    }
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
            
            // --- Erweiterte Thumbnail Extraktion ---
            let thumbnail = '';
            
            // 1. YouTube
            const ytId = item.querySelector('yt\\:videoId, videoId')?.textContent || '';
            if (ytId) thumbnail = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
            
            // 2. Media Tags (media:content, media:thumbnail)
            if (!thumbnail) {
                const mediaContent = item.getElementsByTagName('media:content')[0] || item.getElementsByTagName('content')[0];
                if (mediaContent && mediaContent.getAttribute('url')) {
                    thumbnail = mediaContent.getAttribute('url');
                } else {
                    const mediaThumb = item.getElementsByTagName('media:thumbnail')[0] || item.getElementsByTagName('thumbnail')[0];
                    if (mediaThumb && mediaThumb.getAttribute('url')) thumbnail = mediaThumb.getAttribute('url');
                }
            }
            
            // 3. Enclosure (für Podcasts oder einige RSS Feeds)
            if (!thumbnail) {
                const enclosure = item.querySelector('enclosure[type^="image/"]');
                if (enclosure) thumbnail = enclosure.getAttribute('url');
            }
            
            // 4. Extraktion aus dem Content/Beschreibung (Regex Suche nach <img>)
            if (!thumbnail) {
                const fullText = desc + encoded;
                const imgMatch = fullText.match(/<img[^>]+src="([^">]+)"/i);
                if (imgMatch && imgMatch[1]) thumbnail = imgMatch[1];
            }

            const row = document.createElement('div'); row.className = 'post-row';
            const isRead = userData.read_links.includes(link);
            const isFav = userData.favorited_links.includes(link);
            if (isRead) row.style.opacity = '0.5';
            
            row.innerHTML = `
                <div class="post-thumbnail" style="${thumbnail ? `background-image:url('${thumbnail}')` : ''}; background-size:cover; background-position:center;">${!thumbnail ? '📰' : ''}</div>
                <div class="post-info">
                    <a href="${link}" target="_blank" class="post-title" style="${isRead ? 'font-weight:normal' : 'font-weight:600'}; text-decoration:none; color:inherit;" onclick="markAsRead('${link}'); event.stopPropagation();">
                        ${title}
                    </a>
                    <div class="post-meta">
                        <span>${getRelativeTime(pubDate)}</span>
                        <span style="margin-left:auto; color:#555;">(${calculateReadingTime(desc+encoded)} min read)</span>
                    </div>
                </div>
                <div class="post-actions" style="display:flex; gap:5px;">
                    <button class="action-btn fav-btn" title="Zu Favoriten hinzufügen/entfernen" style="color:${isFav ? 'gold' : 'white'} !important">${isFav ? '★' : '☆'}</button>
                    <button class="action-btn reader-btn" title="Im Reader-Modus lesen">👓</button>
                    <a href="${link}" target="_blank" class="action-btn" title="Original-Seite öffnen" style="text-decoration:none;" onclick="markAsRead('${link}'); event.stopPropagation();">🔗</a>
                </div>
            `;
            
            row.querySelector('.fav-btn').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                toggleFavorite(link, row.querySelector('.fav-btn'));
            };

            row.querySelector('.reader-btn').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                openReader({title, link, desc: desc+encoded, thumbnail});
            };

            container.appendChild(row);
        });
    } catch (e) { container.innerHTML = `<div style="padding:20px; color:red;">${e.message}</div>`; }
}

async function toggleFavorite(link, btn) {
    const isFav = userData.favorited_links.includes(link);
    if (isFav) {
        userData.favorited_links = userData.favorited_links.filter(l => l !== link);
        btn.innerText = '☆';
        btn.style.color = 'white !important';
    } else {
        userData.favorited_links.push(link);
        btn.innerText = '★';
        btn.style.color = 'gold !important';
    }

    try {
        await db.from('user_settings')
            .update({ favorited_links: userData.favorited_links })
            .eq('id', currentUser.id);
    } catch (e) { console.error("Sync Favorite Error:", e); }
}

async function openReader(post) {
    const overlay = document.getElementById('reader-overlay');
    const body = document.getElementById('reader-body');
    overlay.style.display = 'block'; document.body.style.overflow = 'hidden';
    
    const isYouTube = post.link.includes('youtube.com') || post.link.includes('youtu.be');

    // Header mit Thumbnail und Original-Link
    body.innerHTML = `
        <div style="display:flex; gap:20px; align-items:flex-start; margin-bottom:30px; border-bottom:1px solid #333; padding-bottom:20px;">
            ${post.thumbnail ? `<img src="${post.thumbnail}" style="width:120px; height:80px; object-fit:cover; border-radius:8px; border:1px solid #444;">` : ''}
            <div style="flex:1;">
                <h1 style="color:#ff9800; margin:0 0 10px 0; font-size:24px;">${post.title}</h1>
                <a href="${post.link}" target="_blank" style="color:#4a90e2; font-size:13px; text-decoration:none; display:flex; align-items:center; gap:5px;" title="Original-Seite öffnen">
                    <span>${post.link}</span> 🔗
                </a>
            </div>
        </div>
        <div id="reader-inner-content">
            <div class="spinner"></div>
        </div>
    `;
    
    markAsRead(post.link);

    const innerContent = body.querySelector('#reader-inner-content');

    // YouTube Sonderbehandlung: Kein Fetch nötig, wir zeigen direkt das Vorschaubild/Embed-Ersatz
    if (isYouTube) {
        let ytId = '';
        try {
            const url = new URL(post.link);
            if (url.hostname.includes('youtu.be')) ytId = url.pathname.substring(1);
            else ytId = url.searchParams.get('v') || url.pathname.split('/').pop();
        } catch(e) {}
        
        if (ytId) {
            innerContent.innerHTML = `
                <div style="margin:20px 0; position:relative; cursor:pointer;" onclick="window.open('https://www.youtube.com/watch?v=${ytId}', '_blank')">
                    <img src="https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg" style="width:100%; border-radius:8px; border:1px solid #333;" onerror="this.src='https://i.ytimg.com/vi/${ytId}/mqdefault.jpg'">
                    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.7); width:80px; height:80px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:40px; border:2px solid white;">▶</div>
                </div>
                <p style="text-align:center; color:#888; font-size:14px;">Klicke auf das Vorschaubild, um das Video auf YouTube zu starten.</p>
            `;
            return;
        }
    }

    try {
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: post.link }) });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        
        const base = doc.createElement('base');
        base.href = post.link;
        doc.head.appendChild(base);

        const reader = new Readability(doc).parse();
        if (reader) {
            let content = reader.content;
            content = sanitizeReaderContent(content);
            innerContent.innerHTML = `<div style="font-size:16px; line-height:1.7; color:#eee;">${content}</div>`;
        }
    } catch (e) { innerContent.innerHTML = `<div style="color:red; margin-top:20px;">Fehler beim Laden des Inhalts: ${e.message}</div>`; }
}

function sanitizeReaderContent(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    // 1. YouTube Iframe zu Thumbnail Filter (Vermeidet Error 153)
    const iframes = div.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    iframes.forEach(ifr => {
        let ytId = '';
        try {
            const url = new URL(ifr.src);
            if (url.hostname.includes('youtu.be')) ytId = url.pathname.substring(1);
            else ytId = url.searchParams.get('v') || url.pathname.split('/').pop();
        } catch(e) {}
        
        if (ytId) {
            const container = document.createElement('div');
            container.style.margin = '20px 0';
            container.style.position = 'relative';
            container.style.cursor = 'pointer';
            container.innerHTML = `
                <img src="https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg" style="width:100%; border-radius:8px; border:1px solid #333;" onerror="this.src='https://i.ytimg.com/vi/${ytId}/mqdefault.jpg'">
                <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.7); width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:30px; border:2px solid white;">▶</div>
            `;
            container.onclick = () => window.open(`https://www.youtube.com/watch?v=${ytId}`, '_blank');
            ifr.replaceWith(container);
        }
    });

    // 2. Responsive Images
    div.querySelectorAll('img').forEach(img => {
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.borderRadius = '8px';
        img.style.margin = '15px 0';
    });

    return div.innerHTML;
}

async function markAsRead(link) {
    if (!userData.read_links.includes(link)) {
        userData.read_links.push(link);
        
        // 1. UI Update in der Liste: Fade Row
        const rows = document.querySelectorAll('.post-row');
        rows.forEach(row => {
            if (row.innerHTML.includes(link)) {
                row.style.opacity = '0.5';
                const title = row.querySelector('.post-title');
                if (title) title.style.fontWeight = 'normal';
            }
        });

        // 2. Echtzeit-Counter Dekrementierung in der Sidebar
        const activeFeedRow = document.querySelector('.sidebar-item-row[style*="background"]'); // Naive Suche nach dem aktiven Feed
        const countEl = activeFeedRow ? activeFeedRow.querySelector('.unread-count') : null;
        if (countEl) {
            let count = parseInt(countEl.innerText) || 0;
            if (count > 0) {
                count--;
                countEl.innerText = count;
                if (count === 0) countEl.style.display = 'none';
            }
        }

        // Sync to Supabase
        try {
            await db.from('user_settings')
                .update({ read_links: userData.read_links })
                .eq('id', currentUser.id);
        } catch (e) { console.error("Sync Read Status Error:", e); }
    }
}

function closeReader() { document.getElementById('reader-overlay').style.display = 'none'; document.body.style.overflow = 'auto'; }
window.onkeydown = (e) => { if (e.key === 'Escape') closeReader(); };
window.onload = init;
