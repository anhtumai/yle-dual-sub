/* global sleep, calculateBackoffDelay */ // defined in shared.js
/* exported translateTextsWithErrorHandlingWithGoogleTranslate */

const UNOFFICIAL_GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_RETRIES = 3;

class GoogleTranslateError {
  /**
   * @param {number} status - The HTTP status code from the failed request
   */
  constructor(status) {
    if (typeof status !== "number" || isNaN(status)) {
      throw new Error("Status must be a valid number");
    }
    /** @type {number} */
    this.status = status;
  }
}

/** @type {Record<string, string>} */
const DEEPL_TO_GOOGLE_LANG_CODE = {
  "EN-US": "en",
  "EN-GB": "en",
  "VI": "vi",
  "AR": "ar",
  "BG": "bg",
  "ZH": "zh-CN",
  "ZH-HANS": "zh-CN",
  "ZH-HANT": "zh-TW",
  "CS": "cs",
  "DA": "da",
  "NL": "nl",
  "ET": "et",
  "FI": "fi",
  "FR": "fr",
  "DE": "de",
  "EL": "el",
  "HE": "he",
  "HU": "hu",
  "ID": "id",
  "IT": "it",
  "JA": "ja",
  "KO": "ko",
  "LV": "lv",
  "LT": "lt",
  "NB": "no",
  "PL": "pl",
  "PT-BR": "pt-BR",
  "PT-PT": "pt-PT",
  "RO": "ro",
  "RU": "ru",
  "SK": "sk",
  "SL": "sl",
  "ES": "es",
  "ES-419": "es-419",
  "SV": "sv",
  "TH": "th",
  "TR": "tr",
  "UK": "uk",
};

/**
 * @param {string} deeplLangCode - DeepL-style code e.g. "EN-US", "NB"
 * @returns {string} Google Translate code e.g. "en", "no"
 */
function toGoogleLangCode(deeplLangCode) {
  return DEEPL_TO_GOOGLE_LANG_CODE[deeplLangCode] ?? "en";
}

/**
 * @param {number} status
 * @returns {string}
 */
function getGoogleTranslateErrorMessage(status) {
  switch (status) {
    case 429:
      return "You're translating too quickly. Please wait a moment and try again.";
    default:
      return `Translation failed (error ${status}). Please try again later.`;
  }
}

/**
 * @param {string} text
 * @param {string} tl - Google Translate language code
 * @param {string} context
 * @returns {Promise<string>}
 */
async function translateTextWithGoogleTranslate(text, tl, context) {
  const textWithContext = context ? `<span>${text}</span>${context}` : text;
  const searchParams = new URLSearchParams({ client: "gtx", q: textWithContext, sl: "fi", tl, dj: "1", hl: tl });
  searchParams.append("dt", "rm");
  searchParams.append("dt", "bd");
  searchParams.append("dt", "t");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(`${UNOFFICIAL_GOOGLE_TRANSLATE_ENDPOINT}?${searchParams.toString()}`);
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES - 1) {
        await sleep(calculateBackoffDelay(attempt));
        continue;
      }
      throw new GoogleTranslateError(response.status);
    }
    const data = await response.json();
    const translationWithContext = (data.sentences
      ?.map((/** @type {{ trans?: string }} */ s) => s.trans)
      .filter((/** @type {string | undefined} */ t) => t)
      .join(" ") ?? "").replace(/\n /g, "\n");

    if (!context) {
      // add `(approximate)` after to show that Google Translate has low accuracy and should not be trusted.
      return `${translationWithContext} (approximate)`;
    }
    const match = translationWithContext.match(/<span>(.*?)<\/span>/s);
    return match ? match[1].trim() : "<unknown>";
  }
  throw new GoogleTranslateError(429);
}

/**
 * Translate texts using Google Translate API
 * @param {string[]} rawSubtitleFinnishTexts
 * @param {string} targetLanguage - target language code (e.g. "EN-US", "VI")
 * @param {string} context - context for more accurate translation
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateTextsWithErrorHandlingWithGoogleTranslate(
  rawSubtitleFinnishTexts,
  targetLanguage,
  context = ""
) {
  const tl = toGoogleLangCode(targetLanguage);

  try {
    const results = await Promise.all(
      rawSubtitleFinnishTexts.map((text) => translateTextWithGoogleTranslate(text, tl, context))
    );
    return [true, results];
  } catch (error) {
    if (error instanceof GoogleTranslateError) {
      return [false, getGoogleTranslateErrorMessage(error.status)];
    }
    console.error('FinnishStreamingDualSubExtension: Google Translate failed:', error);
    return [false, 'Translation failed. Please check network or contact developers.'];
  }
}
