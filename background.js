importScripts('utils.js');

/**
 * @typedef {import('./types.js').DeepLTokenInfoInStorage} DeepLTokenInfoInStorage
 */

// Load selected DeepL token from Chrome storage sync
/**
 * @type {string}
 */
let deeplTokenKey = "";
/**
 * @type {boolean}
 */
let isDeepLPro = false;

// Load token on extension startup
loadSelectedTokenFromChromeStorageSync().then((tokenInfo) => {
  if (tokenInfo) {
    deeplTokenKey = tokenInfo.key;
    isDeepLPro = tokenInfo.isPro;
  }
});

// Listen for storage changes to update token when user changes selection
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.tokenInfos) {
    console.log('Token configuration changed, reloading...');
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
        console.warn('No selected token found in updated storage');
      }
    }
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'fetchTranslation') {
    /** @type {string[]} */
    const rawSubtitleFinnishTexts = request.data.rawSubtitleFinnishTexts;
    translateTextsWithErrorHandling(rawSubtitleFinnishTexts).then((translationResult) => {
      sendResponse(translationResult);
    }).catch((error) => {
      sendResponse(error);
    });
    return true;
  }

  if (request.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  return false;
});

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class HTTPError extends Error {
  /**
  * @param {string} message - HTTP Error message
  * @param {number} statusCode
  */
  constructor(message, statusCode) {
    super(message);
    this.name = "HTTPError";
    this.statusCode = statusCode;
  }
}

/**
 * Translate DeepL text with proper error handling
 * 
 * @param {string[]} rawSubtitleFinnishTexts 
 * @returns {Promise<Array<string>|Error>} - A promise that resolves to an array of
 * translated English texts, if failed it returns error during translation
 */
async function translateTextsWithErrorHandling(rawSubtitleFinnishTexts) {
  for (let i = 0; i < 5; i++) {
    const translationResult = await translateTexts(rawSubtitleFinnishTexts);

    if (Array.isArray(translationResult)) {
      return translationResult;
    }

    if (translationResult instanceof HTTPError) {
      const httpTranslationError = translationResult;
      if (httpTranslationError.statusCode in [429, 503, 413]) {
        await sleep(400);
        continue;
      }
      else if (httpTranslationError.statusCode === 456) {
        return new Error(
          "DeepL quota has exceeded"
        )
      }
      else {
        return new Error(
          `DeepL Error: ${httpTranslationError.message}, code: ${httpTranslationError.statusCode}`
        )
      }
    }
    else {
      const translationError = translationResult;
      return translationError;
    }
  }
}

/**
 * Translate text using DeepL API 
 * @param {Array<string>} rawSubtitleFinnishTexts - Array of Finnish texts to translate
 * @returns {Promise<Array<string>|HTTPError|Error>} - A promise that resolves to an array
 * of translated English texts, if failed, returns error object
 */
async function translateTexts(rawSubtitleFinnishTexts) {
  const apiKey = deeplTokenKey;
  const url = isDeepLPro ? 'https://api.deepl.com/v2/translate' : 'https://api-free.deepl.com/v2/translate';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${apiKey}`
      },
      body: JSON.stringify({
        text: rawSubtitleFinnishTexts,
        source_lang: "FI",
        target_lang: "EN-US"
      })
    });
    if (!response.ok) {
      return new HTTPError('Failed to fetch translation', response.status);
    }

    const data = await response.json();
    return data["translations"].map(t => t["text"]);

  } catch (error) {
    console.error('Translation failed:', error);
    return error;
  }
};

