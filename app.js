// PureTidings Web - Bulletproof Persistence Launcher
const SUPABASE_URL = 'https://lujvogyndoryofuffntr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1anZvZ3luZG9yeW9mdWZmbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzI3ODYsImV4cCI6MjA5NzAwODc4Nn0.UEEN01ZKzcdkbP5ktOm35UgWwYQbbwTkM4K0u9_b09w';

let db;
let currentUser = null;
let currentFeedUrl = null;
let currentViewMode = 'feed'; // 'feed', 'all', 'favorites'
const globalPostsCache = {}; // Cache for fetched feed posts

let userData = {
    feed_tree: [],
    favorited_links: [],
    summary_links: [],
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
                summary_links: data.summary_links || [],
                read_links: data.read_links || [],
                duration_cache: data.duration_cache || {}
            };
        }
        
        renderSidebar(userData.feed_tree);
        checkProStatus(data || {});
        showView('all');
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

// --- SIDEBAR RESIZER ---
function setupResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('feed-tree-container');
    
    if (!resizer || !sidebar) return;

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = e.clientX;
        if (newWidth > 150 && newWidth < 800) {
            sidebar.style.width = `${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = 'default';
    });
}

// --- SIDEBAR & COUNTERS ---

function getFeedId(url) {
    if (!url) return 'id-unknown';
    // Normalisierung: Trailing slash entfernen und URL trimmen
    const normalizedUrl = url.trim().replace(/\/$/, '');
    
    // Für YouTube URLs: Nur die Channel ID extrahieren, da Query-Params variieren können
    if (normalizedUrl.includes('youtube.com/feeds')) {
        const match = normalizedUrl.match(/channel_id=([^&]+)/);
        if (match) return 'yt-' + match[1];
    }
    
    // EINZIGARTIGE ID ERZEUGEN: Verwende den Base64 des gesamten Pfades, nicht nur der ersten 16 Zeichen
    try { 
        return 'id-' + btoa(unescape(encodeURIComponent(normalizedUrl))).replace(/[^a-zA-Z0-9]/g, '');
    }
    catch(e) { return 'id-' + Math.random().toString(36).substr(2, 8); }
}

function safeId(str) { return getFeedId(str); }

function parseFeedXML(xmlString) {
    if (!xmlString || xmlString.trim().length === 0) return null;
    const parser = new DOMParser();
    let doc = parser.parseFromString(xmlString, "application/xml");
    
    let parseError = doc.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
        // Strategy 1: Fix attributes without values (e.g. <rss xmlns:itunes>)
        const fixedXml = xmlString.replace(/<([a-zA-Z0-9:]+)([^>]+)>/g, (match, tagName, attrs) => {
            const fixedAttrs = attrs.replace(/(\s+)([a-zA-Z0-9:\._\-]+)(?!\s*=)(?=\s|>|$)/g, '$1$2=""');
            return `<${tagName}${fixedAttrs}>`;
        });
        
        if (fixedXml !== xmlString) {
            doc = parser.parseFromString(fixedXml, "application/xml");
            parseError = doc.getElementsByTagName("parsererror");
        }
        
        // Strategy 2: Fallback to text/html
        if (parseError.length > 0) {
            console.warn("XML parsing failed after fix, trying text/html fallback.");
            doc = parser.parseFromString(xmlString, "text/html");
        }
    }
    return doc;
}

function renderSidebar(tree) {
    const container = document.getElementById('feed-tree-container');
    if (!container) return;
    
    container.innerHTML = `
        <div style="padding:15px 10px;">
            <div id="sidebar-nav-all" onclick="showView('all')" class="sidebar-item" style="padding:8px 10px; cursor:pointer; color:#eee; font-size:13px; display:flex; align-items:center; gap:10px; background:#222; border-radius:6px; margin-bottom:5px;"><span>🏠</span> All Posts</div>
            <div id="sidebar-nav-favorites" onclick="showView('favorites')" class="sidebar-item" style="padding:8px 10px; cursor:pointer; color:#aaa; font-size:13px; display:flex; align-items:center; gap:10px; border-radius:6px; margin-bottom:5px;"><span>⭐</span> Favorites</div>
            <div id="sidebar-nav-summary" onclick="showView('summary')" class="sidebar-item" style="padding:8px 10px; cursor:pointer; color:#aaa; font-size:13px; display:flex; align-items:center; gap:10px; border-radius:6px;"><span>📋</span> Summary List</div>
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
                const id = getFeedId(n.url);
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

function getAllFeeds() {
    const feeds = [];
    function walk(nodes) {
        nodes.forEach(n => {
            if (n.type === 'feed' && n.url) feeds.push(n);
            if (n.children) walk(n.children);
        });
    }
    walk(userData.feed_tree);
    return feeds;
}

async function getFeedPosts(url, feedName = '') {
    try {
        const { data: { session } } = await db.auth.getSession();
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            }, 
            body: JSON.stringify({ url }) 
        });
        const xmlStr = await res.text();
        const xml = parseFeedXML(xmlStr);
        if (!xml) return [];

        const items = xml.querySelectorAll('item, entry');
        const posts = [];
        
        items.forEach(item => {
            const title = item.querySelector('title')?.textContent || 'Kein Titel';
            let link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || '#';
            if ((!link || link === '#') && item.querySelector('link[rel="alternate"]')) {
                link = item.querySelector('link[rel="alternate"]').getAttribute('href');
            }
            const descText = item.querySelector('description, summary, media\\:description')?.textContent || '';
            let encodedText = "";
            const ceNodes = item.getElementsByTagName('content:encoded');
            if (ceNodes.length > 0) {
              encodedText = ceNodes[0].textContent;
            } else {
              const encNodes = item.getElementsByTagName('encoded');
              if (encNodes.length > 0) encodedText = encNodes[0].textContent;
              else {
                const contentNodes = item.getElementsByTagName('content');
                if (contentNodes.length > 0 && !contentNodes[0].getAttribute('url')) encodedText = contentNodes[0].textContent;
              }
            }
            const desc = descText;
            const encoded = encodedText;
            const pubDate = item.querySelector('pubDate, published, updated, dc\\:date')?.textContent || '';
            
            let thumbnail = '';
            const ytId = item.querySelector('yt\\:videoId, videoId')?.textContent || '';
            let durationStr = '';
            
            if (ytId) {
                thumbnail = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
                const cachedDuration = userData.duration_cache[ytId];
                durationStr = cachedDuration ? cachedDuration : 'Video';
            } else {
                let mediaThumbnail = item.querySelector('thumbnail');
                if (!mediaThumbnail) {
                  const mtNodes = item.getElementsByTagName('media:thumbnail');
                  if (mtNodes.length > 0) mediaThumbnail = mtNodes[0];
                }
                if (mediaThumbnail && mediaThumbnail.getAttribute('url')) {
                  thumbnail = mediaThumbnail.getAttribute('url');
                }

                if (!thumbnail) {
                    const mediaContentNodes = item.getElementsByTagName('media:content');
                    for (const node of mediaContentNodes) {
                        const medium = node.getAttribute('medium');
                        const type = node.getAttribute('type');
                        if (medium === 'image' || (type && type.startsWith('image'))) {
                            thumbnail = node.getAttribute('url');
                            if (thumbnail) break;
                        }
                    }
                }

                if (!thumbnail) {
                    const enclosureNodes = item.getElementsByTagName('enclosure');
                    for (const node of enclosureNodes) {
                        const type = node.getAttribute('type');
                        if (type && type.startsWith('image')) {
                            thumbnail = node.getAttribute('url');
                            if (thumbnail) break;
                        }
                    }
                }
                
                if (!thumbnail) {
                    const fullText = desc + encoded;
                    const imgMatches = fullText.matchAll(/<img[^>]+src=["']([^"'>]+)["']/gi);
                    for (const match of imgMatches) {
                        const imgUrl = match[1];
                        if (!imgUrl.includes('1x1') && !imgUrl.includes('tracking') && !imgUrl.endsWith('.gif') && imgUrl.startsWith('http')) {
                            thumbnail = imgUrl;
                            break;
                        }
                    }
                }
                durationStr = `${calculateReadingTime(desc+encoded)} min read`;
            }

            posts.push({
                title,
                link,
                desc: desc + encoded,
                thumbnail,
                pubDate,
                durationStr,
                feedName,
                feedUrl: url
            });
        });
        
        globalPostsCache[url] = posts;
        return posts;
    } catch (e) {
        console.error("Error fetching feed:", url, e);
        return [];
    }
}

async function showView(view) {
    currentViewMode = view;
    currentFeedUrl = null;

    // Reset background and color for top items and feed items
    document.querySelectorAll('.sidebar-item-row').forEach(el => el.style.background = 'transparent');
    
    const allBtn = document.getElementById('sidebar-nav-all');
    const favBtn = document.getElementById('sidebar-nav-favorites');
    const sumBtn = document.getElementById('sidebar-nav-summary');
    
    if (allBtn) {
        allBtn.style.background = (view === 'all') ? '#2c2c2c' : 'transparent';
        allBtn.style.color = (view === 'all') ? '#eee' : '#aaa';
    }
    if (favBtn) {
        favBtn.style.background = (view === 'favorites') ? '#2c2c2c' : 'transparent';
        favBtn.style.color = (view === 'favorites') ? '#eee' : '#aaa';
    }
    if (sumBtn) {
        sumBtn.style.background = (view === 'summary') ? '#2c2c2c' : 'transparent';
        sumBtn.style.color = (view === 'summary') ? '#eee' : '#aaa';
    }
    
    const container = document.getElementById('posts-container');
    container.innerHTML = `<div style="padding:40px; text-align:center;"><div class="spinner"></div><div>Lade ${view === 'all' ? 'alle' : (view === 'favorites' ? 'Favoriten-' : 'Zusammenfassungs-')} Artikel...</div></div>`;
    
    const feeds = getAllFeeds();
    if (feeds.length === 0) {
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">Keine Feeds abonniert.</div>';
        return;
    }

    try {
        const promises = feeds.map(feed => getFeedPosts(feed.url, feed.name));
        const results = await Promise.all(promises);
        
        let allPosts = results.flat();
        
        if (view === 'all') {
            allPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            renderPostsList(allPosts, "All Posts");
        } else if (view === 'favorites') {
            const favPosts = allPosts.filter(post => userData.favorited_links.includes(post.link));
            favPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            
            // Add archived favorites that are no longer in XML feeds
            const foundFavLinks = favPosts.map(p => p.link);
            const missingFavLinks = userData.favorited_links.filter(link => !foundFavLinks.includes(link));
            
            missingFavLinks.forEach(link => {
                favPosts.push({
                    title: link,
                    link: link,
                    desc: "Older favorite. Link is saved, but full text is not in current feed feeds.",
                    thumbnail: "",
                    pubDate: "",
                    durationStr: "Unknown",
                    feedName: "Archived Favorite",
                    feedUrl: null
                });
            });

            renderPostsList(favPosts, "Favorites");
        } else if (view === 'summary') {
            const sumPosts = allPosts.filter(post => userData.summary_links.includes(post.link));
            sumPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            
            // Add archived summary items that are no longer in XML feeds
            const foundSumLinks = sumPosts.map(p => p.link);
            const missingSumLinks = userData.summary_links.filter(link => !foundSumLinks.includes(link));
            
            missingSumLinks.forEach(link => {
                sumPosts.push({
                    title: link,
                    link: link,
                    desc: "Older summary item. Link is saved, but full text is not in current feed feeds.",
                    thumbnail: "",
                    pubDate: "",
                    durationStr: "Unknown",
                    feedName: "Archived Summary Item",
                    feedUrl: null
                });
            });

            renderPostsList(sumPosts, "Summary List");
        }
    } catch (e) {
        container.innerHTML = `<div style="padding:20px; color:red;">Fehler beim Laden: ${e.message}</div>`;
    }
}

async function calculateAllUnreadCounts() {
    const feeds = [];
    function walk(nodes) { nodes.forEach(n => { if (n.type === 'feed' && n.url) feeds.push(n); if (n.children) walk(n.children); }); }
    walk(userData.feed_tree);

    // Warten, bis die Sidebar sicher gerendert ist
    await new Promise(r => setTimeout(r, 500)); 

    for (const feed of feeds) {
        try {
            const { data: { session } } = await db.auth.getSession();
            const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                }, 
                body: JSON.stringify({ url: feed.url }) 
            });
            if (!res.ok) continue;
            const xmlStr = await res.text();
            const xml = parseFeedXML(xmlStr);
            if (!xml) continue;

            const items = xml.querySelectorAll('item, entry');
            
            let unread = 0;
            items.forEach(item => {
                let link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || item.getAttribute('href');
                if (!link || link === '') {
                    const altLink = item.querySelector('link[rel="alternate"]');
                    if (altLink) link = altLink.getAttribute('href');
                }
                
                // Nur Posts zählen, die im aktuellen XML-Feed enthalten sind und noch nicht gelesen wurden
                if (link && !userData.read_links.includes(link)) {
                    unread++;
                }
            });
            
            console.log(`Feed ${feed.name} (${feed.url}) hat ${items.length} Items im Feed und ${unread} davon sind ungelesen.`);
            
            const id = safeId(feed.url);
            const countEl = document.querySelector(`#sidebar-feed-${id} .unread-count`);
            if (countEl) {
                if (unread > 0) {
                    countEl.innerText = unread;
                    countEl.style.setProperty('display', 'inline-block', 'important');
                    countEl.style.backgroundColor = '#4a90e2';
                } else {
                    countEl.style.display = 'none';
                }
            }
        } catch (e) { console.error("Error counting unread for", feed.url, e); }
        await new Promise(r => setTimeout(r, 150));
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
    const days = Math.floor(diff / 86400);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    const months = Math.floor(days / 30);
    if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');
    return then.toLocaleDateString();
}

function calculateReadingTime(text) {
    const words = (text || '').replace(/<[^>]*>?/gm, '').trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 225));
}

// --- FEED LOADING ---

async function loadFeedPosts(url, feedName = '') {
    currentFeedUrl = url;
    currentViewMode = 'feed';

    const container = document.getElementById('posts-container');
    container.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><div>Lade Artikel...</div></div>';
    
    // UI Feedback in Sidebar
    document.querySelectorAll('.sidebar-item-row').forEach(el => el.style.background = 'transparent');
    const activeRow = document.getElementById(`sidebar-feed-${safeId(url)}`);
    if (activeRow) activeRow.style.background = '#2c2c2c';

    const allBtn = document.getElementById('sidebar-nav-all');
    const favBtn = document.getElementById('sidebar-nav-favorites');
    const sumBtn = document.getElementById('sidebar-nav-summary');
    if (allBtn) { allBtn.style.background = 'transparent'; allBtn.style.color = '#aaa'; }
    if (favBtn) { favBtn.style.background = 'transparent'; favBtn.style.color = '#aaa'; }
    if (sumBtn) { sumBtn.style.background = 'transparent'; sumBtn.style.color = '#aaa'; }

    try {
        const posts = await getFeedPosts(url, feedName);
        renderPostsList(posts, feedName, url);
    } catch (e) { 
        container.innerHTML = `<div style="padding:20px; color:red;">${e.message}</div>`; 
    }
}

function renderPostsList(posts, headerTitle, feedUrl = null) {
    const container = document.getElementById('posts-container');
    if (!container) return;

    if (currentViewMode === 'summary') {
        let toolbarHtml = `
            <div class="feed-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span>${headerTitle}</span>
            </div>
            <div class="summary-toolbar" style="padding:15px; background:#1e1e1e; border-bottom:1px solid #333; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                <button class="action-btn" id="web-copy-summary" title="Links in die Zwischenablage kopieren" style="width:auto; padding:5px 15px; font-size:12px; height:auto;">Kopieren 📋</button>
                <button class="action-btn" id="web-clear-summary" title="Zusammenfassungsliste leeren" style="width:auto; padding:5px 15px; font-size:12px; height:auto; background:#d93025; border-color:#d93025;">Liste leeren 🗑</button>
                
                <div style="border-left:1px solid #333; height:20px; margin:0 5px;"></div>
                
                <input type="password" id="web-gemini-key" placeholder="Gemini API Key" style="background:#2c2c2c; border:1px solid #444; color:white; padding:5px 10px; border-radius:4px; font-size:12px; width:180px;" />
                <button class="action-btn" id="web-ai-report" title="KI-Zusammenfassung generieren" style="width:auto; padding:5px 15px; font-size:12px; height:auto; background:#ff9800; border-color:#ff9800;">Zusammenfassen 🤖</button>
            </div>
            <div id="summary-ai-output" style="display:none; padding:15px 15px 0 15px;"></div>
        `;
        
        container.innerHTML = toolbarHtml;
        
        const keyInput = document.getElementById('web-gemini-key');
        if (keyInput) {
            keyInput.value = localStorage.getItem('gemini_api_key') || '';
            keyInput.onchange = (e) => {
                localStorage.setItem('gemini_api_key', e.target.value.trim());
            };
        }
        
        document.getElementById('web-copy-summary').onclick = copySummaryLinks;
        document.getElementById('web-clear-summary').onclick = clearSummaryList;
        document.getElementById('web-ai-report').onclick = generateAiSummary;
        
        if (!posts || posts.length === 0) {
            const noPostsDiv = document.createElement('div');
            noPostsDiv.style.cssText = "padding:40px; text-align:center; color:#888;";
            noPostsDiv.innerText = "Keine Artikel in der Zusammenfassungsliste.";
            container.appendChild(noPostsDiv);
            return;
        }
    } else {
        if (!posts || posts.length === 0) {
            container.innerHTML = `
                <div class="feed-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>${headerTitle}</span>
                </div>
                <div style="padding:40px; text-align:center; color:#888;">Keine Artikel gefunden.</div>
            `;
            return;
        }

        let headerHtml = `<div class="feed-header" style="display:flex; justify-content:space-between; align-items:center;">
            <span>${headerTitle}</span>`;
        
        if (feedUrl) {
            headerHtml += `
            <div style="display:flex; gap:10px;">
                <button class="action-btn" title="Ganzen Feed als gelesen markieren" onclick="markFeedAsRead('${feedUrl}')" style="font-size:12px; width:auto; padding:2px 8px; height:24px;">Alle gelesen ✔</button>
                <button class="action-btn" title="Ganzen Feed als ungelesen markieren" onclick="markFeedAsUnread('${feedUrl}')" style="font-size:12px; width:auto; padding:2px 8px; height:24px;">Alle ungelesen ↩</button>
            </div>`;
        }
        headerHtml += `</div>`;
        container.innerHTML = headerHtml;
    }

    posts.forEach(post => {
        const { title, link, desc, thumbnail, pubDate, durationStr, feedName } = post;
        const row = document.createElement('div'); 
        row.className = 'post-row';
        row.dataset.link = link;
        const isRead = userData.read_links.includes(link);
        const isFav = userData.favorited_links.includes(link);
        const isSum = userData.summary_links && userData.summary_links.includes(link);
        if (isRead) row.style.opacity = '0.5';
        
        row.innerHTML = `
            <a href="${link}" target="_blank" style="text-decoration:none;" onclick="markAsRead('${link}'); event.stopPropagation();">
                <div class="post-thumbnail" style="${thumbnail ? `background-image:url('${thumbnail}')` : ''}; background-size:cover; background-position:center;">${!thumbnail ? '📰' : ''}</div>
            </a>
            <div class="post-info">
                <a href="${link}" target="_blank" class="post-title" style="${isRead ? 'font-weight:normal' : 'font-weight:600'}; text-decoration:none; color:inherit;" onclick="markAsRead('${link}'); event.stopPropagation();">
                    ${title}
                </a>
                <div class="post-meta">
                    <span>${getRelativeTime(pubDate)}${feedName ? ` • ${feedName}` : ''}</span>
                    <span style="margin-left:auto; color:#555;">(${durationStr})</span>
                </div>
            </div>
            <div class="post-actions" style="display:flex; gap:5px;">
                <button class="action-btn fav-btn" title="Favorit" style="color:${isFav ? 'gold' : 'white'} !important">${isFav ? '★' : '☆'}</button>
                <button class="action-btn sum-btn" title="Zur Summary Liste hinzufügen" style="border:none; background:none; cursor:pointer; font-size:18px; filter:${isSum ? 'sepia(1) saturate(5) hue-rotate(90deg)' : 'grayscale(1)'} !important;">📋</button>
                <button class="action-btn reader-btn" title="Reader">👓</button>
                <button class="action-btn unread-btn" title="Als ungelesen markieren" style="display:${isRead ? 'flex' : 'none'}">↩</button>
                <a href="${link}" target="_blank" class="action-btn" title="Original" style="text-decoration:none;" onclick="markAsRead('${link}'); event.stopPropagation();">🔗</a>
            </div>
        `;
        
        row.querySelector('.fav-btn').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            toggleFavorite(link, row.querySelector('.fav-btn'));
        };
        row.querySelector('.sum-btn').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            toggleSummary(link, row.querySelector('.sum-btn'));
        };
        row.querySelector('.reader-btn').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            openReader({title, link, desc, thumbnail});
        };
        row.querySelector('.unread-btn').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            markAsUnread(link, row);
        };

        container.appendChild(row);
    });
}

async function markFeedAsUnread(feedUrl) {
    const rows = document.querySelectorAll('.post-row');
    let changed = false;
    let unreadCountAdded = 0;
    
    rows.forEach(row => {
        const link = row.dataset.link;
        if (link && userData.read_links.includes(link)) {
            userData.read_links = userData.read_links.filter(l => l !== link);
            row.style.opacity = '1';
            row.querySelector('.post-title').style.fontWeight = '600';
            row.querySelector('.unread-btn').style.display = 'none';
            changed = true;
            unreadCountAdded++;
        }
    });

    if (changed) {
        const countEl = document.querySelector(`#sidebar-feed-${safeId(feedUrl)} .unread-count`);
        if (countEl) {
            countEl.innerText = unreadCountAdded;
            countEl.style.setProperty('display', 'inline-block', 'important');
            countEl.style.backgroundColor = '#4a90e2';
        }

        try {
            await db.from('user_settings').update({ read_links: userData.read_links }).eq('id', currentUser.id);
        } catch (e) { console.error("Sync Mark Feed As Unread Error:", e); }
    }
}

async function markFeedAsRead(feedUrl) {
    const rows = document.querySelectorAll('.post-row');
    let changed = false;
    rows.forEach(row => {
        const link = row.dataset.link;
        if (link && !userData.read_links.includes(link)) {
            userData.read_links.push(link);
            row.style.opacity = '0.5';
            row.querySelector('.post-title').style.fontWeight = 'normal';
            row.querySelector('.unread-btn').style.display = 'flex';
            changed = true;
        }
    });

    if (changed) {
        const countEl = document.querySelector(`#sidebar-feed-${safeId(feedUrl)} .unread-count`);
        if (countEl) countEl.style.display = 'none';

        try {
            await db.from('user_settings').update({ read_links: userData.read_links }).eq('id', currentUser.id);
        } catch (e) { console.error("Sync Mark Feed As Read Error:", e); }
    }
}

async function markAsUnread(link, row) {
    userData.read_links = userData.read_links.filter(l => l !== link);
    row.style.opacity = '1';
    row.querySelector('.post-title').style.fontWeight = '600';
    row.querySelector('.unread-btn').style.display = 'none';

    if (currentFeedUrl) {
        const countEl = document.querySelector(`#sidebar-feed-${safeId(currentFeedUrl)} .unread-count`);
        if (countEl) {
            let count = parseInt(countEl.innerText) || 0;
            countEl.innerText = count + 1;
            countEl.style.display = 'inline-block';
        }
    }

    try {
        await db.from('user_settings').update({ read_links: userData.read_links }).eq('id', currentUser.id);
    } catch (e) { console.error("Sync Mark As Unread Error:", e); }
}

async function markAsRead(link) {
    if (!userData.read_links.includes(link)) {
        userData.read_links.push(link);
        
        const rows = document.querySelectorAll('.post-row');
        rows.forEach(row => {
            if (row.dataset.link === link) {
                row.style.opacity = '0.5';
                const title = row.querySelector('.post-title');
                if (title) title.style.fontWeight = 'normal';
                const unreadBtn = row.querySelector('.unread-btn');
                if (unreadBtn) unreadBtn.style.display = 'flex';
            }
        });

        if (currentFeedUrl) {
            const countEl = document.querySelector(`#sidebar-feed-${safeId(currentFeedUrl)} .unread-count`);
            if (countEl) {
                let count = parseInt(countEl.innerText) || 0;
                if (count > 0) {
                    count--;
                    countEl.innerText = count;
                    if (count === 0) countEl.style.display = 'none';
                }
            }
        }

        try {
            await db.from('user_settings').update({ read_links: userData.read_links }).eq('id', currentUser.id);
        } catch (e) { console.error("Sync Read Status Error:", e); }
    }
}

async function toggleFavorite(link, btn) {
    const isFav = userData.favorited_links.includes(link);
    if (isFav) {
        userData.favorited_links = userData.favorited_links.filter(l => l !== link);
        btn.innerText = '☆';
        btn.style.setProperty('color', 'white', 'important');
        
        if (currentViewMode === 'favorites') {
            const row = btn.closest('.post-row');
            if (row) {
                row.style.transition = 'opacity 0.3s, max-height 0.3s';
                row.style.opacity = '0';
                setTimeout(() => { row.remove(); }, 300);
            }
        }
    } else {
        userData.favorited_links.push(link);
        btn.innerText = '★';
        btn.style.setProperty('color', 'gold', 'important');
    }

    try {
        await db.from('user_settings')
            .update({ favorited_links: userData.favorited_links })
            .eq('id', currentUser.id);
    } catch (e) { console.error("Sync Favorite Error:", e); }
}

async function toggleSummary(link, btn) {
    if (!userData.summary_links) userData.summary_links = [];
    const isSum = userData.summary_links.includes(link);
    if (isSum) {
        userData.summary_links = userData.summary_links.filter(l => l !== link);
        btn.style.setProperty('filter', 'grayscale(1)', 'important');
        
        if (currentViewMode === 'summary') {
            const row = btn.closest('.post-row');
            if (row) {
                row.style.transition = 'opacity 0.3s, max-height 0.3s';
                row.style.opacity = '0';
                setTimeout(() => { row.remove(); }, 300);
            }
        }
    } else {
        userData.summary_links.push(link);
        btn.style.setProperty('filter', 'sepia(1) saturate(5) hue-rotate(90deg)', 'important');
    }

    try {
        await db.from('user_settings')
            .update({ summary_links: userData.summary_links })
            .eq('id', currentUser.id);
    } catch (e) { console.error("Sync Summary Error:", e); }
}

async function getAvailableGeminiModels(apiKey) {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.models) {
            const supportedModels = data.models
                .filter(model => {
                    return model.name.includes('gemini') && 
                           (model.supportedGenerationMethods.includes('generateContent') || 
                            model.supportedGenerationMethods.includes('generateText'));
                })
                .map(model => model.name.split('/').pop());
            
            if (supportedModels.length > 0) {
                supportedModels.sort((a, b) => {
                    if (a.includes('flash') && !b.includes('flash')) return -1;
                    if (!a.includes('flash') && b.includes('flash')) return 1;
                    return 0;
                });
            }
            return supportedModels;
        } else {
            return ['gemini-1.5-flash-latest', 'gemini-pro-latest'];
        }
    } catch (error) {
        console.error('Failed to fetch available models, using fallback list:', error);
        return ['gemini-1.5-flash-latest', 'gemini-pro-latest'];
    }
}

async function generateAiSummary() {
    const outputContainer = document.getElementById('summary-ai-output');
    if (!outputContainer) return;
    
    const geminiApiKey = localStorage.getItem('gemini_api_key') || '';
    if (!geminiApiKey || geminiApiKey.trim() === '') {
        alert("Bitte gib zuerst einen gültigen Google Gemini API Key in das Textfeld ein.");
        return;
    }
    
    const rows = document.querySelectorAll('.post-row');
    const postsToSummarize = [];
    rows.forEach(row => {
        const titleEl = row.querySelector('.post-title');
        const link = row.dataset.link;
        if (titleEl && link) {
            postsToSummarize.push({
                title: titleEl.innerText.trim(),
                link: link,
                description: row.querySelector('.post-meta')?.innerText || ''
            });
        }
    });
    
    if (postsToSummarize.length === 0) {
        alert("Deine Zusammenfassungsliste ist leer.");
        return;
    }
    
    outputContainer.innerHTML = `
        <div style="background:#1e1e1e; border:1px solid #ff9800; border-radius:8px; padding:20px; margin-bottom:20px; text-align:center;">
            <div class="spinner"></div>
            <div style="margin-top:10px; color:#ff9800; font-weight:bold;">Zusammenfassung wird über Gemini generiert...</div>
        </div>
    `;
    outputContainer.style.display = 'block';
    
    try {
        let promptText = "Create a coherent, well-structured summary report in Markdown format based on the following articles. Group related topics if applicable, and highlight the most important takeaways. Use German language for the summary:\n\n";
        
        postsToSummarize.forEach((post, index) => {
            promptText += `### Article ${index + 1}: ${post.title}\n`;
            promptText += `Link: ${post.link}\n`;
            promptText += `Content info: ${post.description.substring(0, 1000)}\n\n`;
        });
        
        const modelsToTry = await getAvailableGeminiModels(geminiApiKey);
        let response = null;
        let lastErrorData = null;
        
        for (const model of modelsToTry) {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: promptText }]
                    }]
                })
            });
            if (response.ok) break;
            else lastErrorData = await response.json();
        }
        
        if (!response || !response.ok) {
            throw new Error(lastErrorData?.error?.message || 'API Request failed for all models');
        }
        
        const data = await response.json();
        const markdownReport = data.candidates[0].content.parts[0].text;
        
        const htmlContent = window.marked ? window.marked.parse(markdownReport) : markdownReport;
        
        outputContainer.innerHTML = `
            <div style="background:#1e1e1e; border:1px solid #333; border-radius:8px; padding:20px; margin-bottom:20px; line-height:1.6; position:relative;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:10px; margin-bottom:15px;">
                    <strong style="color:#ff9800; font-size:16px;">🤖 KI-Zusammenfassung (Gemini)</strong>
                    <button class="action-btn" id="copy-report-text" style="width:auto; padding:3px 10px; font-size:11px; height:auto;" title="Kopieren">Kopieren 📋</button>
                </div>
                <div id="ai-report-body" style="color:#eee; font-size:14px; overflow-y:auto; max-height:400px; text-align:left;">${htmlContent}</div>
            </div>
        `;
        
        document.getElementById('copy-report-text').onclick = async () => {
            try {
                await navigator.clipboard.writeText(markdownReport);
                alert("Zusammenfassungsbericht in die Zwischenablage kopiert!");
            } catch(err) {
                console.error("Kopieren fehlgeschlagen:", err);
            }
        };
        
    } catch(e) {
        outputContainer.innerHTML = `
            <div style="background:#1e1e1e; border:1px solid #ff4444; border-radius:8px; padding:20px; margin-bottom:20px; color:#ff4444; text-align:center;">
                <strong>Fehler beim Generieren der Zusammenfassung:</strong>
                <p>${e.message}</p>
            </div>
        `;
    }
}

async function copySummaryLinks() {
    const rows = document.querySelectorAll('.post-row');
    const links = [];
    rows.forEach(row => {
        const link = row.dataset.link;
        const titleEl = row.querySelector('.post-title');
        if (link && titleEl) {
            links.push(`- [${titleEl.innerText.trim()}](${link})`);
        }
    });
    
    if (links.length === 0) {
        alert("Deine Zusammenfassungsliste ist leer.");
        return;
    }
    
    try {
        await navigator.clipboard.writeText(links.join('\n'));
        alert("Links als Markdown-Liste kopiert!");
    } catch(e) {
        console.error("Fehler beim Kopieren:", e);
    }
}

async function clearSummaryList() {
    if (!confirm("Bist du sicher, dass du die gesamte Zusammenfassungsliste leeren möchtest?")) return;
    
    userData.summary_links = [];
    const container = document.getElementById('posts-container');
    
    const rows = container.querySelectorAll('.post-row');
    rows.forEach(row => {
        row.style.transition = 'opacity 0.3s, max-height 0.3s';
        row.style.opacity = '0';
    });
    
    setTimeout(() => {
        renderPostsList([], "Summary List");
    }, 300);
    
    try {
        await db.from('user_settings')
            .update({ summary_links: [] })
            .eq('id', currentUser.id);
    } catch(e) {
        console.error("Sync Summary Clear Error:", e);
    }
}

async function openReader(post) {
    const overlay = document.getElementById('reader-overlay');
    const body = document.getElementById('reader-body');
    overlay.style.display = 'block'; document.body.style.overflow = 'hidden';
    
    const isYouTube = post.link.includes('youtube.com') || post.link.includes('youtu.be');

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

    if (isYouTube) {
        let ytId = '';
        try {
            const url = new URL(post.link);
            if (url.hostname.includes('youtu.be')) ytId = url.pathname.substring(1);
            else ytId = url.searchParams.get('v') || url.pathname.split('/').pop();
        } catch(e) {}
        
        if (ytId) {
            innerContent.innerHTML = `
                <a href="https://www.youtube.com/watch?v=${ytId}" target="_blank" style="text-decoration:none; display:block;">
                    <div style="margin:20px 0; position:relative; cursor:pointer;">
                        <img src="https://i.ytimg.com/vi/${ytId}/hqdefault.jpg" style="width:100%; border-radius:8px; border:1px solid #333;">
                        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.7); width:80px; height:80px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:40px; border:2px solid white;">▶</div>
                    </div>
                </a>
                <div style="margin-top:20px; color:#ccc; font-size:15px; line-height:1.6; white-space:pre-wrap;">${post.desc || 'Keine Beschreibung verfügbar.'}</div>
                <p style="text-align:center; color:#555; font-size:13px; margin-top:30px;">Klicke auf das Vorschaubild, um das Video zu starten (öffnet ggf. die YouTube App).</p>
            `;
            return;
        }
    }

    try {
        const { data: { session } } = await db.auth.getSession();
        const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`
            }, 
            body: JSON.stringify({ url: post.link }) 
        });
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

function closeReader() { document.getElementById('reader-overlay').style.display = 'none'; document.body.style.overflow = 'auto'; }
window.onkeydown = (e) => { if (e.key === 'Escape') closeReader(); };
window.onload = () => {
    init();
    setupResizer();
};
