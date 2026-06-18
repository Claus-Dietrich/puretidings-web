// This script checks the user's theme preference and applies the 'dark-mode' class
// to the body as early as possible to prevent a "flash of light theme".
// It is designed to be run in the <head> of the document.

(async () => {
  try {
    // Use chrome.storage.sync to get the saved preference.
    const { darkMode = false } = await chrome.storage.sync.get('darkMode');
    
    // If dark mode is enabled, add the class to the document's body or documentElement.
    if (darkMode) {
      if (document.body) {
        document.body.classList.add('dark-mode');
      } else {
        // Fallback to documentElement (<html>) if body isn't ready yet.
        document.documentElement.classList.add('dark-mode');
        
        // Also apply to body once it's available to satisfy any 'body.dark-mode' CSS selectors.
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
    // This might fail in contexts where the chrome.storage API is not available.
    // We can fail silently as the default theme will simply be applied.
    console.warn('Could not apply theme preference:', e);
  }
})();