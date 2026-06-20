// PureTidings Web - Bulletproof Persistence Launcher
const SUPABASE_URL = 'https://lujvogyndoryofuffntr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1anZvZ3luZG9yeW9mdWZmbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzI3ODYsImV4cCI6MjA5NzAwODc4Nn0.UEEN01ZKzcdkbP5ktOm35UgWwYQbbwTkM4K0u9_b09w';

let db;
let currentUser = null;
let currentFeedUrl = localStorage.getItem('currentFeedUrl') || null;
let currentFeedName = localStorage.getItem('currentFeedName') || '';
let currentViewMode = localStorage.getItem('currentViewMode') || 'all'; // 'feed', 'all', 'favorites', 'summary'
let summarySubMode = localStorage.getItem('summarySubMode') || 'list'; // 'list' or 'report'
let summaryDateFilterVal = localStorage.getItem('summaryDateFilterVal') || 'all';
let filterDateFromVal = localStorage.getItem('filterDateFromVal') || '';
let filterTimeFromVal = localStorage.getItem('filterTimeFromVal') || '';
let filterDateToVal = localStorage.getItem('filterDateToVal') || '';
let filterTimeToVal = localStorage.getItem('filterTimeToVal') || '';
let exportFormatVal = localStorage.getItem('exportFormatVal') || 'txt';
const globalPostsCache = {}; // Cache for fetched feed posts

let userData = {
    feed_tree: [],
    favorited_links: [],
    summary_links: [],
    read_links: [],
    duration_cache: {}
};

// Rules Engine Hilfsfunktionen
function getWebRules() {
    try {
        const val = localStorage.getItem('web_rules');
        return val ? JSON.parse(val) : [];
    } catch (e) {
        return [];
    }
}

async function saveWebRules(rules) {
    try {
        localStorage.setItem('web_rules', JSON.stringify(rules));
        await updateCloudSettings({ rules });
    } catch (e) {
        console.error("Error saving rules:", e);
    }
}

function getHiddenKeywordLinks() {
    try {
        const val = localStorage.getItem('web_hidden_keyword_links');
        return val ? JSON.parse(val) : [];
    } catch (e) {
        return [];
    }
}

function saveHiddenKeywordLinks(links) {
    try {
        localStorage.setItem('web_hidden_keyword_links', JSON.stringify(links));
    } catch (e) {
        console.error(e);
    }
}

function applyRulesToPost(post, rules) {
    if (!post) return post;
    post.matchedRules = [];
    post.isHidden = false;

    const enabledRules = rules.filter(rule => rule.enabled !== false);
    
    enabledRules.forEach(rule => {
        let postValue = '';
        if (rule.field === 'title') {
            postValue = String(post.title || '');
        } else if (rule.field === 'author') {
            postValue = String(post.author || '');
        } else {
            postValue = String(post.desc || post.description || '');
        }

        const ruleValue = (rule.value || '').trim();
        if (!ruleValue) return;

        let match = false;
        let matchedKeyword = '';

        if (rule.condition === 'equals') {
            match = postValue.toLowerCase() === ruleValue.toLowerCase();
            if (match) matchedKeyword = ruleValue;
        } else {
            const searchConditionGroups = parseSearchQuery(ruleValue);
            if (searchConditionGroups.length > 0) {
                const matchingGroup = searchConditionGroups.find(group => 
                    group.every(cond => cond.mustNot ? !cond.regex.test(postValue) : cond.regex.test(postValue))
                );
                
                const matchesSearch = !!matchingGroup;
                
                if (rule.condition === 'contains') {
                    match = matchesSearch;
                    if (match && matchingGroup) {
                        const positiveCond = matchingGroup.find(c => !c.mustNot);
                        matchedKeyword = positiveCond ? positiveCond.regex.source.replace(/\\\*/g, '*').replace(/\\/g, '') : ruleValue;
                    }
                } else if (rule.condition === 'not-contains') {
                    match = !matchesSearch;
                }
            }
        }

        if (match) {
          if (!post.matchedRules.some(m => m.id === rule.id)) {
              post.matchedRules.push({ id: rule.id, value: matchedKeyword || rule.value });
          }
          
          switch (rule.action) {
            case 'markAsRead': 
                if (userData.read_links && !userData.read_links.includes(post.link)) {
                    userData.read_links.push(post.link);
                    updateCloudSettings({ read_links: userData.read_links }).catch(e => console.error(e));
                }
                break;
            case 'hide': 
                post.isHidden = true; 
                break;
          }
        }
    });
    
    return post;
}

function renderSettingsRules() {
    const rulesList = document.getElementById('settings-rules-list');
    if (!rulesList) return;
    
    const rules = getWebRules();
    if (rules.length === 0) {
        rulesList.innerHTML = '<div style="color:var(--text-color-darker); font-style:italic; padding: 4px 0;">Keine Regeln definiert.</div>';
        return;
    }
    
    let html = '<div style="display:flex; flex-direction:column; gap:6px; max-height: 150px; overflow-y:auto; padding-right:5px; margin-bottom:10px;">';
    rules.forEach((rule, index) => {
        const fieldMap = { title: 'Titel', author: 'Autor', desc: 'Inhalt' };
        const condMap = { contains: 'enthält', 'not-contains': 'enthält nicht', equals: 'ist gleich' };
        const actMap = { notify: 'Markieren', markAsRead: 'Gelesen', hide: 'Ausblenden' };
        
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--input-bg); border:1px solid var(--border-color); border-radius:4px; gap:8px;">
                <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="WENN ${fieldMap[rule.field]} ${condMap[rule.condition]} '${rule.value}' DANN ${actMap[rule.action]}">
                    <strong>WENN</strong> ${fieldMap[rule.field]} ${condMap[rule.condition]} <strong>'${rule.value}'</strong> <strong>DANN</strong> ${actMap[rule.action]}
                </div>
                <span onclick="deleteWebRule(${index})" style="color:#d93025; font-weight:bold; cursor:pointer; font-size:14px; padding: 0 4px;" title="Regel löschen">🗑️</span>
            </div>
        `;
    });
    html += '</div>';
    rulesList.innerHTML = html;
}

window.deleteWebRule = (index) => {
    const rules = getWebRules();
    rules.splice(index, 1);
    saveWebRules(rules);
    renderSettingsRules();
    if (currentFeedUrl) {
        loadFeedPosts(currentFeedUrl, currentFeedName);
    } else {
        showView(currentViewMode);
    }
};

function setupRulesEvents() {
    const addBtn = document.getElementById('new-rule-add-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            const field = document.getElementById('new-rule-field').value;
            const condition = document.getElementById('new-rule-condition').value;
            const valInput = document.getElementById('new-rule-value');
            const value = valInput.value.trim();
            const action = document.getElementById('new-rule-action').value;
            
            if (!value) {
                alert("Bitte gib ein Schlüsselwort ein.");
                return;
            }
            
            const newRule = {
                id: 'rule-' + Date.now(),
                field,
                condition,
                value,
                action,
                enabled: true
            };
            
            const rules = getWebRules();
            rules.push(newRule);
            saveWebRules(rules);
            valInput.value = '';
            renderSettingsRules();
            
            if (currentFeedUrl) {
                loadFeedPosts(currentFeedUrl, currentFeedName);
            } else {
                showView(currentViewMode);
            }
        };
    }
}

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
    
    // Sidebar Toggle (Mobile Drawer & Desktop Collapse)
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const sidebar = document.getElementById('feed-tree-container');
    const postsContainer = document.getElementById('posts-container');
    
    // Restore sidebar state from localStorage (Desktop only)
    const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (sidebarCollapsed && sidebar) {
        sidebar.classList.add('collapsed');
        const resizer = document.getElementById('sidebar-resizer');
        if (resizer) {
            resizer.classList.add('collapsed');
        }
    }

    if (menuToggleBtn && sidebar) {
        menuToggleBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                // Mobile behavior: drawer slide-in/out
                sidebar.classList.toggle('active');
            } else {
                // Desktop behavior: collapse/expand sidebar
                const isCollapsed = sidebar.classList.toggle('collapsed');
                const resizer = document.getElementById('sidebar-resizer');
                if (resizer) {
                    resizer.classList.toggle('collapsed', isCollapsed);
                }
                localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
            }
        };
    }
    if (postsContainer && sidebar) {
        postsContainer.onclick = () => {
            if (sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
        };
    }
    
    // Theme Switcher Event Handling
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        // Set initial icon based on actual applied class
        const isDark = document.body.classList.contains('dark-mode');
        themeToggleBtn.innerText = isDark ? '🌙' : '☀️';
        
        themeToggleBtn.onclick = () => {
            const currentlyDark = document.body.classList.contains('dark-mode');
            if (currentlyDark) {
                document.body.classList.remove('dark-mode');
                localStorage.setItem('darkMode', 'false');
                themeToggleBtn.innerText = '☀️';
            } else {
                document.body.classList.add('dark-mode');
                localStorage.setItem('darkMode', 'true');
                themeToggleBtn.innerText = '🌙';
            }
        };
    }
    
    // Settings Events
    const settingsBtn = document.getElementById('settings-btn');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsClose = document.getElementById('settings-close');
    const settingsSave = document.getElementById('settings-save-btn');
    const settingsGeminiKey = document.getElementById('settings-gemini-key');
    const settingsAiPrompt = document.getElementById('settings-ai-prompt');
    const settingsYtPrompt = document.getElementById('settings-yt-prompt');


    if (settingsBtn && settingsOverlay) {
        settingsBtn.onclick = () => {
            settingsGeminiKey.value = localStorage.getItem('gemini_api_key') || '';
            settingsAiPrompt.value = localStorage.getItem('gemini_ai_prompt') || '';
            settingsYtPrompt.value = localStorage.getItem('gemini_yt_prompt') || '';
            renderSettingsRules();
            settingsOverlay.style.display = 'flex';
        };
        setupRulesEvents();
    }
    if (settingsClose && settingsOverlay) {
        settingsClose.onclick = () => {
            settingsOverlay.style.display = 'none';
        };
    }

    if (settingsSave && settingsOverlay) {
        settingsSave.onclick = async () => {
            const apiKey = settingsGeminiKey.value.trim();
            const aiPrompt = settingsAiPrompt.value.trim();
            const ytPrompt = settingsYtPrompt.value.trim();

            localStorage.setItem('gemini_api_key', apiKey);
            localStorage.setItem('gemini_ai_prompt', aiPrompt);
            localStorage.setItem('gemini_yt_prompt', ytPrompt);

            settingsOverlay.style.display = 'none';
            
            try {
                await db.from('user_settings').update({
                    gemini_api_key: apiKey,
                    gemini_ai_prompt: aiPrompt,
                    gemini_yt_prompt: ytPrompt,
                    updated_at: new Date().toISOString()
                }).eq('id', currentUser.id);

                // Notify Extension to sync settings immediately
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    const extensionId = 'faeeldkkipajnnbkajhdanhbhilfifah';
                    chrome.runtime.sendMessage(extensionId, {
                        action: "syncSession",
                        email: currentUser.email
                    });
                }

                alert("Einstellungen lokal und in der Cloud gespeichert!");
            } catch (e) {
                console.error("Cloud-Speicherungsfehler:", e);
                alert("Einstellungen lokal gespeichert, aber Cloud-Speicherung fehlgeschlagen: " + e.message);
            }
        };
    }

    // Enter-Key Support
    const emailInput = document.getElementById('email-input');
    const passInput = document.getElementById('password-input');
    [emailInput, passInput].forEach(el => {
        if (el) el.onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };
    });

    // Search Support
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    if (searchInput) {
        const query = localStorage.getItem('searchQuery') || '';
        searchInput.value = query;
        if (searchClearBtn) {
            searchClearBtn.style.display = query ? 'block' : 'none';
        }
        searchInput.oninput = (e) => {
            const val = e.target.value;
            localStorage.setItem('searchQuery', val);
            if (searchClearBtn) {
                searchClearBtn.style.display = val ? 'block' : 'none';
            }
            handleSearch(val);
        };
        if (searchClearBtn) {
            searchClearBtn.onclick = () => {
                searchInput.value = '';
                localStorage.setItem('searchQuery', '');
                searchClearBtn.style.display = 'none';
                handleSearch('');
                searchInput.focus();
            };
        }
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function parseSearchQuery(query) {
    const searchInput = (query || '').trim();
    if (!searchInput) return [];

    const searchTerms = searchInput.split(',').map(t => t.trim()).filter(t => t.length > 0);

    const searchConditionGroups = searchTerms.map(term => {
        const conditions = [];
        let currentMustNot = false;
        const components = term.split(/(?:^|\s)(\+|\-)/);
        
        components.forEach(comp => {
            const trimmed = comp.trim();
            if (trimmed === '+') {
                currentMustNot = false;
            } else if (trimmed === '-') {
                currentMustNot = true;
            } else if (trimmed !== '') {
                const escapedTerm = escapeRegExp(trimmed).replace(/\\\*/g, '.*');
                conditions.push({
                    regex: new RegExp(escapedTerm, 'i'),
                    mustNot: currentMustNot
                });
            }
        });
        return conditions;
    }).filter(group => group.length > 0);

    return searchConditionGroups;
}

function handleSearch(query) {
    const searchClearBtn = document.getElementById('search-clear-btn');
    if (searchClearBtn) {
        searchClearBtn.style.display = query ? 'block' : 'none';
    }
    const searchConditionGroups = parseSearchQuery(query);
    const rows = document.querySelectorAll('.post-row, .post-item');
    rows.forEach(row => {
        let textToSearch = '';
        if (row.postData) {
            const post = row.postData;
            textToSearch = `${post.title || ''} ${post.feedName || ''} ${post.desc || post.description || ''} ${post.link || ''}`;
        } else {
            textToSearch = row.innerText + ' ' + (row.dataset.link || '');
        }

        const matches = searchConditionGroups.length === 0 || searchConditionGroups.some(group => 
            group.every(cond => cond.mustNot ? !cond.regex.test(textToSearch) : cond.regex.test(textToSearch))
        );
        row.style.display = matches ? 'flex' : 'none';
    });
    filterSidebarFeeds();
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

function sanitizeLinksArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(item => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object' && typeof item.url === 'string') {
                return item.url.trim();
            }
            return null;
        })
        .filter(item => typeof item === 'string' && item.length > 0);
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
                favorited_links: sanitizeLinksArray(data.favorited_links),
                summary_links: sanitizeLinksArray(data.summary_links),
                read_links: sanitizeLinksArray(data.read_links),
                duration_cache: data.duration_cache || {}
            };

            // Gemini API Key und Prompts in localStorage laden (falls in DB vorhanden)
            if (data.gemini_api_key !== undefined && data.gemini_api_key !== null) {
                localStorage.setItem('gemini_api_key', data.gemini_api_key);
            }
            if (data.gemini_ai_prompt !== undefined && data.gemini_ai_prompt !== null) {
                localStorage.setItem('gemini_ai_prompt', data.gemini_ai_prompt);
            }
            if (data.gemini_yt_prompt !== undefined && data.gemini_yt_prompt !== null) {
                localStorage.setItem('gemini_yt_prompt', data.gemini_yt_prompt);
            }
            if (data.rules !== undefined && data.rules !== null) {
                localStorage.setItem('web_rules', JSON.stringify(data.rules));
            } else {
                const localRules = getWebRules();
                if (localRules && localRules.length > 0) {
                    console.log("Sync: Migrating local WebApp rules to cloud...");
                    updateCloudSettings({ rules: localRules }).catch(e => console.error(e));
                }
            }
        }
        
        // Sync session email with the Chrome Extension (if installed)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            const extensionId = 'faeeldkkipajnnbkajhdanhbhilfifah';
            chrome.runtime.sendMessage(extensionId, {
                action: "syncSession",
                email: user.email
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("Extension not detected or syncSession not handled.");
                } else {
                    console.log("Session synced with Chrome Extension successfully:", response);
                }
            });
        }
        
        renderSidebar(userData.feed_tree);
        checkProStatus(data || {});
        
        // Restore stored view mode and active feed (if any)
        const storedView = localStorage.getItem('currentViewMode') || 'all';
        if (storedView === 'feed') {
            const storedUrl = localStorage.getItem('currentFeedUrl');
            const storedName = localStorage.getItem('currentFeedName');
            if (storedUrl) {
                loadFeedPosts(storedUrl, storedName || '');
            } else {
                showView('all');
            }
        } else {
            showView(storedView);
        }
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

// --- Drag and Drop in Sidebar ---
let draggedNodeId = null;

function handleSidebarDragStart(e) {
    draggedNodeId = this.dataset.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedNodeId);
}

function handleSidebarDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    
    const rect = this.getBoundingClientRect();
    const height = rect.height;
    const y = e.clientY - rect.top;
    const isFolder = this.classList.contains('folder-header');
    
    this.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center');
    
    // If it's a folder, allow dropping INTO it (center zone)
    if (isFolder && y > height * 0.25 && y < height * 0.75) {
        this.classList.add('drag-over-center');
    } else if (y < height / 2) {
        this.classList.add('drag-over-top');
    } else {
        this.classList.add('drag-over-bottom');
    }
    
    return false;
}

function handleSidebarDragLeave() {
    this.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center');
}

function handleSidebarDragEnd() {
    this.classList.remove('dragging');
    const items = document.querySelectorAll('.sidebar-item-row');
    items.forEach(item => item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center'));
}

function isNodeDescendant(parentId, childId) {
    if (parentId === childId) return true;
    const parentNode = findNodeById(userData.feed_tree, parentId);
    if (!parentNode || !parentNode.children) return false;
    
    function walk(nodes) {
        for (const n of nodes) {
            if (n.id === childId) return true;
            if (n.children && walk(n.children)) return true;
        }
        return false;
    }
    return walk(parentNode.children);
}

async function handleSidebarDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    
    const isCenter = this.classList.contains('drag-over-center');
    const isTop = this.classList.contains('drag-over-top');
    this.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-center');

    const targetNodeId = this.dataset.id;
    if (draggedNodeId === targetNodeId) return;

    // Safety: Prevent moving a folder inside itself or its children
    if (isNodeDescendant(draggedNodeId, targetNodeId)) {
        console.warn("Folder cannot be moved inside itself or one of its subfolders.");
        return;
    }

    // Extract node from current tree
    const draggedNode = findNodeById(userData.feed_tree, draggedNodeId);
    if (!draggedNode) return;
    
    removeNodeFromTree(userData.feed_tree, draggedNodeId);

    let success = false;

    if (isCenter) {
        // Drop inside a folder
        const folder = findNodeById(userData.feed_tree, targetNodeId);
        if (folder && folder.type === 'folder') {
            if (!folder.children) folder.children = [];
            folder.children.push(draggedNode);
            success = true;
        }
    } else {
        // Drop before or after target node
        function findAndInsert(nodes, targetId, nodeToInsert, before) {
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].id === targetId) {
                    const index = before ? i : i + 1;
                    nodes.splice(index, 0, nodeToInsert);
                    return true;
                }
                if (nodes[i].type === 'folder' && nodes[i].children) {
                    if (findAndInsert(nodes[i].children, targetId, nodeToInsert, before)) return true;
                }
            }
            return false;
        }
        success = findAndInsert(userData.feed_tree, targetNodeId, draggedNode, isTop);
    }

    if (success) {
        await saveFeedTreeToDatabase();
    } else {
        // Fallback: put draggedNode back at the root
        userData.feed_tree.push(draggedNode);
        await saveFeedTreeToDatabase();
    }
    return false;
}

function renderSidebar(tree) {
    const container = document.getElementById('feed-tree-container');
    if (!container) return;
    
    container.innerHTML = `
        <div style="padding:15px 10px;">
            <div id="sidebar-nav-all" onclick="showView('all')" class="sidebar-item"><span>🏠</span> All Posts</div>
            <div id="sidebar-nav-unread" onclick="showView('unread')" class="sidebar-item"><span>✉️</span> Unread Posts</div>
            <div id="sidebar-nav-favorites" onclick="showView('favorites')" class="sidebar-item"><span>⭐</span> Favorites</div>
            <div id="sidebar-nav-keywords" onclick="showView('keywords')" class="sidebar-item"><span>🔍</span> Keyword Matches</div>
            <div id="sidebar-nav-summary" onclick="showView('summary')" class="sidebar-item"><span>📋</span> Summary List</div>
        </div>
        <h3 id="sidebar-feeds-header">
            <span>My Feeds</span>
            <div style="display:flex; gap:10px; text-transform:none;">
                <span id="add-feed-btn" title="Feed hinzufügen">+ Feed</span>
                <span id="add-folder-btn" title="Ordner hinzufügen">+ Ordner</span>
            </div>
        </h3>
        <div id="feed-list-items" style="padding-bottom: 20px;"></div>
    `;

    // Bind add button handlers
    const addFeedBtn = document.getElementById('add-feed-btn');
    if (addFeedBtn) {
        addFeedBtn.onclick = (e) => {
            e.stopPropagation();
            handleAddFeedPrompt();
        };
    }
    const addFolderBtn = document.getElementById('add-folder-btn');
    if (addFolderBtn) {
        addFolderBtn.onclick = (e) => {
            e.stopPropagation();
            handleAddFolderPrompt();
        };
    }

    // Drag-Over Header to move items back to root level
    const header = document.getElementById('sidebar-feeds-header');
    if (header) {
        header.addEventListener('dragover', (e) => {
            if (e.preventDefault) e.preventDefault();
            header.classList.add('drag-over-center');
            return false;
        });
        header.addEventListener('dragleave', () => {
            header.classList.remove('drag-over-center');
        });
        header.addEventListener('drop', async (e) => {
            if (e.stopPropagation) e.stopPropagation();
            header.classList.remove('drag-over-center');
            
            if (!draggedNodeId) return false;
            
            const draggedNode = findNodeById(userData.feed_tree, draggedNodeId);
            if (!draggedNode) return false;
            
            removeNodeFromTree(userData.feed_tree, draggedNodeId);
            // Move item to root level
            userData.feed_tree.push(draggedNode);
            await saveFeedTreeToDatabase();
            return false;
        });
    }
    
    const list = document.getElementById('feed-list-items');
    
    function walk(nodes, parentEl, level = 0) {
        nodes.forEach(n => {
            const li = document.createElement('div');
            li.style.padding = `6px 15px 6px ${20 + (level * 15)}px`;
            li.style.cursor = 'pointer';
            li.style.fontSize = '13px';
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.className = 'sidebar-item-row';

            // Drag and Drop Setup
            li.dataset.id = n.id;
            li.dataset.type = n.type;
            li.draggable = true;

            li.addEventListener('dragstart', handleSidebarDragStart);
            li.addEventListener('dragover', handleSidebarDragOver);
            li.addEventListener('dragleave', handleSidebarDragLeave);
            li.addEventListener('drop', handleSidebarDrop);
            li.addEventListener('dragend', handleSidebarDragEnd);

            if (n.type === 'folder') {
                li.classList.add('folder-header');
                li.innerHTML = `
                    <span class="folder-toggle" draggable="false" style="margin-right:8px; width:12px; font-family:monospace; opacity:0.5;">▼</span> 
                    <span class="folder-title" draggable="false" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${n.name.toUpperCase()}</span>
                    <span class="edit-actions" draggable="false" style="display:none; gap:6px; margin-left:10px; font-size:12px;">
                        <span class="edit-btn" draggable="false" title="Umbenennen" style="opacity:0.6; cursor:pointer;">✏️</span>
                        <span class="delete-btn" draggable="false" title="Löschen" style="opacity:0.6; cursor:pointer;">🗑️</span>
                    </span>
                `;
                li.onclick = (e) => {
                    const toggle = li.querySelector('.folder-toggle');
                    const childrenContainer = li.nextElementSibling;
                    const isHidden = childrenContainer.style.display === 'none';
                    childrenContainer.style.display = isHidden ? 'block' : 'none';
                    toggle.innerText = isHidden ? '▼' : '▶';
                    e.stopPropagation();
                };
                
                // Add event listeners for edit and delete on folder
                const editBtn = li.querySelector('.edit-btn');
                if (editBtn) {
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        handleRenameNode(n);
                    };
                }
                const deleteBtn = li.querySelector('.delete-btn');
                if (deleteBtn) {
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        handleDeleteNode(n);
                    };
                }

                parentEl.appendChild(li);
                
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children';
                parentEl.appendChild(childrenContainer);
                walk(n.children || [], childrenContainer, level + 1);
            } else if (n.type === 'feed' && n.url) {
                const id = getFeedId(n.url);
                li.id = `sidebar-feed-${id}`;
                const favicon = `https://www.google.com/s2/favicons?sz=32&domain=${new URL(n.url).hostname}`;
                li.innerHTML = `
                    <img src="${favicon}" draggable="false" style="width:16px; height:16px; margin-right:10px; border-radius:2px; opacity:0.8;" onerror="this.src='128.png'"> 
                    <span class="feed-title-span" draggable="false" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${n.name}</span>
                    <span class="unread-count" draggable="false" style="font-size:10px; background:#4a90e2; color:white; padding:1px 6px; border-radius:10px; margin-left:5px; display:none;">0</span>
                    <span class="edit-actions" draggable="false" style="display:none; gap:6px; margin-left:10px; font-size:12px;">
                        <span class="edit-btn" draggable="false" title="Bearbeiten" style="opacity:0.6; cursor:pointer;">✏️</span>
                        <span class="delete-btn" draggable="false" title="Löschen" style="opacity:0.6; cursor:pointer;">🗑️</span>
                    </span>
                `;
                li.onclick = () => loadFeedPosts(n.url, n.name);

                // Add event listeners for edit and delete on feed
                const editBtn = li.querySelector('.edit-btn');
                if (editBtn) {
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        handleEditFeed(n);
                    };
                }
                const deleteBtn = li.querySelector('.delete-btn');
                if (deleteBtn) {
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        handleDeleteNode(n);
                    };
                }

                parentEl.appendChild(li);
            }

            // Hover actions display
            li.onmouseenter = () => {
                const actions = li.querySelector('.edit-actions');
                if (actions) actions.style.display = 'flex';
            };
            li.onmouseleave = () => {
                const actions = li.querySelector('.edit-actions');
                if (actions) actions.style.display = 'none';
            };
        });
    }
    walk(tree, list);
}

async function saveFeedTreeToDatabase() {
    try {
        const nowStr = new Date().toISOString();
        await db.from('user_settings')
            .update({ 
                feed_tree: userData.feed_tree,
                updated_at: nowStr
            })
            .eq('id', currentUser.id);

        // Notify Extension to sync settings/feed_tree immediately
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            const extensionId = 'faeeldkkipajnnbkajhdanhbhilfifah';
            chrome.runtime.sendMessage(extensionId, {
                action: "syncSession",
                email: currentUser.email
            });
        }
        
        renderSidebar(userData.feed_tree);
        calculateAllUnreadCounts();
    } catch (e) {
        console.error("Fehler beim Speichern des Feed-Trees:", e);
        alert("Fehler beim Speichern in der Cloud: " + e.message);
    }
}

async function updateCloudSettings(payload) {
    if (!currentUser) return;
    try {
        const nowStr = new Date().toISOString();
        const sanitizedPayload = { ...payload };
        if (payload.favorited_links) {
            sanitizedPayload.favorited_links = sanitizeLinksArray(payload.favorited_links);
        }
        if (payload.summary_links) {
            sanitizedPayload.summary_links = sanitizeLinksArray(payload.summary_links);
        }
        if (payload.read_links) {
            sanitizedPayload.read_links = sanitizeLinksArray(payload.read_links);
        }
        if (payload.rules) {
            sanitizedPayload.rules = payload.rules;
        }
        const fullPayload = {
            ...sanitizedPayload,
            updated_at: nowStr
        };
        await db.from('user_settings').update(fullPayload).eq('id', currentUser.id);

        // Notify Extension to sync settings immediately
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            const extensionId = 'faeeldkkipajnnbkajhdanhbhilfifah';
            chrome.runtime.sendMessage(extensionId, {
                action: "syncSession",
                email: currentUser.email
            });
        }
    } catch (e) {
        console.error("updateCloudSettings error:", e);
    }
}

function handleAddFeedPrompt() {
    const name = prompt("Name des Feeds:");
    if (!name) return;
    const url = prompt("RSS-URL des Feeds:", "https://");
    if (!url || url === "https://") return;

    // Check if feed folder list has folders to let them choose
    const folders = [];
    function findFolders(nodes) {
        nodes.forEach(node => {
            if (node.type === 'folder') {
                folders.push(node);
                if (node.children) findFolders(node.children);
            }
        });
    }
    findFolders(userData.feed_tree);

    let folderId = "";
    if (folders.length > 0) {
        const folderNames = folders.map((f, i) => `${i + 1}. ${f.name}`).join("\n");
        const chosen = prompt(`In welchen Ordner soll der Feed?\n\nVerfügbare Ordner:\n${folderNames}\n\nGib die Nummer ein, oder drücke OK für die Hauptebene:`);
        if (chosen) {
            const idx = parseInt(chosen, 10) - 1;
            if (idx >= 0 && idx < folders.length) {
                folderId = folders[idx].id;
            }
        }
    }

    const newFeed = {
        id: crypto.randomUUID(),
        name: name.trim(),
        url: url.trim(),
        type: 'feed',
        fetchOgImage: true
    };

    if (folderId) {
        const folder = findNodeById(userData.feed_tree, folderId);
        if (folder) {
            if (!folder.children) folder.children = [];
            folder.children.push(newFeed);
        }
    } else {
        userData.feed_tree.push(newFeed);
    }

    saveFeedTreeToDatabase();
}

function handleAddFolderPrompt() {
    const name = prompt("Name des Ordners:");
    if (!name || name.trim().length === 0) return;

    const newFolder = {
        id: crypto.randomUUID(),
        name: name.trim(),
        type: 'folder',
        children: []
    };

    userData.feed_tree.push(newFolder);
    saveFeedTreeToDatabase();
}

function handleRenameNode(node) {
    const newName = prompt("Neuen Namen eingeben:", node.name);
    if (!newName || newName.trim().length === 0) return;
    node.name = newName.trim();
    saveFeedTreeToDatabase();
}

function handleEditFeed(feedNode) {
    const newName = prompt("Feed-Namen bearbeiten:", feedNode.name);
    if (newName === null) return; // cancelled
    
    const newUrl = prompt("Feed-URL bearbeiten:", feedNode.url);
    if (newUrl === null) return; // cancelled
    
    if (newName.trim()) feedNode.name = newName.trim();
    if (newUrl.trim()) feedNode.url = newUrl.trim();
    
    saveFeedTreeToDatabase();
}

function handleDeleteNode(node) {
    if (!confirm(`Möchtest du "${node.name}" wirklich löschen?`)) return;
    
    removeNodeFromTree(userData.feed_tree, node.id);
    saveFeedTreeToDatabase();
}

function removeNodeFromTree(tree, nodeId) {
    for (let i = 0; i < tree.length; i++) {
        if (tree[i].id === nodeId) {
            tree.splice(i, 1);
            return true;
        }
        if (tree[i].children) {
            const found = removeNodeFromTree(tree[i].children, nodeId);
            if (found) return true;
        }
    }
    return false;
}

function findNodeById(tree, nodeId) {
    for (const node of tree) {
        if (node.id === nodeId) return node;
        if (node.children) {
            const found = findNodeById(node.children, nodeId);
            if (found) return found;
        }
    }
    return null;
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
    if (globalPostsCache[url] && globalPostsCache[url].length > 0) {
        return globalPostsCache[url];
    }
    try {
        const xmlStr = await fetchViaExtensionOrProxy(url);
        const xml = parseFeedXML(xmlStr);
        if (!xml) return [];

        const items = xml.querySelectorAll('item, entry');
        
        // Find if this feed has fetchOgImage enabled (defaults to true if not explicitly false)
        let fetchOgImage = true;
        const findFeedInTree = (nodes, targetUrl) => {
            for (const node of nodes) {
                if (node.type === 'feed' && node.url === targetUrl) {
                    return node;
                }
                if (node.type === 'folder' && node.children) {
                    const found = findFeedInTree(node.children, targetUrl);
                    if (found) return found;
                }
            }
            return null;
        };
        const currentFeed = findFeedInTree(userData.feed_tree || [], url);
        if (currentFeed && currentFeed.fetchOgImage === false) {
            fetchOgImage = false;
        }

        const posts = await Promise.all(Array.from(items).map(async item => {
            const title = item.querySelector('title')?.textContent || 'Kein Titel';
            let link = '#';
            const linkNodes = item.getElementsByTagName('link');
            if (linkNodes.length > 0) {
                link = linkNodes[0].getAttribute('href') || linkNodes[0].textContent || '#';
            }
            if (!link || link === '#') {
                link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || '#';
                if ((!link || link === '#') && item.querySelector('link[rel="alternate"]')) {
                    link = item.querySelector('link[rel="alternate"]').getAttribute('href');
                }
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
            
            let pubDate = item.querySelector('pubDate, published, updated')?.textContent || '';
            if (!pubDate) {
              const dcNodes = item.getElementsByTagName('dc:date');
              if (dcNodes.length > 0) pubDate = dcNodes[0].textContent;
            }
            
            let thumbnail = '';
            const ytId = item.querySelector('yt\\:videoId, videoId')?.textContent || '';
            let durationStr = '';
            
            if (ytId) {
                thumbnail = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
                const cachedDuration = userData.duration_cache[ytId];
                durationStr = cachedDuration ? cachedDuration : 'Video';
            } else {
                let mediaThumbnail = null;
                const mtNodes = item.getElementsByTagName('media:thumbnail');
                if (mtNodes.length > 0) {
                  mediaThumbnail = mtNodes[0];
                } else {
                  const thumbNodes = item.getElementsByTagName('thumbnail');
                  if (thumbNodes.length > 0) mediaThumbnail = thumbNodes[0];
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
                
                // Fallback: Fetch page via Supabase Proxy for og:image
                if (!thumbnail && link && link !== '#') {
                    try {
                        console.log(`[Web-App] Try fetch page for og:image via proxy: ${link}`);
                        const html = await fetchViaExtensionOrProxy(link);
                        console.log(`[Web-App] Successfully loaded article HTML, length: ${html.length}`);
                            const docParser = new DOMParser();
                            const docHtml = docParser.parseFromString(html, "text/html");
                            const ogNode = docHtml.querySelector('meta[property="og:image"], meta[name="og:image"], meta[property="twitter:image"], meta[name="twitter:image"], link[rel="image_src"]');
                            if (ogNode) {
                                const imgUrl = ogNode.getAttribute('content') || ogNode.getAttribute('href');
                                if (imgUrl && imgUrl.startsWith('http')) {
                                    thumbnail = imgUrl;
                                    console.log(`[Web-App] Found og:image: ${thumbnail}`);
                                }
                            }
                            
                            if (!thumbnail) {
                                const firstImg = docHtml.querySelector('article img, .post-content img, .entry-content img');
                                if (firstImg && firstImg.getAttribute('src')) {
                                    const imgUrl = firstImg.getAttribute('src');
                                    if (imgUrl && imgUrl.startsWith('http') && !imgUrl.includes('1x1') && !imgUrl.includes('tracking')) {
                                        thumbnail = imgUrl;
                                        console.log(`[Web-App] Found first-image fallback: ${thumbnail}`);
                                    }
                                }
                            }
                            
                            if (!thumbnail) {
                                console.log(`[Web-App] No og:image or body image found on article page.`);
                            }
                        } else {
                            console.warn(`[Web-App] Proxy fetch failed with status: ${response.status}`);
                        }
                    } catch (fetchError) {
                        console.error(`[Web-App] Proxy fetch page error at ${link}:`, fetchError);
                    }
                }
                durationStr = `${calculateReadingTime(desc+encoded)} min read`;
            }

            return {
                title,
                link,
                desc: desc + encoded,
                thumbnail,
                pubDate,
                durationStr,
                feedName,
                feedUrl: url
            };
        }));
        
        const rules = getWebRules();
        posts.forEach(post => {
            applyRulesToPost(post, rules);
        });
        
        globalPostsCache[url] = posts;
        return posts;
    } catch (e) {
        console.error("Error fetching feed:", url, e);
        return [];
    }
}

function updateSidebarTreeForUnread() {
    const isUnreadView = (currentViewMode === 'unread');
    
    // 1. Filter all feeds
    const feedRows = document.querySelectorAll('#feed-list-items div[id^="sidebar-feed-"]');
    feedRows.forEach(row => {
        if (isUnreadView) {
            const countEl = row.querySelector('.unread-count');
            const count = countEl && countEl.style.display !== 'none' ? parseInt(countEl.innerText, 10) || 0 : 0;
            if (count === 0) {
                row.style.display = 'none';
            } else {
                row.style.display = 'flex';
            }
        } else {
            row.style.display = 'flex';
        }
    });

    // 2. Filter all folders bottom-up (deepest first)
    const folderContainers = Array.from(document.querySelectorAll('.folder-children'));
    folderContainers.sort((a, b) => {
        const countAncestors = el => {
            let count = 0;
            let parent = el.parentElement;
            while (parent) {
                if (parent.classList.contains('folder-children')) count++;
                parent = parent.parentElement;
            }
            return count;
        };
        return countAncestors(b) - countAncestors(a);
    });

    folderContainers.forEach(container => {
        const folderRow = container.previousElementSibling;
        if (!folderRow) return;

        if (isUnreadView) {
            let hasVisibleChildren = false;
            for (let i = 0; i < container.children.length; i++) {
                const child = container.children[i];
                if (child.classList.contains('sidebar-item-row') && child.style.display !== 'none') {
                    hasVisibleChildren = true;
                    break;
                }
            }

            if (hasVisibleChildren) {
                folderRow.style.display = 'flex';
                const toggle = folderRow.querySelector('.folder-toggle');
                const isCollapsed = toggle && toggle.innerText === '▶';
                container.style.display = isCollapsed ? 'none' : 'block';
            } else {
                folderRow.style.display = 'none';
                container.style.display = 'none';
            }
        } else {
            folderRow.style.display = 'flex';
            const toggle = folderRow.querySelector('.folder-toggle');
            const isCollapsed = toggle && toggle.innerText === '▶';
            container.style.display = isCollapsed ? 'none' : 'block';
        }
    });
}

async function showView(view) {
    currentViewMode = view;
    currentFeedUrl = null;
    currentFeedName = '';
    localStorage.setItem('currentViewMode', view);
    localStorage.removeItem('currentFeedUrl');
    localStorage.removeItem('currentFeedName');

    const sidebar = document.getElementById('feed-tree-container');
    if (sidebar && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
    }

    updateSidebarTreeForUnread();

    // Reset active class for top items and active background for feed rows
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-item-row').forEach(el => {
        el.classList.remove('active');
        el.style.background = ''; // Clear legacy inline styling
    });
    
    const allBtn = document.getElementById('sidebar-nav-all');
    const unreadBtn = document.getElementById('sidebar-nav-unread');
    const favBtn = document.getElementById('sidebar-nav-favorites');
    const keyBtn = document.getElementById('sidebar-nav-keywords');
    const sumBtn = document.getElementById('sidebar-nav-summary');
    
    if (view === 'all' && allBtn) allBtn.classList.add('active');
    if (view === 'unread' && unreadBtn) unreadBtn.classList.add('active');
    if (view === 'favorites' && favBtn) favBtn.classList.add('active');
    if (view === 'keywords' && keyBtn) keyBtn.classList.add('active');
    if (view === 'summary' && sumBtn) sumBtn.classList.add('active');
    
    const container = document.getElementById('posts-container');
    container.innerHTML = `<div style="padding:40px; text-align:center;"><div class="spinner"></div><div>Lade ${view === 'all' ? 'alle' : (view === 'unread' ? 'ungelesene' : (view === 'favorites' ? 'Favoriten-' : (view === 'keywords' ? 'Keyword-' : 'Zusammenfassungs-')))} Artikel...</div></div>`;
    
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
            let filteredPosts = [...allPosts];
            
            // Apply date filtering
            const { start, end } = getWebSummaryFilters();
            filteredPosts = filteredPosts.filter(post => {
                if (!post.pubDate) return true;
                const postDate = new Date(post.pubDate);
                if (isNaN(postDate.getTime())) return true;
                if (start && postDate < start) return false;
                if (end && postDate > end) return false;
                return true;
            });
            
            filteredPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            renderPostsList(filteredPosts, "All Posts");
        } else if (view === 'unread') {
            let unreadPosts = allPosts.filter(post => !userData.read_links || !userData.read_links.includes(post.link));
            
            // Apply date filtering
            const { start, end } = getWebSummaryFilters();
            unreadPosts = unreadPosts.filter(post => {
                if (!post.pubDate) return true;
                const postDate = new Date(post.pubDate);
                if (isNaN(postDate.getTime())) return true;
                if (start && postDate < start) return false;
                if (end && postDate > end) return false;
                return true;
            });
            
            unreadPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            renderPostsList(unreadPosts, "Unread Posts");
        } else if (view === 'favorites') {
            let favPosts = allPosts.filter(post => userData.favorited_links.includes(post.link));
            
            // Apply date filtering
            const { start, end } = getWebSummaryFilters();
            favPosts = favPosts.filter(post => {
                if (!post.pubDate) return true;
                const postDate = new Date(post.pubDate);
                if (isNaN(postDate.getTime())) return true;
                if (start && postDate < start) return false;
                if (end && postDate > end) return false;
                return true;
            });
            
            favPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            renderPostsList(favPosts, "Favorites");
        } else if (view === 'keywords') {
            const hiddenLinks = getHiddenKeywordLinks();
            let keyPosts = allPosts.filter(post => 
                post.matchedRules && 
                post.matchedRules.length > 0 && 
                !hiddenLinks.includes(post.link)
            );
            
            // Apply date filtering
            const { start, end } = getWebSummaryFilters();
            keyPosts = keyPosts.filter(post => {
                if (!post.pubDate) return true;
                const postDate = new Date(post.pubDate);
                if (isNaN(postDate.getTime())) return true;
                if (start && postDate < start) return false;
                if (end && postDate > end) return false;
                return true;
            });
            
            keyPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            renderPostsList(keyPosts, "Keyword Matches");
        } else if (view === 'summary') {
            let sumPosts = allPosts.filter(post => userData.summary_links.includes(post.link));
            
            // Apply date filtering
            const { start, end } = getWebSummaryFilters();
            sumPosts = sumPosts.filter(post => {
                if (!post.pubDate) return true;
                const postDate = new Date(post.pubDate);
                if (isNaN(postDate.getTime())) return true;
                if (start && postDate < start) return false;
                if (end && postDate > end) return false;
                return true;
            });
            
            sumPosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            renderPostsList(sumPosts, "Summary List");
        }

        // Apply active search query in UI (if any)
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value.trim() !== '') {
            handleSearch(searchInput.value);
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
            const xmlStr = await fetchViaExtensionOrProxy(feed.url);
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
    updateSidebarTreeForUnread();
}

// --- UTILS ---

function decodeHTML(str) {
    if (!str) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
}

function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function getWebSummaryFilters() {
    const preset = summaryDateFilterVal;
    const now = new Date();
    let start = null;
    let end = null;

    if (preset === 'today') {
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
    } else if (preset === '7days') {
        start = new Date(now);
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
    } else if (preset === '30days') {
        start = new Date(now);
        start.setDate(now.getDate() - 30);
        start.setHours(0, 0, 0, 0);
    } else if (preset === 'custom') {
        if (filterDateFromVal) {
            start = new Date(filterDateFromVal + (filterTimeFromVal ? 'T' + filterTimeFromVal : 'T00:00'));
        }
        if (filterDateToVal) {
            end = new Date(filterDateToVal + (filterTimeToVal ? 'T' + filterTimeToVal : 'T23:59:59'));
        }
    }
    return { start, end };
}

function getCurrentlyFilteredWebPosts() {
    const container = document.getElementById('posts-container');
    if (!container) return [];
    
    const items = container.querySelectorAll('.post-row, .post-item');
    const filteredPosts = [];
    
    items.forEach(item => {
        if (item.style.display === 'none') return;
        if (item.postData) {
            filteredPosts.push(item.postData);
        }
    });
    
    return filteredPosts;
}

function generateWebSummaryContent(posts, format, subMode) {
    let content = "";
    const nowStr = new Date().toLocaleString();
    const isReport = subMode === 'report';
    
    let pageName = "Content Summary";
    if (currentViewMode === 'all') pageName = "All Posts";
    else if (currentViewMode === 'favorites') pageName = "Favorite Posts";
    else if (currentViewMode === 'summary') pageName = "Summary Cart";
    
    if (format === 'txt') {
        content = `PURETIDINGS - ${pageName.toUpperCase()} (${isReport ? "FULL REPORT" : "LIST"})\n`;
        content += "Generated on: " + nowStr + "\n";
        content += "======================================\n\n";
        posts.forEach((post, index) => {
            content += `${index + 1}. ${post.title}${post.feedName ? ` [Source: ${post.feedName}]` : ""}\n`;
            content += `   Date: ${post.pubDate ? new Date(post.pubDate).toLocaleString() : "Unknown"}\n`;
            content += `   Link: ${post.link}\n`;
            
            if (isReport) {
                const sourceText = post.desc || '';
                if (sourceText) {
                    const cleanDesc = sourceText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    content += `   Content: ${cleanDesc.substring(0, 2000)}${cleanDesc.length > 2000 ? '...' : ''}\n`;
                }
            }
            content += `\n--------------------------------------\n\n`;
        });
    } else if (format === 'markdown') {
        content = `# PureTidings - ${pageName} (${isReport ? "Full Report" : "List"})\n\n`;
        content += `*Generated on: ${nowStr}*\n\n---\n\n`;
        posts.forEach((post, index) => {
            content += `## ${index + 1}. [${post.title}](${post.link})\n`;
            content += `**Source:** ${post.feedName || "Unknown"} | **Date:** ${post.pubDate ? new Date(post.pubDate).toLocaleString() : "Unknown"}  \n\n`;
            
            if (isReport) {
                const sourceText = post.desc || '';
                if (sourceText) {
                    const cleanDesc = sourceText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    content += `${cleanDesc}\n\n`;
                }
            }
            content += `---\n\n`;
        });
    } else if (format === 'html') {
        content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PureTidings Summary</title><style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background-color: #f9f9f9; color: #333; }
            .reader-container { max-width: 700px; margin: 20px auto; padding: 20px 40px; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { font-size: 2.2em; font-weight: 700; line-height: 1.2; margin: 0 0 10px 0; }
            h2 { font-size: 1.8em; font-weight: 700; line-height: 1.2; margin: 0 0 5px 0; }
            h2 a { color: #333; }
            h2 a:hover { color: #0066cc; }
            .report-header { text-align: center; margin-bottom: 40px; }
            .report-header p { color: #888; font-size: 0.9em; margin: 5px 0; }
            article { margin-bottom: 60px; }
            .meta { font-size: 0.9em; color: #888; margin-top: 10px; margin-bottom: 20px; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            hr { border: 0; border-top: 1px solid #ddd; margin: 20px 0; }
            .desc { font-size: 1.1em; line-height: 1.7; word-wrap: break-word; word-break: break-word; }
            .desc img, .desc figure { max-width: 100% !important; height: auto !important; margin: 20px 0; border-radius: 4px; }
            .featured-img { max-width: 100%; height: auto; border-radius: 4px; margin-bottom: 15px; display: block; }
        </style></head><body><div class="reader-container">`;
        content += `<div class="report-header"><h1>PureTidings - ${pageName} (${isReport ? "Full Report" : "List"})</h1>`;
        content += `<p>Generated on: ${nowStr}</p></div>`;
        posts.forEach((post, index) => {
            content += `<article>`;
            content += `<h2>${index + 1}. <a href="${post.link}" target="_blank">${escapeHTML(decodeHTML(post.title))}</a></h2>`;
            content += `<div class="meta"><strong>Source:</strong> ${escapeHTML(decodeHTML(post.feedName || "Unknown"))} &nbsp;|&nbsp; <strong>Date:</strong> ${post.pubDate ? new Date(post.pubDate).toLocaleString() : "Unknown"} &nbsp;|&nbsp; <a href="${post.link}" target="_blank">Original Link</a></div>`;
            
            if (isReport) {
                content += `<hr>`;
                if (post.thumbnail) {
                    content += `<img src="${post.thumbnail}" class="featured-img" alt="Featured Image">`;
                }
                
                if (post.link && (post.link.includes('youtube.com/watch') || post.link.includes('youtube.com/shorts/'))) {
                    let videoInfoHtml = `<p><strong>YouTube Video:</strong> <a href="${post.link}" target="_blank">${escapeHTML(decodeHTML(post.title || post.link))}</a></p>`;
                    content += videoInfoHtml;
                    if (post.desc) {
                        content += `<div class="desc">${post.desc}</div>`;
                    }
                } else if (post.desc) {
                    content += `<div class="desc">${post.desc}</div>`;
                }
            }
            content += `</article>`;
        });
        content += `</div></body></html>`;
    }
    return content;
}

function downloadSummaryLinks() {
    const posts = getCurrentlyFilteredWebPosts();
    if (posts.length === 0) {
        alert("Deine Zusammenfassungsliste ist leer oder es entsprechen keine Artikel den Filtern.");
        return;
    }
    
    const format = exportFormatVal;
    const content = generateWebSummaryContent(posts, format, summarySubMode);
    const mimeType = format === 'html' ? 'text/html' : (format === 'markdown' ? 'text/markdown' : 'text/plain');
    const extension = format === 'html' ? 'html' : (format === 'markdown' ? 'md' : 'txt');

    const now = new Date();
    const datePart = now.toISOString().split('T')[0];
    const timePart = now.getHours().toString().padStart(2, '0') + '-' + now.getMinutes().toString().padStart(2, '0');
    const defaultName = `puretidings-summary-${datePart}_${timePart}.${extension}`;
    let fileName = prompt("Name für den Bericht eingeben:", defaultName);
    
    if (fileName === null) return;
    if (fileName.trim() === "") fileName = defaultName;
    
    const finalName = fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName;
    a.click();
    URL.revokeObjectURL(url);
}

function showWebCopyStatus(message, type) {
    const copyStatus = document.getElementById('web-copy-status');
    if (!copyStatus) return;
    copyStatus.textContent = message;
    copyStatus.style.color = type === 'error' ? 'red' : 'green';
    setTimeout(() => { copyStatus.textContent = ""; }, 3000);
}

function getActiveFeedUrlsByFilters() {
    const activeFeedUrls = new Set();
    const { start, end } = getWebSummaryFilters();
    const searchInput = document.getElementById('search-input');
    const searchQuery = searchInput ? searchInput.value : '';
    const searchConditionGroups = parseSearchQuery(searchQuery);

    for (const url in globalPostsCache) {
        const posts = globalPostsCache[url] || [];
        const hasMatchingPost = posts.some(post => {
            // Apply view-specific constraints
            if (currentViewMode === 'favorites' && !userData.favorited_links.includes(post.link)) return false;
            if (currentViewMode === 'summary' && !userData.summary_links.includes(post.link)) return false;
            if (currentViewMode === 'unread' && userData.read_links.includes(post.link)) return false;

            if (post.pubDate) {
                const postDate = new Date(post.pubDate);
                if (!isNaN(postDate.getTime())) {
                    if (start && postDate < start) return false;
                    if (end && postDate > end) return false;
                }
            }
            if (searchConditionGroups.length > 0) {
                const textToSearch = `${post.title || ''} ${post.feedName || ''} ${post.desc || post.description || ''} ${post.link || ''}`;
                const matches = searchConditionGroups.some(group => 
                    group.every(cond => cond.mustNot ? !cond.regex.test(textToSearch) : cond.regex.test(textToSearch))
                );
                if (!matches) return false;
            }
            return true;
        });

        if (hasMatchingPost) {
            activeFeedUrls.add(url);
        }
    }
    return activeFeedUrls;
}

function filterSidebarFeeds() {
    const isFilteredView = (currentViewMode === 'all' || currentViewMode === 'favorites' || currentViewMode === 'summary' || currentViewMode === 'feed' || currentViewMode === 'unread');
    const feedRows = document.querySelectorAll('.sidebar-item-row');
    const folderContainers = document.querySelectorAll('.folder-children');

    if (!isFilteredView) {
        // Blende alle Feeds und Ordner wieder ein
        feedRows.forEach(row => {
            row.style.display = 'flex';
            row.style.opacity = '1';
        });
        folderContainers.forEach(container => {
            container.style.display = 'block';
        });
        return;
    }

    // Finde alle aktiven Feed-URLs basierend auf den aktuellen Filtern und Modus
    const activeFeedUrls = getActiveFeedUrlsByFilters();

    // Filter die Feeds
    feedRows.forEach(row => {
        const isFolder = row.querySelector('.folder-toggle');
        if (isFolder) return; // Ordner behandeln wir separat

        const idAttr = row.id || '';
        if (idAttr.startsWith('sidebar-feed-')) {
            const matchingFeed = getAllFeeds().find(f => `sidebar-feed-${getFeedId(f.url)}` === idAttr);
            if (matchingFeed) {
                const hasMatches = activeFeedUrls.has(matchingFeed.url);
                if (hasMatches) {
                    row.style.display = 'flex';
                    row.style.opacity = '1';
                } else {
                    row.style.display = 'none';
                }
            }
        }
    });

    // Filtere die Ordner von innen nach außen
    const folderRows = Array.from(feedRows).filter(row => row.querySelector('.folder-toggle'));
    
    folderRows.reverse().forEach(row => {
        const nextContainer = row.nextElementSibling;
        if (nextContainer && nextContainer.classList.contains('folder-children')) {
            const visibleChildren = Array.from(nextContainer.children).filter(child => {
                if (child.classList.contains('folder-children')) return false;
                return child.style.display !== 'none';
            });

            if (visibleChildren.length > 0) {
                row.style.display = 'flex';
                const toggle = row.querySelector('.folder-toggle');
                const isCollapsed = toggle && toggle.innerText === '▶';
                nextContainer.style.display = isCollapsed ? 'none' : 'block';
            } else {
                row.style.display = 'none';
                nextContainer.style.display = 'none';
            }
        }
    });
}

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
    currentFeedName = feedName;
    // Determine view mode context
    if (currentViewMode !== 'favorites' && currentViewMode !== 'summary' && currentViewMode !== 'unread') {
        currentViewMode = 'feed';
    }
    currentFeedUrl = url;
    localStorage.setItem('currentFeedUrl', url);
    localStorage.setItem('currentFeedName', feedName);
    localStorage.setItem('currentViewMode', currentViewMode);

    const sidebar = document.getElementById('feed-tree-container');
    if (sidebar && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
    }

    const container = document.getElementById('posts-container');
    container.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><div>Lade Artikel...</div></div>';
    
    // UI Feedback in Sidebar
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-item-row').forEach(el => {
        el.classList.remove('active');
        el.style.background = ''; // Clear legacy inline style
    });
    const activeRow = document.getElementById(`sidebar-feed-${safeId(url)}`);
    if (activeRow) activeRow.classList.add('active');

    try {
        let posts = await getFeedPosts(url, feedName);
        
        // Filter by favorites / summary if in those views
        if (currentViewMode === 'favorites') {
            posts = posts.filter(post => userData.favorited_links.includes(post.link));
        } else if (currentViewMode === 'summary') {
            posts = posts.filter(post => userData.summary_links.includes(post.link));
        } else if (currentViewMode === 'unread') {
            posts = posts.filter(post => !userData.read_links || !userData.read_links.includes(post.link));
        }
        
        // Filter by active date filters
        const { start, end } = getWebSummaryFilters();
        posts = posts.filter(post => {
            if (!post.pubDate) return true;
            const postDate = new Date(post.pubDate);
            if (isNaN(postDate.getTime())) return true;
            if (start && postDate < start) return false;
            if (end && postDate > end) return false;
            return true;
        });

        renderPostsList(posts, feedName, url);

        // Apply active search query in UI (if any)
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value.trim() !== '') {
            handleSearch(searchInput.value);
        }
    } catch (e) { 
        container.innerHTML = `<div style="padding:20px; color:red;">${e.message}</div>`; 
    }
}

function createPostRowElement(post, isToolbarView) {
    const { title, link, desc, thumbnail, pubDate, durationStr, feedName } = post;
    console.log(`[Web Rendering] Creating row for "${title}", thumbnail: ${thumbnail || 'none'}`);
    const row = document.createElement('div'); 
    const isKeywordMatch = post.matchedRules && post.matchedRules.length > 0;
    row.className = 'post-row' + (isKeywordMatch ? ' keyword-match' : '');
    row.dataset.link = link;
    row.postData = post; // Attach post data for search/copy/AI summary
    
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
            
            <!-- Legacy 300 char snippet for summary cart in list mode -->
            <div class="summary-item-description" style="display: ${(currentViewMode === 'summary' && summarySubMode === 'list') ? 'block' : 'none'}; font-size: 13px; color: #aaa; margin: 8px 0; line-height: 1.4;">
                ${desc ? desc.replace(/<[^>]+>/g, ' ').substring(0, 300) + '...' : ''}
            </div>

            <!-- Inline full report view -->
            <div class="report-inline-description" style="display: ${(isToolbarView && summarySubMode === 'report') ? 'block' : 'none'}; margin-top: 15px; font-size: 1.1em; line-height: 1.6; color: #eee;">
                <hr style="border:0; border-top:1px solid #333; margin-bottom:15px;">
                <div class="report-content-body">
                    ${(!post.isFullyLoaded && !link.includes('youtube.com') && !link.includes('youtu.be')) ? '<em>Lade vollständigen Artikel...</em>' : (desc || '')}
                </div>
            </div>

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
        openReader(post);
    };
    row.querySelector('.unread-btn').onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        markAsUnread(link, row);
    };

    if (isToolbarView && summarySubMode === 'report' && !post.isFullyLoaded && !link.includes('youtube.com') && !link.includes('youtu.be')) {
        loadFullInlineContentDirect(post, row);
    }

    return row;
}

function renderPostsList(posts, headerTitle, feedUrl = null) {
    const container = document.getElementById('posts-container');
    if (!container) return;

    const isToolbarView = (currentViewMode === 'summary' || currentViewMode === 'favorites' || currentViewMode === 'all' || currentViewMode === 'feed' || currentViewMode === 'unread' || currentViewMode === 'keywords');

    if (isToolbarView) {
        let headerHtml = `
            <div class="feed-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span>${headerTitle}</span>
                <div style="display:flex; gap:10px;">
                    <button class="action-btn" title="Alle angezeigten Artikel als gelesen markieren" onclick="markFeedAsRead('${feedUrl || ''}')" style="font-size:12px; width:auto; padding:2px 8px; height:24px;">Alle gelesen ✔</button>
                    <button class="action-btn" title="Alle angezeigten Artikel als ungelesen markieren" onclick="markFeedAsUnread('${feedUrl || ''}')" style="font-size:12px; width:auto; padding:2px 8px; height:24px;">Alle ungelesen ↩</button>
                </div>
            </div>`;

        let toolbarHtml = headerHtml + `
            <div id="summary-toolbar">
                <div class="summary-toolbar-section">
                    <select id="web-summary-date-filter">
                        <option value="all" ${summaryDateFilterVal === 'all' ? 'selected' : ''}>Alle Daten</option>
                        <option value="today" ${summaryDateFilterVal === 'today' ? 'selected' : ''}>Heute</option>
                        <option value="7days" ${summaryDateFilterVal === '7days' ? 'selected' : ''}>Letzte 7 Tage</option>
                        <option value="30days" ${summaryDateFilterVal === '30days' ? 'selected' : ''}>Letzte 30 Tage</option>
                        <option value="custom" ${summaryDateFilterVal === 'custom' ? 'selected' : ''}>Benutzerdefiniert...</option>
                    </select>
                    <div id="web-custom-range-container" class="${summaryDateFilterVal === 'custom' ? '' : 'hidden'}">
                        <input type="date" id="web-filter-date-from" value="${filterDateFromVal}">
                        <input type="time" id="web-filter-time-from" value="${filterTimeFromVal}">
                        <span class="range-separator">bis</span>
                        <input type="date" id="web-filter-date-to" value="${filterDateToVal}">
                        <input type="time" id="web-filter-time-to" value="${filterTimeToVal}">
                    </div>
                </div>
                
                <div style="border-left:1px solid var(--border-color); height:20px; margin:0 5px;"></div>
                
                <div class="summary-toolbar-section">
                    <select id="web-export-format">
                        <option value="txt" ${exportFormatVal === 'txt' ? 'selected' : ''}>TXT</option>
                        <option value="markdown" ${exportFormatVal === 'markdown' ? 'selected' : ''}>Markdown</option>
                        <option value="html" ${exportFormatVal === 'html' ? 'selected' : ''}>HTML</option>
                    </select>
                    <button id="web-copy-summary" class="secondary-btn">Kopieren 📋</button>
                    <button id="web-download-summary" class="secondary-btn">Speichern 💾</button>
                </div>
                
                <div style="border-left:1px solid var(--border-color); height:20px; margin:0 5px;"></div>
                
                <div class="summary-toolbar-section">
                    <button id="web-ai-report">Zusammenfassen 🤖</button>
                    <button id="web-full-view-summary" class="secondary-btn">
                        ${summarySubMode === 'list' ? 'Report-Ansicht' : 'Listen-Ansicht'}
                    </button>
                    ${((currentViewMode === 'favorites' || currentViewMode === 'summary' || currentViewMode === 'keywords') && !currentFeedUrl) ? `
                        <button id="web-clear-list" class="delete-btn">
                            ${currentViewMode === 'favorites' ? 'Favoriten leeren 🗑' : (currentViewMode === 'keywords' ? 'Matches leeren 🗑' : 'Liste leeren 🗑')}
                        </button>
                    ` : ''}
                </div>
                <span id="web-copy-status" class="status-message-inline"></span>
            </div>
            <!-- Bulk Summary Prompt Editor Section -->
            <div id="web-ai-prompt-editor-section" class="hidden" style="margin: 10px 15px; padding: 12px; background: #1e1e1e; border: 1px solid var(--border-color, #333); border-radius: 6px;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label for="web-ai-custom-prompt-val" style="font-size: 12px; font-weight: bold; color: var(--text-color-darker, #aaa);">Prompt für diese Sammel-Zusammenfassung anpassen:</label>
                    <div style="display: flex; gap: 10px; align-items: flex-end;">
                        <textarea id="web-ai-custom-prompt-val" rows="2" style="flex: 1; padding: 8px; background: #252525; color: #e8eaed; border: 1px solid #3c4043; border-radius: 6px; font-family: inherit; font-size: 12px; resize: vertical; outline: none; box-sizing: border-box;"></textarea>
                        <button id="web-ai-generate-with-prompt-btn" style="height: 32px; padding: 0 15px; font-weight: bold; background: #3c5c8b; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap;">Zusammenfassung starten 🤖</button>
                    </div>
                </div>
            </div>
            <div id="summary-ai-output" style="display:none; padding:15px 15px 0 15px;"></div>
        `;
        
        container.innerHTML = toolbarHtml;
        
        // Setup toolbar listeners
        const dateFilter = document.getElementById('web-summary-date-filter');
        const customRange = document.getElementById('web-custom-range-container');
        
        dateFilter.onchange = (e) => {
            summaryDateFilterVal = e.target.value;
            if (summaryDateFilterVal === 'custom') {
                customRange.classList.remove('hidden');
            } else {
                customRange.classList.add('hidden');
            }
            if (currentFeedUrl) {
                loadFeedPosts(currentFeedUrl, headerTitle);
            } else {
                showView(currentViewMode);
            }
        };
        
        const dateFrom = document.getElementById('web-filter-date-from');
        const timeFrom = document.getElementById('web-filter-time-from');
        const dateTo = document.getElementById('web-filter-date-to');
        const timeTo = document.getElementById('web-filter-time-to');
        
        [dateFrom, timeFrom, dateTo, timeTo].forEach(el => {
            if (el) {
                el.onchange = () => {
                    filterDateFromVal = dateFrom.value;
                    filterTimeFromVal = timeFrom.value;
                    filterDateToVal = dateTo.value;
                    filterTimeToVal = timeTo.value;
                    if (currentFeedUrl) {
                        loadFeedPosts(currentFeedUrl, headerTitle);
                    } else {
                        showView(currentViewMode);
                    }
                };
            }
        });
        
        const exportFormatSel = document.getElementById('web-export-format');
        if (exportFormatSel) {
            exportFormatSel.onchange = (e) => {
                exportFormatVal = e.target.value;
            };
        }
        
        document.getElementById('web-copy-summary').onclick = copySummaryLinks;
        document.getElementById('web-download-summary').onclick = downloadSummaryLinks;
        const clearListBtn = document.getElementById('web-clear-list');
        if (clearListBtn) {
            clearListBtn.onclick = clearCurrentList;
        }
        document.getElementById('web-ai-report').onclick = () => {
            const editorSection = document.getElementById('web-ai-prompt-editor-section');
            if (editorSection) {
                editorSection.classList.remove('hidden');
            }
            const outputContainer = document.getElementById('summary-ai-output');
            if (outputContainer) {
                outputContainer.innerHTML = '<p style="color: #eee; font-style: italic; margin-top: 15px;">Passe den Prompt bei Bedarf oben an und klicke auf "Zusammenfassung starten 🤖", um fortzufahren.</p>';
                outputContainer.style.display = 'block';
            }
        };

        const webAiGenerateWithPromptBtn = document.getElementById('web-ai-generate-with-prompt-btn');
        if (webAiGenerateWithPromptBtn) {
            webAiGenerateWithPromptBtn.onclick = generateAiSummary;
        }
        
        const webAiCustomPromptVal = document.getElementById('web-ai-custom-prompt-val');
        if (webAiCustomPromptVal) {
            const customAiPrompt = localStorage.getItem('gemini_ai_prompt') || '';
            webAiCustomPromptVal.value = customAiPrompt && customAiPrompt.trim() !== ''
                ? customAiPrompt.trim()
                : "Create a coherent, well-structured summary report in Markdown format based on the following articles. Group related topics if applicable, and highlight the most important takeaways. Use German language for the summary:";
        }
        
        const fullViewBtn = document.getElementById('web-full-view-summary');
        if (fullViewBtn) {
            fullViewBtn.onclick = () => {
                summarySubMode = (summarySubMode === 'list') ? 'report' : 'list';
                fullViewBtn.innerText = (summarySubMode === 'list') ? 'Report-Ansicht' : 'Listen-Ansicht';
                
                document.querySelectorAll('.report-inline-description').forEach(el => {
                    el.style.display = (summarySubMode === 'report') ? 'block' : 'none';
                });
                
                document.querySelectorAll('.summary-item-description').forEach(el => {
                    el.style.display = (summarySubMode === 'list') ? 'block' : 'none';
                });

                if (summarySubMode === 'report') {
                    document.querySelectorAll('.post-row').forEach(row => {
                        const post = row.postData;
                        if (post && !post.isFullyLoaded && !post.link.includes('youtube.com') && !post.link.includes('youtu.be')) {
                            const contentBody = row.querySelector('.report-content-body');
                            if (contentBody) {
                                contentBody.innerHTML = '<em>Lade vollständigen Artikel...</em>';
                            }
                            loadFullInlineContentDirect(post, row);
                        }
                    });
                }
            };
        }
        
        if (!posts || posts.length === 0) {
            const noPostsDiv = document.createElement('div');
            noPostsDiv.style.cssText = "padding:40px; text-align:center; color:#888;";
            noPostsDiv.innerText = currentViewMode === 'favorites' ? "Keine Artikel in deinen Favoriten." : (currentViewMode === 'keywords' ? "Keine Artikel entsprechen deinen Keyword-Regeln." : (currentViewMode === 'all' ? "Keine Artikel vorhanden." : (currentViewMode === 'feed' ? "Keine Artikel in diesem Kanal gefunden." : "Keine Artikel in der Zusammenfassungsliste.")));
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
            <span>${headerTitle}</span>
            <div style="display:flex; gap:10px;">
                <button class="action-btn" title="Alle angezeigten Artikel als gelesen markieren" onclick="markFeedAsRead('${feedUrl || ''}')" style="font-size:12px; width:auto; padding:2px 8px; height:24px;">Alle gelesen ✔</button>
                <button class="action-btn" title="Alle angezeigten Artikel als ungelesen markieren" onclick="markFeedAsUnread('${feedUrl || ''}')" style="font-size:12px; width:auto; padding:2px 8px; height:24px;">Alle ungelesen ↩</button>
            </div>
        </div>`;
        container.innerHTML = headerHtml;
    }

    if (currentViewMode === 'keywords') {
        const rules = getWebRules();
        const postsByRule = {};
        posts.forEach(post => {
            if (post.matchedRules) {
                post.matchedRules.forEach(match => {
                    if (!postsByRule[match.id]) postsByRule[match.id] = [];
                    if (!postsByRule[match.id].some(p => p.link === post.link)) {
                        postsByRule[match.id].push(post);
                    }
                });
            }
        });

        const processedRuleIds = new Set();
        
        const renderRuleSection = (ruleId, label) => {
            const rulePosts = postsByRule[ruleId];
            if (!rulePosts || rulePosts.length === 0) return;
            
            rulePosts.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            
            const section = document.createElement('div');
            section.className = 'feed-section';
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'feed-title';
            titleDiv.innerHTML = label;
            section.appendChild(titleDiv);
            
            rulePosts.forEach(post => {
                const row = createPostRowElement(post, isToolbarView);
                section.appendChild(row);
            });
            
            container.appendChild(section);
            processedRuleIds.add(ruleId);
        };
        
        // Zuerst nach den vorgegebenen Regeln sortiert
        rules.forEach(rule => {
            const label = `Regel: WENN <strong>${rule.field}</strong> ${rule.condition.replace('-', ' ')} <code>${rule.value}</code>`;
            renderRuleSection(rule.id, label);
        });
        
        // Dann eventuell gelöschte Regeln
        for (const ruleId in postsByRule) {
            if (!processedRuleIds.has(ruleId)) {
                renderRuleSection(ruleId, `Matches für eine gelöschte Regel`);
            }
        }
    } else {
        posts.forEach(post => {
            const row = createPostRowElement(post, isToolbarView);
            container.appendChild(row);
        });
    }

    filterSidebarFeeds();
}

async function markFeedAsUnread(feedUrl) {
    const rows = document.querySelectorAll('.post-row');
    let changed = false;
    let unreadCountAdded = 0;
    
    rows.forEach(row => {
        if (row.style.display === 'none') return;
        const link = row.dataset.link;
        if (link && userData.read_links.includes(link)) {
            userData.read_links = userData.read_links.filter(l => l !== link);
            row.style.opacity = '1';
            const title = row.querySelector('.post-title');
            if (title) title.style.fontWeight = '600';
            const unreadBtn = row.querySelector('.unread-btn');
            if (unreadBtn) unreadBtn.style.display = 'none';
            changed = true;
            unreadCountAdded++;
        }
    });

    if (changed) {
        if (feedUrl && feedUrl !== 'null' && feedUrl !== '') {
            const countEl = document.querySelector(`#sidebar-feed-${safeId(feedUrl)} .unread-count`);
            if (countEl) {
                const posts = globalPostsCache[feedUrl] || [];
                const unreadCount = posts.filter(p => !userData.read_links.includes(p.link)).length;
                countEl.innerText = unreadCount;
                countEl.style.setProperty('display', 'inline-block', 'important');
                countEl.style.backgroundColor = '#4a90e2';
            }
        } else {
            calculateAllUnreadCounts();
        }

        try {
            await updateCloudSettings({ read_links: userData.read_links });
        } catch (e) { console.error("Sync Mark Feed As Unread Error:", e); }
    }
    updateSidebarTreeForUnread();
}

async function markFeedAsRead(feedUrl) {
    const rows = document.querySelectorAll('.post-row');
    let changed = false;
    rows.forEach(row => {
        if (row.style.display === 'none') return;
        const link = row.dataset.link;
        if (link && !userData.read_links.includes(link)) {
            userData.read_links.push(link);
            row.style.opacity = '0.5';
            const title = row.querySelector('.post-title');
            if (title) title.style.fontWeight = 'normal';
            const unreadBtn = row.querySelector('.unread-btn');
            if (unreadBtn) unreadBtn.style.display = 'flex';
            changed = true;
        }
    });

    if (changed) {
        if (feedUrl && feedUrl !== 'null' && feedUrl !== '') {
            const countEl = document.querySelector(`#sidebar-feed-${safeId(feedUrl)} .unread-count`);
            if (countEl) countEl.style.display = 'none';
        } else {
            calculateAllUnreadCounts();
        }

        try {
            await updateCloudSettings({ read_links: userData.read_links });
        } catch (e) { console.error("Sync Mark Feed As Read Error:", e); }
    }
    updateSidebarTreeForUnread();
}

async function markAllAsRead() {
    let changed = false;
    for (const url in globalPostsCache) {
        const posts = globalPostsCache[url] || [];
        posts.forEach(post => {
            if (post.link && !userData.read_links.includes(post.link)) {
                userData.read_links.push(post.link);
                changed = true;
            }
        });
    }

    const rows = document.querySelectorAll('.post-row');
    rows.forEach(row => {
        const link = row.dataset.link;
        if (link) {
            row.style.opacity = '0.5';
            const title = row.querySelector('.post-title');
            if (title) title.style.fontWeight = 'normal';
            const unreadBtn = row.querySelector('.unread-btn');
            if (unreadBtn) unreadBtn.style.display = 'flex';
        }
    });

    document.querySelectorAll('#feed-list-items .unread-count').forEach(countEl => {
        countEl.style.display = 'none';
        countEl.innerText = '0';
    });

    if (changed || rows.length > 0) {
        try {
            await updateCloudSettings({ read_links: userData.read_links });
        } catch (e) { console.error("Sync Mark All Read Error:", e); }
    }
    updateSidebarTreeForUnread();
    filterSidebarFeeds();
}

async function markAllAsUnread() {
    userData.read_links = [];

    const rows = document.querySelectorAll('.post-row');
    rows.forEach(row => {
        row.style.opacity = '1';
        const title = row.querySelector('.post-title');
        if (title) title.style.fontWeight = '600';
        const unreadBtn = row.querySelector('.unread-btn');
        if (unreadBtn) unreadBtn.style.display = 'none';
    });

    const feeds = [];
    function walk(nodes) { nodes.forEach(n => { if (n.type === 'feed' && n.url) feeds.push(n); if (n.children) walk(n.children); }); }
    walk(userData.feed_tree);
    
    feeds.forEach(feed => {
        const id = safeId(feed.url);
        const countEl = document.querySelector(`#sidebar-feed-${id} .unread-count`);
        if (countEl) {
            const posts = globalPostsCache[feed.url] || [];
            if (posts.length > 0) {
                countEl.innerText = posts.length;
                countEl.style.setProperty('display', 'inline-block', 'important');
                countEl.style.backgroundColor = '#4a90e2';
            } else {
                countEl.style.display = 'none';
            }
        }
    });

    try {
        await updateCloudSettings({ read_links: userData.read_links });
    } catch (e) { console.error("Sync Mark All Unread Error:", e); }

    updateSidebarTreeForUnread();
    filterSidebarFeeds();
    
    calculateAllUnreadCounts();
}

async function markAsUnread(link, row) {
    userData.read_links = userData.read_links.filter(l => l !== link);
    row.style.opacity = '1';
    const title = row.querySelector('.post-title');
    if (title) title.style.fontWeight = '600';
    
    const unreadBtn = row.querySelector('.unread-btn, .mark-unread-btn');
    if (unreadBtn) unreadBtn.style.display = 'none';

    if (row.classList.contains('post-item')) {
        row.classList.remove('read');
    }

    if (currentFeedUrl) {
        const countEl = document.querySelector(`#sidebar-feed-${safeId(currentFeedUrl)} .unread-count`);
        if (countEl) {
            let count = parseInt(countEl.innerText) || 0;
            countEl.innerText = count + 1;
            countEl.style.display = 'inline-block';
        }
    }

    try {
        await updateCloudSettings({ read_links: userData.read_links });
    } catch (e) { console.error("Sync Mark As Unread Error:", e); }
    updateSidebarTreeForUnread();
}

async function markAsRead(link) {
    if (!userData.read_links.includes(link)) {
        userData.read_links.push(link);
        
        const rows = document.querySelectorAll('.post-row, .post-item');
        rows.forEach(row => {
            if (row.dataset.link === link) {
                row.style.opacity = '0.5';
                const title = row.querySelector('.post-title');
                if (title) title.style.fontWeight = 'normal';
                
                const unreadBtn = row.querySelector('.unread-btn, .mark-unread-btn');
                if (unreadBtn) {
                    if (row.classList.contains('post-item')) {
                        unreadBtn.style.display = 'inline-block';
                    } else {
                        unreadBtn.style.display = 'flex';
                    }
                }
                
                if (row.classList.contains('post-item')) {
                    row.classList.add('read');
                }
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
            await updateCloudSettings({ read_links: userData.read_links });
        } catch (e) { console.error("Sync Read Status Error:", e); }
        updateSidebarTreeForUnread();
    }
}

async function toggleFavorite(link, btn) {
    const isFav = userData.favorited_links.includes(link);
    const starBtn = btn;
    if (isFav) {
        userData.favorited_links = userData.favorited_links.filter(l => l !== link);
        
        starBtn.innerText = '☆';
        starBtn.classList.remove('favorited');
        starBtn.style.setProperty('color', 'white', 'important');
        
        if (currentViewMode === 'favorites') {
            const row = starBtn.closest('.post-row, .post-item');
            if (row) {
                row.style.transition = 'opacity 0.3s, max-height 0.3s';
                row.style.opacity = '0';
                setTimeout(() => { row.remove(); }, 300);
            }
        }
    } else {
        userData.favorited_links.push(link);
        
        starBtn.innerText = '★';
        starBtn.classList.add('favorited');
        starBtn.style.setProperty('color', 'gold', 'important');
    }

    try {
        await updateCloudSettings({ favorited_links: userData.favorited_links });
    } catch (e) { console.error("Sync Favorite Error:", e); }
}

async function toggleSummary(link, btn) {
    if (!userData.summary_links) userData.summary_links = [];
    const isSum = userData.summary_links.includes(link);
    const sumBtn = btn;
    if (isSum) {
        userData.summary_links = userData.summary_links.filter(l => l !== link);
        
        sumBtn.classList.remove('active');
        sumBtn.style.setProperty('filter', 'grayscale(1)', 'important');
        
        if (currentViewMode === 'summary') {
            const row = sumBtn.closest('.post-row, .post-item');
            if (row) {
                row.style.transition = 'opacity 0.3s, max-height 0.3s';
                row.style.opacity = '0';
                setTimeout(() => { row.remove(); }, 300);
            }
        }
    } else {
        userData.summary_links.push(link);
        
        sumBtn.classList.add('active');
        sumBtn.style.setProperty('filter', 'sepia(1) saturate(5) hue-rotate(90deg)', 'important');
    }

    try {
        await updateCloudSettings({ summary_links: userData.summary_links });
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
    
    const postsToSummarize = getCurrentlyFilteredWebPosts();
    if (postsToSummarize.length === 0) {
        alert("Deine Zusammenfassungsliste ist leer oder es entsprechen keine Artikel den Filtern.");
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
        const webAiCustomPromptVal = document.getElementById('web-ai-custom-prompt-val');
        let promptText = webAiCustomPromptVal && webAiCustomPromptVal.value.trim() !== ''
            ? webAiCustomPromptVal.value.trim() + "\n\n"
            : "Create a coherent, well-structured summary report in Markdown format based on the following articles. Group related topics if applicable, and highlight the most important takeaways. Use German language for the summary:\n\n";
        
        postsToSummarize.forEach((post, index) => {
            promptText += `### Article ${index + 1}: ${post.title}\n`;
            promptText += `Link: ${post.link}\n`;
            const cleanDesc = (post.desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1000);
            promptText += `Content info: ${cleanDesc}\n\n`;
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
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:10px; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                    <strong style="color:#ff9800; font-size:16px;">🤖 KI-Zusammenfassung (Gemini)</strong>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <select id="bulk-export-ai-format" title="Export Format" style="padding: 5px 10px; border-radius: 4px; border: 1px solid #444; background: #252525; color: white; font-size:12px;">
                            <option value="markdown">Markdown</option>
                            <option value="txt">TXT</option>
                            <option value="html">HTML</option>
                        </select>
                        <button class="action-btn" id="bulk-copy-ai-report-btn" style="width:auto; padding:5px 12px; font-size:12px; height:auto;" title="Kopieren">Kopieren 📋</button>
                        <button class="action-btn" id="bulk-download-ai-report-btn" style="width:auto; padding:5px 12px; font-size:12px; height:auto;" title="Speichern">Speichern 💾</button>
                        <button class="action-btn" id="bulk-close-ai-report-btn" style="width:auto; padding:5px 12px; font-size:12px; height:auto;" title="Schließen">Schließen ✖</button>
                    </div>
                </div>
                <div id="ai-report-body" class="ai-report-body" style="color:#eee; font-size:14px; overflow-y:auto; max-height:400px; text-align:left;">${htmlContent}</div>
            </div>
        `;
        
        document.getElementById('bulk-close-ai-report-btn').onclick = () => {
            outputContainer.style.display = 'none';
        };

        document.getElementById('bulk-copy-ai-report-btn').onclick = async () => {
            const aiFormat = document.getElementById('bulk-export-ai-format').value;
            let exportText = markdownReport;
            if (aiFormat === 'html') {
                exportText = window.marked ? window.marked.parse(markdownReport) : markdownReport;
            } else if (aiFormat === 'txt') {
                exportText = markdownReport.replace(/[*#_`-]/g, '');
            }
            try {
                await navigator.clipboard.writeText(exportText);
                alert("Zusammenfassungsbericht in die Zwischenablage kopiert!");
            } catch(err) {
                console.error("Kopieren fehlgeschlagen:", err);
            }
        };

        document.getElementById('bulk-download-ai-report-btn').onclick = () => {
            const aiFormat = document.getElementById('bulk-export-ai-format').value;
            let exportText = markdownReport;
            let extension = 'md';
            let mimeType = 'text/markdown';
            if (aiFormat === 'html') {
                exportText = window.marked ? window.marked.parse(markdownReport) : markdownReport;
                extension = 'html';
                mimeType = 'text/html';
            } else if (aiFormat === 'txt') {
                exportText = markdownReport.replace(/[*#_`-]/g, '');
                extension = 'txt';
                mimeType = 'text/plain';
            }
            const date = new Date();
            const datePart = date.toISOString().split('T')[0];
            const timePart = date.toTimeString().split(' ')[0].replace(/:/g, '-');
            const fileName = `puretidings-ai-summary-${datePart}_${timePart}.${extension}`;
            const blob = new Blob([exportText], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
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
    const posts = getCurrentlyFilteredWebPosts();
    if (posts.length === 0) {
        alert("Deine Zusammenfassungsliste ist leer oder es entsprechen keine Artikel den Filtern.");
        return;
    }
    
    const format = exportFormatVal;
    const content = generateWebSummaryContent(posts, format, summarySubMode);
    
    try {
        await navigator.clipboard.writeText(content);
        showWebCopyStatus(`Als ${format.toUpperCase()} kopiert!`, 'success');
    } catch (err) {
        console.error('Kopieren fehlgeschlagen: ', err);
        showWebCopyStatus("Kopieren fehlgeschlagen.", 'error');
    }
}

async function clearCurrentList() {
    if (currentViewMode === 'favorites') {
        if (!confirm("Bist du sicher, dass du alle deine Favoriten löschen möchtest?")) return;
        userData.favorited_links = [];
        
        const container = document.getElementById('posts-container');
        const rows = container.querySelectorAll('.post-row, .post-item');
        rows.forEach(row => {
            row.style.transition = 'opacity 0.3s, max-height 0.3s';
            row.style.opacity = '0';
        });
        setTimeout(() => { renderPostsList([], "Favorites"); }, 300);
        
        try {
            await updateCloudSettings({ favorited_links: [] });
        } catch(e) { console.error("Sync Favorites Clear Error:", e); }
    } else if (currentViewMode === 'keywords') {
        if (!confirm("Bist du sicher, dass du alle Keyword-Matches löschen (ausblenden) möchtest?")) return;
        
        const currentlyFilteredPosts = getCurrentlyFilteredWebPosts();
        const currentlyFilteredLinks = currentlyFilteredPosts.map(p => p.link);
        
        const hiddenLinks = getHiddenKeywordLinks();
        currentlyFilteredLinks.forEach(link => {
            if (!hiddenLinks.includes(link)) {
                hiddenLinks.push(link);
            }
        });
        saveHiddenKeywordLinks(hiddenLinks);
        
        const container = document.getElementById('posts-container');
        const rows = container.querySelectorAll('.post-row, .post-item');
        rows.forEach(row => {
            row.style.transition = 'opacity 0.3s, max-height 0.3s';
            row.style.opacity = '0';
        });
        setTimeout(() => { renderPostsList([], "Keyword Matches"); }, 300);
    } else {
        await clearSummaryList();
    }
}

async function clearSummaryList() {
    if (!confirm("Bist du sicher, dass du die gesamte Zusammenfassungsliste leeren möchtest?")) return;
    
    userData.summary_links = [];
    const container = document.getElementById('posts-container');
    
    const rows = container.querySelectorAll('.post-row, .post-item');
    rows.forEach(row => {
        row.style.transition = 'opacity 0.3s, max-height 0.3s';
        row.style.opacity = '0';
    });
    
    setTimeout(() => {
        renderPostsList([], "Summary List");
    }, 300);
    
    try {
        await updateCloudSettings({ summary_links: [] });
    } catch(e) {
        console.error("Sync Summary Clear Error:", e);
    }
}

async function getYouTubeTranscript(url) {
    let videoId = '';
    if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1].split('?')[0];
    } else if (url.includes('youtube.com/watch')) {
        try {
            videoId = new URL(url).searchParams.get('v');
        } catch (e) {
            const match = url.match(/[?&]v=([^&#]+)/);
            videoId = match ? match[1] : '';
        }
    } else if (url.includes('youtube.com/shorts/')) {
        videoId = url.split('youtube.com/shorts/')[1].split('?')[0];
    }

    if (!videoId) return { status: 'error', message: 'Video-ID konnte nicht extrahiert werden.' };

    const extensionId = 'faeeldkkipajnnbkajhdanhbhilfifah';

    // 1. VERSUCH: Direkte Anfrage an die installierte Chrome Extension (vollkommen unblockiert & sicher)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            const extResponse = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Timeout bei Verbindung zur Extension")), 1500);
                chrome.runtime.sendMessage(extensionId, { action: "fetchYoutubeTranscript", videoId: videoId }, (res) => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(res);
                    }
                });
            });

            if (extResponse && extResponse.status === 'ok' && extResponse.xml) {
                console.log("Transkript erfolgreich über die Chrome Extension geladen!");
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(extResponse.xml, "text/xml");
                let textNodes = Array.from(xmlDoc.getElementsByTagName('p'));
                if (textNodes.length === 0) {
                    textNodes = Array.from(xmlDoc.getElementsByTagName('text'));
                }
                if (textNodes.length > 0) {
                    const texts = textNodes.map(t => t.textContent.replace(/<[^>]+>/g, ''));
                    const text = texts.join(' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').substring(0, 50000);
                    return { status: 'ok', text: text };
                }
            }
        } catch (err) {
            console.log("Extension nicht erreichbar oder hat geantwortet mit Fehler. Verwende Fallback-Proxy. Details:", err.message);
        }
    }

    // 2. FALLBACK: Über den Supabase-Proxy fetch-feed per InnerTube API
    try {
        const proxyUrl = 'https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed';
        const sessionRes = await db.auth.getSession();
        const session = sessionRes.data?.session;
        if (!session) throw new Error("Keine aktive Sitzung");

        const innerTubeUrl = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
        const innerTubePayload = {
            context: {
                client: {
                    clientName: 'ANDROID',
                    clientVersion: '20.10.38'
                }
            },
            videoId: videoId
        };

        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                url: innerTubeUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
                },
                body: innerTubePayload
            })
        });

        if (!response.ok) return { status: 'error', message: `Fehler beim Laden der YouTube-Daten über den Proxy (Status ${response.status}).` };
        const data = await response.json();
        if (data.error) {
            return { status: 'error', message: `Proxy-Fehler: ${data.error}` };
        }

        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks || tracks.length === 0) return { status: 'not_found', message: 'Für dieses Video existiert kein Skript (keine Untertitel auf YouTube vorhanden).' };

        let track = tracks.find(t => t.languageCode === 'de') || tracks.find(t => t.languageCode === 'en') || tracks[0];
        if (!track || !track.baseUrl) return { status: 'not_found', message: 'Für dieses Video existiert kein Skript (keine auslesbare Untertitel-Spur gefunden).' };

        const tResponse = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ url: track.baseUrl })
        });

        if (!tResponse.ok) return { status: 'error', message: 'Skript existiert auf YouTube, konnte aber nicht ausgelesen werden.' };
        const xmlText = await tResponse.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        let textNodes = Array.from(xmlDoc.getElementsByTagName('p'));
        if (textNodes.length === 0) {
            textNodes = Array.from(xmlDoc.getElementsByTagName('text'));
        }

        if (textNodes.length > 0) {
            const texts = textNodes.map(t => t.textContent.replace(/<[^>]+>/g, ''));
            const text = texts.join(' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').substring(0, 50000);
            return { status: 'ok', text: text };
        } else {
            return { status: 'error', message: 'Skript existiert auf YouTube, das Format konnte aber nicht ausgelesen werden.' };
        }
    } catch (e) {
        console.error("Fehler beim Abrufen des YouTube-Transkripts über Proxy:", e);
        return { status: 'error', message: `Fehler beim Auslesen des Skripts: ${e.message}` };
    }
}

async function tryExtensionFetch(url) {
    const extensionId = 'faeeldkkipajnnbkajhdanhbhilfifah';
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            const extResponse = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Timeout bei Verbindung zur Extension")), 3000);
                chrome.runtime.sendMessage(extensionId, { action: "proxyFetch", url: url }, (res) => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(res);
                    }
                });
            });
            if (extResponse && extResponse.status === 'ok') {
                return extResponse.text;
            } else if (extResponse && extResponse.status === 'error') {
                throw new Error(extResponse.message || "Fehler beim Abrufen über Extension");
            }
        } catch (err) {
            console.log("Extension nicht erreichbar oder Fehler bei proxyFetch. Details:", err.message);
        }
    }
    return null;
}

async function fetchViaExtensionOrProxy(url) {
    // 1. Try Extension first
    const extHtml = await tryExtensionFetch(url);
    if (extHtml !== null) {
        console.log(`[Proxy] Successfully fetched url via Extension: ${url}`);
        return extHtml;
    }

    // 2. Fallback to Supabase Proxy
    console.log(`[Proxy] Extension fetch failed or unavailable, falling back to Supabase Proxy for: ${url}`);
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch('https://lujvogyndoryofuffntr.supabase.co/functions/v1/fetch-feed', { 
        method: 'POST', 
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
        }, 
        body: JSON.stringify({ url }) 
    });
    if (!res.ok) throw new Error("HTTP-Fehler " + res.status);
    return await res.text();
}

async function openReader(post) {
    const overlay = document.getElementById('reader-overlay');
    const body = document.getElementById('reader-body');
    overlay.style.display = 'block'; document.body.style.overflow = 'hidden';
    
    const isYouTube = post.link.includes('youtube.com') || post.link.includes('youtu.be');

    const isFav = userData.favorited_links.includes(post.link);
    const isSum = userData.summary_links && userData.summary_links.includes(post.link);

    body.innerHTML = `
        <!-- Reader Toolbar -->
        <div id="reader-toolbar" style="display:flex; align-items:center; gap:8px; margin-bottom:20px; border-bottom:1px solid #e8eaed; padding-bottom:15px; flex-wrap:wrap;">
            <select id="reader-export-format" style="background:#252525; border:1px solid #3c4043; color:#e8eaed; padding:0 10px; border-radius:4px; font-size:12px; cursor:pointer; outline:none; height:28px; width:auto !important; min-width:80px;">
                <option value="txt">TXT</option>
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
            </select>
            <button id="reader-copy-btn" style="background:#2a2a2a; border:1px solid #3d3d3d; color:#fff; padding:0 12px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:bold; height:28px; display:inline-flex; align-items:center; justify-content:center;">Copy</button>
            <button id="reader-save-btn" style="background:#2a2a2a; border:1px solid #3d3d3d; color:#fff; padding:0 12px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:bold; height:28px; display:inline-flex; align-items:center; justify-content:center;">Save</button>
            <button id="reader-star-btn" style="background:transparent; border:1px solid #555; color:${isFav ? 'gold' : 'white'}; border-radius:4px; font-size:14px; cursor:pointer; width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; padding:0;" title="Add to favorites">${isFav ? '★' : '☆'}</button>
            <button id="reader-summary-btn" style="background:transparent; border:1px solid #555; border-radius:4px; font-size:14px; cursor:pointer; width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; padding:0; filter:${isSum ? 'sepia(1) saturate(5) hue-rotate(90deg)' : 'grayscale(1)'};" title="Add to summary cart">📋</button>
            <button id="reader-ai-summary-btn" style="background:#2a2a2a; border:1px solid #3d3d3d; color:#fff; padding:0 12px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:bold; height:28px; display:inline-flex; align-items:center; justify-content:center;">AI Summary</button>
            <span id="reader-copy-status" style="font-size:12px; margin-left:8px;"></span>
        </div>

        <!-- Reader AI Report Container -->
        <div id="reader-ai-report-container" class="hidden" style="margin-bottom: 20px; padding: 20px; background: #1e1e1e; border-radius: 8px; border: 1px solid #333;">
           <div class="ai-report-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
               <h3 style="margin: 0; color: #ff9800; font-size: 16px;">AI Summary</h3>
               <div style="display: flex; align-items: center; gap: 10px;">
                   <select id="reader-export-ai-format" title="Export Format" style="padding: 5px 10px; border-radius: 4px; border: 1px solid #444; background: #252525; color: white; font-size:12px;">
                     <option value="txt">TXT</option>
                     <option value="markdown">Markdown</option>
                     <option value="html">HTML</option>
                   </select>
                   <button id="reader-copy-ai-report-btn" class="secondary-btn" style="background:#2a2a2a; border:1px solid #3d3d3d; color:#fff; padding:5px 12px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:bold;">Copy</button>
                   <button id="reader-download-ai-report-btn" class="secondary-btn" style="background:#2a2a2a; border:1px solid #3d3d3d; color:#fff; padding:5px 12px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:bold;">Save</button>
                   <button id="reader-close-ai-report-btn" class="secondary-btn" style="background:#2a2a2a; border:1px solid #3d3d3d; color:#fff; padding:5px 12px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:bold; margin-left: 10px;">Close</button>
               </div>
           </div>
           
           <!-- Prompt Editor Section -->
           <div id="reader-ai-prompt-editor-section" style="margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 12px;">
               <div style="display: flex; flex-direction: column; gap: 8px;">
                   <label for="reader-ai-custom-prompt-val" style="font-size: 12px; font-weight: bold; color: var(--text-color-darker, #aaa);">Prompt für diese Zusammenfassung anpassen:</label>
                   <div style="display: flex; gap: 10px; align-items: flex-end;">
                       <textarea id="reader-ai-custom-prompt-val" rows="2" style="flex: 1; padding: 8px; background: #252525; color: #e8eaed; border: 1px solid #3c4043; border-radius: 6px; font-family: inherit; font-size: 12px; resize: vertical; outline: none;"></textarea>
                       <button id="reader-ai-generate-with-prompt-btn" style="height: 32px; padding: 0 15px; font-weight: bold; background: #3c5c8b; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Generieren 🤖</button>
                   </div>
               </div>
           </div>

           <div id="reader-ai-report-content" class="ai-report-body" style="line-height: 1.6; font-size: 14px; white-space: pre-wrap; color: #eee;"></div>
        </div>

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

    // Setup Toolbar Button Handlers
    const starBtn = body.querySelector('#reader-star-btn');
    starBtn.onclick = async () => {
        const index = userData.favorited_links.indexOf(post.link);
        if (index > -1) {
            userData.favorited_links.splice(index, 1);
            starBtn.style.color = 'white';
            starBtn.innerText = '☆';
        } else {
            userData.favorited_links.push(post.link);
            starBtn.style.color = 'gold';
            starBtn.innerText = '★';
        }
        document.querySelectorAll('.post-row, .post-item').forEach(row => {
            if (row.dataset.link === post.link) {
                const rowFavBtn = row.querySelector('.fav-btn');
                if (rowFavBtn) rowFavBtn.style.color = (index > -1) ? 'white' : 'gold';
            }
        });
        try {
            await updateCloudSettings({ favorited_links: userData.favorited_links });
        } catch(e) { console.error("Star Sync Error:", e); }
    };

    const summaryBtn = body.querySelector('#reader-summary-btn');
    summaryBtn.onclick = async () => {
        const index = userData.summary_links.indexOf(post.link);
        if (index > -1) {
            userData.summary_links.splice(index, 1);
            summaryBtn.style.filter = 'grayscale(1)';
        } else {
            userData.summary_links.push(post.link);
            summaryBtn.style.filter = 'sepia(1) saturate(5) hue-rotate(90deg)';
        }
        document.querySelectorAll('.post-row, .post-item').forEach(row => {
            if (row.dataset.link === post.link) {
                const rowSumBtn = row.querySelector('.sum-btn');
                if (rowSumBtn) rowSumBtn.style.filter = (index > -1) ? 'grayscale(1)' : 'sepia(1) saturate(5) hue-rotate(90deg)';
            }
        });
        try {
            await updateCloudSettings({ summary_links: userData.summary_links });
        } catch(e) { console.error("Summary Sync Error:", e); }
    };

    const copyBtn = body.querySelector('#reader-copy-btn');
    copyBtn.onclick = async () => {
        const format = body.querySelector('#reader-export-format').value;
        const content = generateReaderArticleContent(post, format, true);
        try {
            await navigator.clipboard.writeText(content);
            const status = body.querySelector('#reader-copy-status');
            status.textContent = `Als ${format.toUpperCase()} kopiert!`;
            status.style.color = 'green';
            setTimeout(() => status.textContent = '', 3000);
        } catch (err) {
            console.error(err);
        }
    };

    const saveBtn = body.querySelector('#reader-save-btn');
    saveBtn.onclick = () => {
        const format = body.querySelector('#reader-export-format').value;
        const content = generateReaderArticleContent(post, format, false);
        const mimeType = format === 'html' ? 'text/html' : (format === 'markdown' ? 'text/markdown' : 'text/plain');
        const extension = format === 'html' ? 'html' : (format === 'markdown' ? 'md' : 'txt');
        const fileName = (post.title.substring(0, 50).replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'article') + '.' + extension;
        
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const aiSummaryBtn = body.querySelector('#reader-ai-summary-btn');
    const aiReportContainer = body.querySelector('#reader-ai-report-container');
    const aiReportContent = body.querySelector('#reader-ai-report-content');
    
    const aiCustomPromptVal = body.querySelector('#reader-ai-custom-prompt-val');
    const aiGenerateWithPromptBtn = body.querySelector('#reader-ai-generate-with-prompt-btn');

    async function runAiSummaryGeneration() {
        const geminiApiKey = localStorage.getItem('gemini_api_key') || '';
        if (!geminiApiKey || geminiApiKey.trim() === '') {
            alert("Bitte hinterlege zuerst deinen Google Gemini API Key in den Einstellungen (Zahnrad-Symbol oben rechts).");
            return;
        }

        aiSummaryBtn.innerText = 'Wird geladen...';
        aiSummaryBtn.disabled = true;
        aiGenerateWithPromptBtn.innerText = 'Wird geladen...';
        aiGenerateWithPromptBtn.disabled = true;
        aiReportContainer.classList.remove('hidden');
        aiReportContent.innerHTML = '<p><em>Beitrag wird analysiert... bitte warten.</em></p>';

        try {
            let promptText = "";
            let contentText = "";

            const customPrompt = aiCustomPromptVal.value.trim();

            if (isYouTube) {
                aiReportContent.innerHTML = '<p><em>Hole Video-Skript (Transkript) und analysiere Video... bitte warten.</em></p>';
                if (customPrompt && customPrompt !== '') {
                    promptText = customPrompt + "\n\n";
                } else {
                    promptText = "You are an assistant that summarizes YouTube videos. Generate a response in German that is clearly divided into two distinct sections using these exact Markdown headings:\n\n";
                    promptText += "### 📝 Zusammenfassung aus der Videobeschreibung\n[Provide a concise summary of the video's description text here]\n\n";
                    promptText += "### 🎥 Zusammenfassung aus dem Video-Skript\n[Provide a concise summary and 3-5 key takeaways in bullet points based on the transcript (script) of the video here]\n\n";
                    promptText += "If both description and transcript are provided, you MUST show both sections. If the transcript is not available, still display both headers but under the script header write: 'Kein Video-Skript (Transkript) verfügbar. Zusammenfassung basiert nur auf der Beschreibung.' Ignore advertisements or sponsor mentions in the text.\n\n";
                }
                promptText += `### Video Title: ${post.title}\n`;
                promptText += `URL: ${post.link}\n\n`;

                const description = (post.desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 10000);
                let transcriptResult = null;
                try {
                    transcriptResult = await getYouTubeTranscript(post.link);
                } catch (e) {
                    console.error("Transkript-Fehler in AI-Summary:", e);
                    transcriptResult = { status: 'error', message: `Fehler beim Auslesen des Skripts: ${e.message}` };
                }

                contentText = `[Video Description / Beschreibung des Videos]:\n${description}\n\n`;
                if (transcriptResult && transcriptResult.status === 'ok') {
                    contentText += `[Video Script / Transkript]:\n${transcriptResult.text}\n\n`;
                } else {
                    const failMsg = transcriptResult ? transcriptResult.message : 'Skript konnte nicht geladen werden.';
                    contentText += `(Note: Video transcript is not available because: ${failMsg}. Summarizing based on description only. Please write under the video script header the exact reason: "${failMsg}")\n\n`;
                }
            } else {
                if (customPrompt && customPrompt !== '') {
                    promptText = customPrompt + "\n\n";
                } else {
                    promptText = "Provide a concise summary and highlight the key takeaways of the following article in Markdown format. Use German language for the summary.\n\n";
                }
                promptText += `### Article: ${post.title}\n`;
                promptText += `URL: ${post.link}\n\n`;

                const bodyText = (post.desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 8000);
                contentText = bodyText;
            }

            promptText += `Content:\n${contentText}\n\n`;

            const modelsToTry = await getAvailableGeminiModels(geminiApiKey);
            let response = null;
            let lastErrorData = null;

            for (const model of modelsToTry) {
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: promptText
                            }]
                        }]
                    })
                });

                if (response.ok) break;
                else lastErrorData = await response.json();
            }

            if (!response || !response.ok) {
                throw new Error(lastErrorData?.error?.message || 'API Request failed');
            }

            const data = await response.json();
            const text = data.candidates[0].content.parts[0].text;
            aiReportContent.innerHTML = marked.parse(text);

            body.querySelector('#reader-close-ai-report-btn').onclick = () => {
                aiReportContainer.classList.add('hidden');
            };

            body.querySelector('#reader-copy-ai-report-btn').onclick = async () => {
                const aiFormat = body.querySelector('#reader-export-ai-format').value;
                let exportText = text;
                if (aiFormat === 'html') exportText = marked.parse(text);
                await navigator.clipboard.writeText(exportText);
                alert("Kopiert!");
            };

            body.querySelector('#reader-download-ai-report-btn').onclick = () => {
                const aiFormat = body.querySelector('#reader-export-ai-format').value;
                let exportText = text;
                let extension = 'md';
                let mimeType = 'text/markdown';
                if (aiFormat === 'html') {
                    exportText = marked.parse(text);
                    extension = 'html';
                    mimeType = 'text/html';
                } else if (aiFormat === 'txt') {
                    exportText = text.replace(/[*#_`-]/g, '');
                    extension = 'txt';
                    mimeType = 'text/plain';
                }
                const fileName = `summary-${post.title.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`;
                const blob = new Blob([exportText], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
            };

        } catch (err) {
            console.error(err);
            aiReportContent.innerHTML = `<p style="color:red;"><strong>Fehler:</strong> ${err.message}</p>`;
        } finally {
            aiSummaryBtn.innerText = 'AI Summary';
            aiSummaryBtn.disabled = false;
            aiGenerateWithPromptBtn.innerText = 'Generieren 🤖';
            aiGenerateWithPromptBtn.disabled = false;
        }
    }

    aiSummaryBtn.onclick = async () => {
        aiReportContainer.classList.remove('hidden');
        aiReportContent.innerHTML = '<p style="color: #eee; font-style: italic;">Passe den Prompt bei Bedarf oben an und klicke auf "Generieren 🤖", um die Zusammenfassung zu starten.</p>';
        
        const customAiPrompt = localStorage.getItem('gemini_ai_prompt') || '';
        const customYtPrompt = localStorage.getItem('gemini_yt_prompt') || '';

        if (isYouTube) {
            aiCustomPromptVal.value = customYtPrompt && customYtPrompt.trim() !== ''
                ? customYtPrompt.trim()
                : "You are an assistant that summarizes YouTube videos. Generate a response in German that is clearly divided into two distinct sections using these exact Markdown headings:\n\n### 📝 Zusammenfassung aus der Videobeschreibung\n[Provide a concise summary of the video's description text here]\n\n### 🎥 Zusammenfassung aus dem Video-Skript\n[Provide a concise summary and 3-5 key takeaways in bullet points based on the transcript (script) of the video here]\n\nIf both description and transcript are provided, you MUST show both sections. If the transcript is not available, still display both headers but under the script header write: 'Kein Video-Skript (Transkript) verfügbar. Zusammenfassung basiert nur auf der Beschreibung.' Ignore advertisements or sponsor mentions in the text.";
        } else {
            aiCustomPromptVal.value = customAiPrompt && customAiPrompt.trim() !== ''
                ? customAiPrompt.trim()
                : "Provide a concise summary and highlight the key takeaways of the following article in Markdown format. Use German language for the summary.";
        }
    };

    aiGenerateWithPromptBtn.onclick = async () => {
        await runAiSummaryGeneration();
    };

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
        const html = await fetchViaExtensionOrProxy(post.link);
        const doc = new DOMParser().parseFromString(html, "text/html");
        
        const base = doc.createElement('base');
        base.href = post.link;
        doc.head.appendChild(base);

        preprocessDOM(doc, post.link);

        const reader = new Readability(doc).parse();
        if (reader && reader.content) {
            let content = reader.content;
            content = sanitizeReaderContent(content);
            innerContent.innerHTML = `<div style="font-size:16px; line-height:1.7; color:#eee;">${content}</div>`;
            
            post.desc = content;
            post.isFullyLoaded = true;

            const postRow = document.querySelector(`.post-row[data-link="${post.link}"]`);
            if (postRow) {
                const contentBody = postRow.querySelector('.report-content-body');
                if (contentBody) contentBody.innerHTML = content;
                const loadBtn = postRow.querySelector('.load-full-btn');
                if (loadBtn && loadBtn.parentNode) loadBtn.parentNode.remove();
            }
        }
    } catch (e) { innerContent.innerHTML = `<div style="color:red; margin-top:20px;">Fehler beim Laden des Inhalts: ${e.message}</div>`; }
}

async function loadFullInlineContent(link, btn) {
    const postRow = document.querySelector(`.post-row[data-link="${link}"]`);
    const post = postRow ? postRow.postData : null;
    
    let container = null;
    if (btn) {
        container = btn.closest('.report-inline-description');
    } else if (postRow) {
        container = postRow.querySelector('.report-inline-description');
    }
    const contentBody = container ? container.querySelector('.report-content-body') : null;
    if (!container || !contentBody) return;
    
    if (btn) {
        btn.innerText = 'Lade...';
        btn.disabled = true;
    }
    
    try {
        const html = await fetchViaExtensionOrProxy(link);
        const doc = new DOMParser().parseFromString(html, "text/html");
        
        const base = doc.createElement('base');
        base.href = link;
        doc.head.appendChild(base);

        preprocessDOM(doc, link);

        const reader = new Readability(doc).parse();
        if (reader && reader.content) {
            let content = sanitizeReaderContent(reader.content);
            contentBody.innerHTML = content;
            
            if (post) {
                post.desc = content;
                post.isFullyLoaded = true;
            }
        } else {
            throw new Error("Konnte den Text der Originalseite nicht extrahieren.");
        }
    } catch(e) {
        console.error(e);
        const originalDesc = post ? (post.desc || '') : '';
        contentBody.innerHTML = `
            <div style="color:#ff4444; font-size:13px; margin-bottom:10px;">
                <strong>Automatische Text-Extraktion fehlgeschlagen:</strong> ${e.message}
            </div>
            <button class="action-btn load-full-btn" onclick="loadFullInlineContent('${link}', this)" style="font-size:11px; padding:4px 8px; width:auto; height:auto; background: #2a2a2a; border: 1px solid #444; color: #fff; cursor: pointer; border-radius: 4px; margin-bottom:10px;">Erneut versuchen ↻</button>
            <br>
            ${originalDesc}
        `;
    }
}
window.loadFullInlineContent = loadFullInlineContent;

async function loadFullInlineContentDirect(post, row) {
    const contentBody = row.querySelector('.report-content-body');
    if (!contentBody) return;
    
    try {
        const html = await fetchViaExtensionOrProxy(post.link);
        const doc = new DOMParser().parseFromString(html, "text/html");
        
        const base = doc.createElement('base');
        base.href = post.link;
        doc.head.appendChild(base);

        preprocessDOM(doc, post.link);

        const reader = new Readability(doc).parse();
        if (reader && reader.content) {
            let content = sanitizeReaderContent(reader.content);
            contentBody.innerHTML = content;
            
            post.desc = content;
            post.isFullyLoaded = true;
            if (row.postData) {
                row.postData.desc = content;
                row.postData.isFullyLoaded = true;
            }
        } else {
            throw new Error("Text-Extraktion fehlgeschlagen.");
        }
    } catch(e) {
        console.error("Hintergrund-Laden fehlgeschlagen für:", post.link, e);
        contentBody.innerHTML = `
            <div style="color:#ff4444; font-size:13px; margin-bottom:10px;">
                <strong>Automatische Text-Extraktion fehlgeschlagen:</strong> ${e.message}
            </div>
            <button class="action-btn load-full-btn" onclick="loadFullInlineContent('${post.link}', this)" style="font-size:11px; padding:4px 8px; width:auto; height:auto; background: #2a2a2a; border: 1px solid #444; color: #fff; cursor: pointer; border-radius: 4px; margin-bottom:10px;">Erneut versuchen ↻</button>
            <br>
            ${post.desc || ''}
        `;
    }
}
window.loadFullInlineContentDirect = loadFullInlineContentDirect;

function generateReaderArticleContent(post, format, isFragment = false) {
    const title = post.title;
    const url = post.link;
    const contentHtml = post.desc || '';

    if (format === 'txt') {
        let text = `${title}\n`;
        text += `URL: ${url}\n`;
        text += `\n--------------------------------------\n\n`;
        
        let htmlWithBreaks = contentHtml
            .replace(/<(p|div)[^>]*>/gi, '\n\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n- ')
            .replace(/<h[1-6][^>]*>/gi, '\n\n\n');
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlWithBreaks;
        text += tempDiv.textContent.trim().replace(/\n{3,}/g, '\n\n');
        return text;
    } else if (format === 'markdown') {
        let md = `# ${title}\n\n`;
        md += `**URL:** [${url}](${url})  \n`;
        md += `\n---\n\n`;
        let bodyMd = contentHtml
            .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
            .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
            .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
            .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n')
            .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
            .replace(/<div[^>]*>/gi, '\n\n')
            .replace(/<br\s*\/?>/gi, '  \n')
            .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
            .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
            .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
            .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
            .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
            .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
            
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = bodyMd;
        md += tempDiv.textContent.trim().replace(/\n{3,}/g, '\n\n');
        return md;
    } else if (format === 'html') {
        const fragment = `<div class="puretidings-content" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: auto; overflow-wrap: break-word;">
            <style>
                .puretidings-content img, .puretidings-content figure { max-width: 100% !important; height: auto !important; margin: 15px 0; border-radius: 4px; }
                .puretidings-content video, .puretidings-content iframe { max-width: 100% !important; border-radius: 4px; }
                .puretidings-content .video-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin: 20px 0; background: #000; border-radius: 8px; }
                .puretidings-content .video-container iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
                .puretidings-content pre { background: #f4f4f4; padding: 15px; border-radius: 4px; overflow-x: auto; }
                @media (prefers-color-scheme: dark) {
                    .puretidings-content { color: #eee !important; background: #222 !important; }
                    .puretidings-content a { color: #58a6ff !important; }
                    .puretidings-content pre { background: #333 !important; }
                }
            </style>
            <h1 style="font-size: 2em; margin-bottom: 10px;">${title}</h1>
            <p><strong>Original URL:</strong> <a href="${url}" target="_blank">${url}</a></p>
            <hr style="border:0; border-top:1px solid #ddd; margin: 20px 0;">
            <div class="puretidings-body">
                ${contentHtml}
            </div>
        </div>`;
        if (isFragment) return fragment;
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${fragment}</body></html>`;
    }
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

function preprocessDOM(doc, url) {
    if (!url) return;

    // Preprocessing: Fix specific sites where Readability fails (like investing.com risk disclaimer)
    if (url.includes('investing.com')) {
        const investingArticle = doc.querySelector('div[class*="article_WYSIWYG"], .articlePage');
        if (investingArticle) {
            investingArticle.querySelectorAll('[data-test="ad-slot-visible"], .ad_ad__II8vw').forEach(ad => ad.remove());
            doc.body.innerHTML = '';
            doc.body.appendChild(investingArticle);
        }
    }

    // Preprocessing: Ensure Readability doesn't strip out specific YouTube containers (like wp-youtube-lyte)
    doc.querySelectorAll('div[id^="lyte_"]').forEach(lyteDiv => {
        const videoId = lyteDiv.id.replace('lyte_', '');
        if (videoId) {
            const iframe = doc.createElement('iframe');
            iframe.src = `https://www.youtube.com/embed/${videoId}?origin=${encodeURIComponent(window.location.origin)}`;
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
            const wrapper = lyteDiv.closest('.lyte-wrapper') || lyteDiv;
            wrapper.replaceWith(iframe);
        }
    });

    // Preprocessing: Fix Chefkoch.de recipes
    if (url.includes('chefkoch.de')) {
        // 1. Remove slide navigation and carousel elements
        doc.querySelectorAll('nav').forEach(nav => {
            if (nav.textContent.includes('Slide 1')) {
                nav.remove();
            }
        });
        doc.querySelectorAll('.recipe-images__slides, .ds-carousel-item, [class*="slider__control"], .ds-carousel').forEach(el => el.remove());
        
        // Remove empty recipe author headers, breadcrumbs, ads, and widgets
        doc.querySelectorAll('section, div, h2').forEach(el => {
            if (el.textContent.trim() === 'Rezeptautor:in' || el.textContent.trim() === 'Klassische Rezepte der Woche') {
                el.remove();
            }
        });
        doc.querySelectorAll('[data-testid="rds-breadcrumb"], nav[aria-label="Breadcrumb"], spark-ad, spark-config').forEach(el => el.remove());

        // 2. Restructure nutrition grid into a clean horizontal table
        const nutritionCells = doc.querySelectorAll('.ds-nutrition__cell, [class*="nutrition__cell"]');
        if (nutritionCells.length > 0) {
            const data = [];
            nutritionCells.forEach(cell => {
                const valueEl = cell.querySelector('.ds-nutrition__value, [class*="nutrition__value"]');
                const labelEl = cell.querySelector('.ds-nutrition__title, [class*="nutrition__title"]');
                if (valueEl && labelEl) {
                    data.push({
                        label: labelEl.textContent.trim(),
                        value: valueEl.textContent.trim()
                    });
                } else {
                    const paragraphs = cell.querySelectorAll('p');
                    if (paragraphs.length >= 2) {
                        let val = '';
                        let lbl = '';
                        paragraphs.forEach(p => {
                            const txt = p.textContent.trim();
                            if (txt.includes('kcal') || txt.includes(' g') || txt === '--') {
                                val = txt;
                            } else if (txt && !p.querySelector('i') && !txt.match(/^[]$/)) {
                                lbl = txt;
                            }
                        });
                        if (val && lbl) {
                            data.push({ label: lbl, value: val });
                        }
                    }
                }
            });

            if (data.length > 0) {
                const table = doc.createElement('table');
                table.className = 'reader-nutrition-table';
                table.style.width = '100%';
                table.style.borderCollapse = 'collapse';
                table.style.marginTop = '15px';
                table.style.marginBottom = '15px';
                table.style.border = '1px solid var(--border-color, #ddd)';
                
                const trHead = doc.createElement('tr');
                const trBody = doc.createElement('tr');
                
                data.forEach(item => {
                    const th = doc.createElement('th');
                    th.textContent = item.label;
                    th.style.border = '1px solid var(--border-color, #ddd)';
                    th.style.padding = '8px';
                    th.style.backgroundColor = 'var(--bg-color-secondary, #f0f0f0)';
                    th.style.color = 'var(--text-color, #333)';
                    th.style.textAlign = 'center';
                    th.style.fontWeight = 'bold';
                    trHead.appendChild(th);
                    
                    const td = doc.createElement('td');
                    td.textContent = item.value;
                    td.style.border = '1px solid var(--border-color, #ddd)';
                    td.style.padding = '8px';
                    td.style.textAlign = 'center';
                    td.style.color = 'var(--text-color, #333)';
                    trBody.appendChild(td);
                });
                
                table.appendChild(trHead);
                table.appendChild(trBody);

                const container = doc.querySelector('.recipe-nutrition, [class*="nutrition-card"]');
                if (container) {
                    container.replaceWith(table);
                } else {
                    const cellParent = nutritionCells[0].parentElement;
                    if (cellParent) {
                        cellParent.replaceWith(table);
                    }
                }
            }
        }
    }
}
