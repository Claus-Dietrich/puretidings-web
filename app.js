// PureTidings Web - Ultra-Robust Launcher
const SUPABASE_URL = 'https://lujvogyndoryofuffntr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1anZvZ3luZG9yeW9mdWZmbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzI3ODYsImV4cCI6MjA5NzAwODc4Nn0.UEEN01ZKzcdkbP5ktOm35UgWwYQbbwTkM4K0u9_b09w';

let db;

// Hilfsfunktion für Status-Updates
function setStatus(msg) {
    const el = document.getElementById('auth-status');
    if (el) el.innerText = msg;
    console.log("App Status:", msg);
}

// Haupt-Initialisierung
async function init() {
    console.log("Initialisiere PureTidings Web...");

    // 1. Prüfen ob Supabase geladen ist
    if (!window.supabase) {
        setStatus("Fehler: Supabase Bibliothek nicht geladen. Lade Seite neu...");
        setTimeout(() => location.reload(), 2000);
        return;
    }

    try {
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log("Supabase Client bereit.");
    } catch (e) {
        setStatus("Fehler bei DB Initialisierung: " + e.message);
        return;
    }

    // 2. Event Listener binden (Logout & Login)
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    if (loginBtn) {
        loginBtn.onclick = handleLogin;
        console.log("Login-Button gebunden.");
    }
    
    if (logoutBtn) {
        logoutBtn.onclick = handleLogout;
        console.log("Logout-Button gebunden.");
    }

    // 3. Auth-Status überwachen
    db.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth-Event:", event);
        const authOverlay = document.getElementById('auth-overlay');
        const appContainer = document.getElementById('app-container');

        if (session) {
            if (authOverlay) authOverlay.style.display = 'none';
            if (appContainer) appContainer.style.display = 'flex';
            loadApp(session.user);
        } else {
            if (authOverlay) authOverlay.style.display = 'flex';
            if (appContainer) appContainer.style.display = 'none';
        }
    });
}

// --- AUTH FUNKTIONEN ---

async function handleLogin() {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value;
    
    if (!email) return alert('E-Mail fehlt');
    
    setStatus("Verarbeite...");
    
    if (password) {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) { alert("Login fehlgeschlagen: " + error.message); setStatus("Fehler."); }
    } else {
        const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) { alert("Magic Link Fehler: " + error.message); setStatus("Fehler."); }
        else { setStatus("Magic Link gesendet! Check deine Mails."); }
    }
}

async function handleLogout() {
    console.log("Logout wird ausgeführt...");
    try {
        // Wir löschen zusätzlich lokal alles, falls die API hakt
        localStorage.clear(); 
        await db.auth.signOut();
    } catch (e) {
        console.warn("SignOut Fehler (ignoriert):", e);
    }
    location.reload();
}

// --- APP LOGIK ---

async function loadApp(user) {
    const userBadge = document.getElementById('user-badge');
    if (userBadge) userBadge.innerText = user.email;
    
    try {
        // WICHTIG: Wir filtern jetzt exakt nach der ID des eingeloggten Nutzers
        let { data: settings, error } = await db.from('user_settings')
            .select('*')
            .eq('id', user.id) 
            .single();
        
        // Profil automatisch erstellen falls es fehlt (PGRST116 = JSON object requested, but no rows returned)
        if (error && error.code === 'PGRST116') {
            console.log("Profil fehlt für ID:", user.id);
            const { data: newData, error: insError } = await db.from('user_settings')
                .insert([{ id: user.id, email: user.email }])
                .select()
                .single();
            if (insError) throw insError;
            settings = newData;
        } else if (error) {
            throw error;
        }
        
        renderSidebar(settings.feed_tree || []);
        
        const upgradeBtn = document.getElementById('upgrade-btn');
        if (upgradeBtn) {
            if (settings.is_pro) {
                upgradeBtn.classList.add('hidden');
            } else {
                const baseUrl = "https://buy.polar.sh/polar_cl_hyHl1QpZkQfPWmUapDe4fshQi2MJzxfcLwPjE2AIaLr";
                // Append user_id as metadata so Polar sends it back in the webhook
                upgradeBtn.href = `${baseUrl}?metadata[user_id]=${user.id}&customer_email=${encodeURIComponent(user.email)}`;
                upgradeBtn.classList.remove('hidden');
            }
        }

    } catch (e) {
        console.error("App-Ladefehler:", e);
        const container = document.getElementById('feed-tree-container');
        if (container) container.innerHTML = `<p style="color:red; padding:10px;">Datenbank-Fehler. Hast du das SQL Skript in Supabase ausgeführt?</p>`;
    }
}

function renderSidebar(tree) {
    const container = document.getElementById('feed-tree-container');
    if (!container) return;
    
    container.innerHTML = '<h3 style="padding:15px; font-size:14px; border-bottom:1px solid #333; margin:0;">Feeds</h3>';
    
    if (!tree || tree.length === 0) {
        container.innerHTML += '<p style="padding:15px; font-size:12px; color:#888;">Noch keine Feeds.<br><br>Exportiere deine Liste aus der Extension (Settings -> Backup).</p>';
        return;
    }
    
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none'; ul.style.padding = '0';
    
    function walk(nodes) {
        nodes.forEach(n => {
            if (n.type === 'feed') {
                const li = document.createElement('li');
                li.style.padding = '10px 15px'; li.style.cursor = 'pointer'; li.style.borderBottom = '1px solid #222';
                li.innerHTML = `<span style="margin-right:8px;">📰</span> ${n.name}`;
                li.onclick = () => loadFeedPosts(n.url);
                ul.appendChild(li);
            }
            if (n.children) walk(n.children);
        });
    }
    walk(tree);
    container.appendChild(ul);
}

async function loadFeedPosts(url) {
    const container = document.getElementById('posts-container');
    container.innerHTML = '<div style="padding:20px;">Lade Artikel (Proxy 1)...</div>';
    
    // Liste der Proxies für heute Abend
    const proxies = [
        (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
        (u) => 'https://corsproxy.io/?' + encodeURIComponent(u)
    ];

    async function tryFetch(proxyIdx) {
        if (proxyIdx >= proxies.length) {
            throw new Error("Alle Proxies sind fehlgeschlagen.");
        }

        try {
            const proxyUrl = proxies[proxyIdx](url);
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error("HTTP Status " + res.status);
            
            const txt = await res.text();
            const xml = new DOMParser().parseFromString(txt, "text/xml");
            const items = xml.querySelectorAll('item, entry');
            
            if (items.length === 0) throw new Error("Keine Artikel im XML gefunden.");
            
            return items;
        } catch (e) {
            console.warn(`Proxy ${proxyIdx + 1} fehlgeschlagen:`, e.message);
            if (container) container.innerHTML = `<div style="padding:20px;">Proxy ${proxyIdx + 1} hakt. Versuche Fallback...</div>`;
            return await tryFetch(proxyIdx + 1);
        }
    }

    try {
        const items = await tryFetch(0);
        container.innerHTML = '';
        
        items.forEach(item => {
            const title = item.querySelector('title')?.textContent || 'Kein Titel';
            let link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || '#';
            const desc = item.querySelector('description, summary')?.textContent || '';
            
            const div = document.createElement('div');
            div.style.padding = '20px'; 
            div.style.borderBottom = '1px solid #333';
            div.innerHTML = `<h2 style="font-size:18px; color:#ff9800; margin:0 0 10px 0;">${title}</h2>
                             <p style="font-size:14px; color:#ccc; line-height:1.5;">${desc.replace(/<[^>]*>?/gm, '').substring(0, 250)}...</p>
                             <a href="${link}" target="_blank" style="color:#ff9800; font-size:12px; text-decoration:none; margin-top:10px; border:1px solid #ff9800; padding:4px 8px; border-radius:4px; display:inline-block;">Original lesen</a>`;
            container.appendChild(div);
        });
    } catch (e) { 
        container.innerHTML = `<div style="padding:20px; color:red;">
            <b>Fehler beim Laden des Feeds.</b><br>
            Der Feed-Anbieter blockiert eventuell Zugriffe von außen.<br>
            <small style="color:#888;">Details: ${e.message}</small>
        </div>`; 
    }
}

// Start der App erst wenn DOM fertig ist
window.onload = init;
