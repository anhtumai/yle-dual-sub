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
    console.log('YleDualSubExtension: Token configuration changed, reloading...');
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
        console.warn('YleDualSubExtension: No selected token found in updated storage');
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class DeepLTranslationError {
  /**
   * Init DeepLTranslationError for DeepL API translation request failures
   * @param {number} status - The HTTP status code from the failed request
   */
  constructor(status) {
    if (typeof status !== "number" || isNaN(status)) {
      throw new Error("Status must be a valid number");
    }
    /**
     * @type {number}
     * @description The HTTP status code from the failed request
     */
    this.status = status;
  }


}

/**
   * Get a user-friendly error message based on the HTTP status code
   * @param {number} status - The HTTP status code
   * @returns {string} A descriptive error message
   * @private
   */
function getErrorMessageFromStatus(status) {
  switch (status) {
    case 400:
      return "Translation request is invalid. Please try again.";
    case 403:
      return "This API token is invalid. Please check your DeepL token in settings.";
    case 404:
      return "Cannot connect to DeepL. Please contact the extension developer.";
    case 413:
      return "Subtitle text is too large. Please contact the extension developer.";
    case 414:
      return "Request URL is too long. Please contact the extension developer.";
    case 429:
      return "You're translating too quickly. Please wait a moment and try again.";
    case 456:
      return "Monthly character limit reached. Please use a different token or upgrade your plan.";
    case 500:
      return "DeepL is having technical problems. Please try again in a few minutes.";
    case 504:
      return "DeepL is temporarily unavailable. Please try again in a few minutes.";
    case 529:
      return "You're translating too quickly. Please wait a moment and try again.";
    default:
      return `Translation failed (error ${status}). Please try again later.`;
  }
}

/**
 * Translate DeepL text with proper error handling
 *
 * @param {string[]} rawSubtitleFinnishTexts
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.
 */
async function translateTextsWithErrorHandling(rawSubtitleFinnishTexts) {
  for (let i = 0; i < 5; i++) {
    const [isSucceeded, translationResponse] = await translateTexts(rawSubtitleFinnishTexts);

    if (isSucceeded) {
      return [true, translationResponse];
    }

    if (translationResponse instanceof DeepLTranslationError) {
      const deepLTranslationError = translationResponse;
      const errorStatusCode = deepLTranslationError.status;
      if ([413, 429, 503, 504, 529].includes(errorStatusCode)) {
        await sleep(400);
        continue;
      } else {
        return [false, getErrorMessageFromStatus(errorStatusCode)];
      }
    } else {
      const errorMessage = translationResponse;
      return [false, errorMessage];
    }
  }

  return [false, "Translation fails after 5 retry attempts."];
}

/**
 * Translate text using DeepL API
 * @param {Array<string>} rawSubtitleFinnishTexts - Array of Finnish texts to translate
 * @returns {Promise<[true, Array<string>]|[false, DeepLTranslationError]|[false, string]>} -
 * Returns a tuple where the first element indicates success and the second is either translated texts, translation error or an error message.
 */
async function translateTexts(rawSubtitleFinnishTexts) {
  const apiKey = deeplTokenKey;
  const url = isDeepLPro ?
    'https://api.deepl.com/v2/translate' :
    'https://api-free.deepl.com/v2/translate';

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
      const deepLTranslationError = new DeepLTranslationError(response.status);
      return [false, deepLTranslationError];
    }

    const data = await response.json();
    const translatedTexts = data["translations"].map(t => t["text"]);
    return [true, translatedTexts];

  } catch (error) {
    console.error('YleDualSubExtension: Translation failed:', error);
    const errorMessage = `
      Parsing translation response failed with ${error}.
      Probably network error or DeepL has changed response format.
      Please contact extension developers for this issue.
    `;
    return [false, errorMessage];
  }
};
