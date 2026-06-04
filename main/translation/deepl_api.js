/* global sleep, calculateBackoffDelay */ // defined in shared.js

const DEEPL_PAID_ENDPOINT = 'https://api.deepl.com/v2/translate';
const DEEPL_FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate';


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
function getDeepLErrorMessage(status) {
  switch (status) {
    case 400:
      return "Translation request is invalid. Please try again. Consider reloading the page.";
    case 403:
      return "This API key is invalid. Please check your DeepL translation key in settings. Consider reloading the page.";
    case 404:
      return "Cannot connect to DeepL. Please contact the extension developer. Consider reloading the page.";
    case 413:
      return "Subtitle text is too large. Please contact the extension developer.";
    case 414:
      return "Request URL is too long. Please contact the extension developer.";
    case 429:
      return "You're translating too quickly. Please wait a moment and try again. Consider reloading the page.";
    case 456:
      return "Character limit reached. Please use a different translation key or check DeepL's current plans at https://www.deepl.com/en/pro/change-plan#api";
    case 500:
      return "DeepL is having technical problems. Please try again in a few minutes.";
    case 504:
      return "DeepL is temporarily unavailable. Please try again in a few minutes.";
    case 529:
      return "You're translating too quickly. Please wait a moment and try again.";
    default:
      return `Translation failed (error ${status}). Please try again later. Consider reloading the page.`;
  }
}

/**
 * Translate text using DeepL API
 * @param {string} apiKey - DeepL API key
 * @param {boolean} isDeepLPro - Whether the key is a Pro key
 * @param {Array<string>} rawSubtitleFinnishTexts - Array of Finnish texts to translate
 * @param {string} targetLanguage - target language code (exp: "EN-US", "VI", "GE", ...)
 * @param {string} context - context for more accurate translation
 * @returns {Promise<[true, Array<string>]|[false, DeepLTranslationError]|[false, string]>} -
 * Returns a tuple where the first element indicates success and the second is either translated texts, translation error or an error message.
 */
async function translateTextsWithDeepL(apiKey, isDeepLPro, rawSubtitleFinnishTexts, targetLanguage, context = "") {
  const url = isDeepLPro ? DEEPL_PAID_ENDPOINT : DEEPL_FREE_ENDPOINT;

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
        model_type: "prefer_quality_optimized",
        context,
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
    console.error('FinnishStreamingDualSubExtension: Translation failed:', error);
    const errorMessage = 'Translation failed. Please check network or contact developers.';
    return [false, errorMessage];
  }
};

/**
 * Translate DeepL text with proper error handling
 *
 * @param {string} apiKey - DeepL API key
 * @param {boolean} isDeepLPro - Whether the key is a Pro key
 * @param {string[]} rawSubtitleFinnishTexts
 * @param {string} targetLanguage (exp, "EN-US", "VI")
 * @param {string} context - context for more accurate translation
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.
 */
async function translateTextsWithErrorHandlingWithDeepL(
  apiKey,
  isDeepLPro,
  rawSubtitleFinnishTexts,
  targetLanguage,
  context = ""
) {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [isSucceeded, translationResponse] = await translateTextsWithDeepL(
      apiKey,
      isDeepLPro,
      rawSubtitleFinnishTexts,
      targetLanguage,
      context,
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
          return [false, getDeepLErrorMessage(errorStatusCode)];
        }
      } else {
        // Non-retryable error (e.g., 403 invalid key)
        return [false, getDeepLErrorMessage(errorStatusCode)];
      }
    } else {
      const errorMessage = String(translationResponse);
      return [false, errorMessage];
    }
  }
  // Should not reach here, but just in case
  return [false, "Translation failed after 3 retry attempts."];
}
