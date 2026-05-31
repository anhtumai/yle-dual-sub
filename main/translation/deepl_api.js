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
 * Translate text using DeepL API
 * @param {Array<string>} rawSubtitleFinnishTexts - Array of Finnish texts to translate
 * @param {string} targetLanguage - target language code (exp: "EN-US", "VI", "GE", ...)
 * @param {string} context - context for more accurate translation
 * @returns {Promise<[true, Array<string>]|[false, DeepLTranslationError]|[false, string]>} -
 * Returns a tuple where the first element indicates success and the second is either translated texts, translation error or an error message.
 */
async function translateTexts(rawSubtitleFinnishTexts, targetLanguage, context = "") {
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
    console.error('YleDualSubExtension: Translation failed:', error);
    const errorMessage = 'Translation failed. Please check network or contact developers.';
    return [false, errorMessage];
  }
};

