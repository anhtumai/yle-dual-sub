importScripts('utils.js');

/**
 * @typedef {import('./types.js').DeepLTokenInfoInStorage} DeepLTokenInfoInStorage
 */

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
    translateTextsWithErrorHandling(
      rawSubtitleFinnishTexts,
      targetLanguage
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt) {
  // Exponential backoff: 200ms * 2^attempt
  // attempt 0: 200ms, attempt 1: 400ms, attempt 2: 800ms
  const exponentialDelay = 200 * Math.pow(2, attempt);

  // Add jitter: random value between 0 and delay/2
  // This prevents thundering herd problem when multiple requests retry simultaneously
  const jitter = Math.random() * (exponentialDelay / 2);

  return exponentialDelay + jitter;
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
      return "This API key is invalid. Please check your DeepL translation key in settings.";
    case 404:
      return "Cannot connect to DeepL. Please contact the extension developer.";
    case 413:
      return "Subtitle text is too large. Please contact the extension developer.";
    case 414:
      return "Request URL is too long. Please contact the extension developer.";
    case 429:
      return "You're translating too quickly. Please wait a moment and try again.";
    case 456:
      return "Monthly character limit reached. Please use a different translation key or upgrade your plan.";
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
 * @param {string} targetLanguage (exp, "EN-US", "VI")
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.
 */
async function translateTextsWithErrorHandling(rawSubtitleFinnishTexts, targetLanguage) {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [isSucceeded, translationResponse] = await translateTexts(
      rawSubtitleFinnishTexts,
      targetLanguage
    );

    if (isSucceeded) {
      return [true, translationResponse];
    }

    if (translationResponse instanceof DeepLTranslationError) {
      const deepLTranslationError = translationResponse;
      const errorStatusCode = deepLTranslationError.status;

      // Retry on transient errors
      if ([413, 429, 503, 504, 529].includes(errorStatusCode)) {
        if (attempt < MAX_RETRIES - 1) {
          const backoffDelay = calculateBackoffDelay(attempt);
          await sleep(backoffDelay);
          continue;
        } else {
          return [false, getErrorMessageFromStatus(errorStatusCode)];
        }
      } else {
        // Non-retryable error (e.g., 403 invalid key)
        return [false, getErrorMessageFromStatus(errorStatusCode)];
      }
    } else {
      const errorMessage = translationResponse;
      return [false, errorMessage];
    }
  }
  // Should not reach here, but just in case
  return [false, "Translation failed after 3 retry attempts."];
}

/**
 * Translate text using DeepL API
 * @param {Array<string>} rawSubtitleFinnishTexts - Array of Finnish texts to translate
 * @param {string} targetLanguage - target language code (exp: "EN-US", "VI", "GE", ...)
 * @returns {Promise<[true, Array<string>]|[false, DeepLTranslationError]|[false, string]>} -
 * Returns a tuple where the first element indicates success and the second is either translated texts, translation error or an error message.
 */
async function translateTexts(rawSubtitleFinnishTexts, targetLanguage) {
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
        target_lang: targetLanguage,
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
    const errorMessage = 'Translation failed. Please check network or contact developers.';
    return [false, errorMessage];
  }
};
