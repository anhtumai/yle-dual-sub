/* global importScripts, loadSelectedTokenFromChromeStorageSync */
/* global translateTextsWithErrorHandlingWithDeepL */
importScripts('../utils/utils.js');
importScripts('../translation/shared.js');
importScripts('../translation/deepl_api.js');
importScripts('../translation/google_translate_api.js');

// Load selected DeepL key from Chrome storage sync
/**
 * @type {string}
 */
let deeplTokenKey = "";
/**
 * @type {boolean}
 */
let isDeepLPro = false;

// Load key on extension startup
loadSelectedTokenFromChromeStorageSync().then((tokenInfo) => {
  if (tokenInfo) {
    deeplTokenKey = tokenInfo.key;
    isDeepLPro = tokenInfo.isPro;
  }
});

// Listen for storage changes to update key when user changes selection
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.tokenInfos) {
    console.info('YleDualSubExtension: Key configuration changed, reloading...');
    if (changes.tokenInfos.newValue && Array.isArray(changes.tokenInfos.newValue)) {
      /**
       * @type {DeepLTokenInfoInStorage[]}
       */
      const deeplTokenInfos = changes.tokenInfos.newValue;
      const selectedTokenInfo = deeplTokenInfos.find(token => token.selected === true);
      if (selectedTokenInfo) {
        deeplTokenKey = selectedTokenInfo.key;
        isDeepLPro = selectedTokenInfo.type === "pro";
      } else {
        console.info('YleDualSubExtension: No selected key found in updated storage');
      }
    }
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'fetchTranslation') {
    /** @type {string[]} */
    const rawSubtitleFinnishTexts = request.data.rawSubtitleFinnishTexts;
    /** @type {string} */
    const targetLanguage = request.data.targetLanguage;
    /** @type {string} */
    const context = request.data.context || "";
    translateTextsWithErrorHandlingWithDeepL(
      deeplTokenKey,
      isDeepLPro,
      rawSubtitleFinnishTexts,
      targetLanguage,
      context,
    ).then((translationResult) => {
      sendResponse(translationResult);
    }).catch((error) => {
      sendResponse([false, error.message || String(error)]);
    });
    return true;
  }

  if (request.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "lookup-word",
      title: 'Look up "%s"',
      contexts: ["selection"],
      documentUrlPatterns: ["https://areena.yle.fi/*", "https://www.ruutu.fi/*"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "lookup-word") {
    chrome.tabs.sendMessage(tab.id, { type: "lookup", text: info.selectionText });
  }
});
