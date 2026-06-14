// PureTidings Web - Hauptlogik
const SUPABASE_URL = 'https://lujvogyndoryofuffntr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1anZvZ3luZG9yeW9mdWZmbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzI3ODYsImV4cCI6MjA5NzAwODc4Nn0.UEEN01ZKzcdkbP5ktOm35UgWwYQbbwTkM4K0u9_b09w';

// Die Supabase-Bibliothek stellt das Objekt 'supabase' global bereit, 
// wenn man es via CDN lädt. Wir nennen unsere Instanz daher 'db'.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM Elemente
const authOverlay = document.getElementById('auth-overlay');
const appContainer = document.getElementById('app-container');
const emailInput = document.getElementById('email-input');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authStatus = document.getElementById('auth-status');
const userBadge = document.getElementById('user-badge');
const upgradeBanner = document.getElementById('upgrade-banner');

// App State
let currentUser = null;
let userSettings = null;

// --- AUTH LOGIK ---

async function handleLogin() {
    const email = emailInput.value;
    if (!email) return alert('Bitte E-Mail eingeben');
    
    loginBtn.disabled = true;
    authStatus.innerText = 'Sende Magic Link...';
    
    const { error } = await db.auth.signInWithOtp({ 
        email,
        options: {
            emailRedirectTo: window.location.origin
        }
    });
    
    if (error) {
        authStatus.innerText = 'Fehler: ' + error.message;
        loginBtn.disabled = false;
    } else {
        authStatus.innerText = 'Check deine E-Mails! Link wurde gesendet.';
    }
}

async function handleLogout() {
    await db.auth.signOut();
    location.reload();
}

// Auth Status überwachen
db.auth.onAuthStateChange(async (event, session) => {
    if (session) {
        currentUser = session.user;
        authOverlay.classList.add('hidden');
        appContainer.style.display = 'flex';
        await loadUserSettings();
    } else {
        authOverlay.classList.remove('hidden');
        appContainer.style.display = 'none';
    }
});

loginBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);

// --- DATEN LOGIK ---

async function loadUserSettings() {
    const { data, error } = await db
        .from('user_settings')
        .select('*')
        .single();
    
    if (error && error.code !== 'PGRST116') {
        console.error('Fehler beim Laden der Settings:', error);
        return;
    }
    
    userSettings = data;
    renderUI();
}

function renderUI() {
    if (!userSettings) return;
    
    // Pro Status anzeigen
    if (userSettings.is_pro) {
        userBadge.innerHTML = '<span class="pro-badge">PRO</span>';
        upgradeBanner.classList.add('hidden');
    } else {
        userBadge.innerHTML = '';
        upgradeBanner.classList.remove('hidden');
    }
    
    // Feeds laden
    renderFeedTree(userSettings.feed_tree || []);
}

// --- FEED & RSS LOGIK ---

function renderFeedTree(tree) {
    const container = document.getElementById('feed-tree-container');
    container.innerHTML = '<h3>Deine Feeds</h3>';
    
    if (tree.length === 0) {
        container.innerHTML += '<p style="padding:10px; font-size:12px;">Noch keine Feeds. Nutze die Extension zum Hinzufügen oder (bald) hier.</p>';
        return;
    }
    
    const ul = document.createElement('ul');
    ul.className = 'feed-list';
    
    tree.forEach(item => {
        const li = document.createElement('li');
        li.innerText = item.name || item.url;
        li.style.cursor = 'pointer';
        li.style.padding = '5px 10px';
        li.addEventListener('click', () => loadFeedPosts(item.url));
        ul.appendChild(li);
    });
    
    container.appendChild(ul);
}

async function loadFeedPosts(url) {
    const postsContainer = document.getElementById('posts-container');
    postsContainer.innerHTML = '<div style="padding:20px;">Lade Artikel...</div>';
    
    try {
        // CORS Proxy Trick für heute Abend
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
        const response = await fetch(proxyUrl);
        const xmlText = await response.text();
        
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, "text/xml");
        const items = xml.querySelectorAll('item, entry');
        
        postsContainer.innerHTML = '';
        
        items.forEach(item => {
            const title = item.querySelector('title')?.textContent;
            const link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href');
            const description = item.querySelector('description, summary')?.textContent;
            
            const div = document.createElement('div');
            div.className = 'post-item';
            div.style.padding = '15px';
            div.style.borderBottom = '1px solid #333';
            div.innerHTML = `
                <h2 style="margin:0 0 10px 0; font-size:18px;">${title}</h2>
                <div style="font-size:14px; color:#ccc;">${description ? description.substring(0, 200) + '...' : ''}</div>
                <a href="${link}" target="_blank" style="color:#ff9800; font-size:12px; text-decoration:none; display:inline-block; margin-top:10px;">Original lesen</a>
            `;
            postsContainer.appendChild(div);
        });
        
    } catch (e) {
        postsContainer.innerHTML = '<div style="padding:20px; color:red;">Fehler beim Laden des Feeds.</div>';
        console.error(e);
    }
}
