// This script checks the user's theme preference and applies the 'dark-mode' class
// to the body as early as possible to prevent a "flash of light theme".
// It is designed to be run in the <head> of the document.

(async () => {
  try {
    let isDark = true; // Default to dark mode

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const data = await chrome.storage.sync.get('darkMode');
      if (data.darkMode !== undefined) {
        isDark = data.darkMode;
      }
    } else {
      const localPref = localStorage.getItem('darkMode');
      if (localPref !== null) {
        isDark = localPref === 'true';
      }
    }
    
    if (isDark) {
      if (document.body) {
        document.body.classList.add('dark-mode');
      } else {
        document.documentElement.classList.add('dark-mode');
        const observer = new MutationObserver((mutations, obs) => {
          if (document.body) {
            document.body.classList.add('dark-mode');
            obs.disconnect();
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
  } catch (e) {
    console.warn('Could not apply theme preference:', e);
  }
})();