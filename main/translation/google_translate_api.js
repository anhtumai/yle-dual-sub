/* global sleep, calculateBackoffDelay */

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
    "EN-US":  "en",
    "EN-GB":  "en",
    "VI":     "vi",
    "AR":     "ar",
    "BG":     "bg",
    "ZH":     "zh-CN",
    "ZH-HANS":"zh-CN",
    "ZH-HANT":"zh-TW",
    "CS":     "cs",
    "DA":     "da",
    "NL":     "nl",
    "ET":     "et",
    "FI":     "fi",
    "FR":     "fr",
    "DE":     "de",
    "EL":     "el",
    "HE":     "he",
    "HU":     "hu",
    "ID":     "id",
    "IT":     "it",
    "JA":     "ja",
    "KO":     "ko",
    "LV":     "lv",
    "LT":     "lt",
    "NB":     "no",
    "PL":     "pl",
    "PT-BR":  "pt-BR",
    "PT-PT":  "pt-PT",
    "RO":     "ro",
    "RU":     "ru",
    "SK":     "sk",
    "SL":     "sl",
    "ES":     "es",
    "ES-419": "es-419",
    "SV":     "sv",
    "TH":     "th",
    "TR":     "tr",
    "UK":     "uk",
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
 * Translate texts using Google Translate API
 * @param {string[]} rawSubtitleFinnishTexts
 * @param {string} targetLanguage - target language code (e.g. "EN-US", "VI")
 * @returns {Promise<[true, string[]]|[false, GoogleTranslateError]|[false, string]>}
 */
async function translateTextsWithGoogleTranslate(rawSubtitleFinnishTexts, targetLanguage) {
    const apiUrl = "https://translate.googleapis.com/translate_a/single";
    const tl = toGoogleLangCode(targetLanguage);

    try {
        const results = [];
        for (const text of rawSubtitleFinnishTexts) {
            const searchParams = new URLSearchParams({ client: "gtx", q: text, sl: "fi", tl, dj: "1", hl: tl });
            searchParams.append("dt", "rm");
            searchParams.append("dt", "bd");
            searchParams.append("dt", "t");
            const response = await fetch(`${apiUrl}?${searchParams.toString()}`);
            if (!response.ok) {
                return [false, new GoogleTranslateError(response.status)];
            }
            const data = await response.json();
            const translatedText = (data.sentences
                ?.map((/** @type {{ trans?: string }} */ s) => s.trans)
                .filter((/** @type {string | undefined} */ t) => t)
                .join(" ") ?? "").replace(/\n /g, "\n");
            results.push(translatedText);
        }
        return [true, results];
    } catch (error) {
        console.error('YleDualSubExtension: Google Translate failed:', error);
        return [false, 'Translation failed. Please check network or contact developers.'];
    }
}

/**
 * Translate texts using Google Translate with retry/error handling
 * @param {string[]} rawSubtitleFinnishTexts
 * @param {string} targetLanguage
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateTextsWithErrorHandlingWithGoogleTranslate(
    rawSubtitleFinnishTexts,
    targetLanguage,
) {
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const [isSucceeded, translationResponse] = await translateTextsWithGoogleTranslate(
            rawSubtitleFinnishTexts,
            targetLanguage,
        );

        if (isSucceeded) {
            return [true, translationResponse];
        }

        if (translationResponse instanceof GoogleTranslateError) {
            const errorStatusCode = translationResponse.status;
            if ([429].includes(errorStatusCode)) {
                if (attempt < MAX_RETRIES - 1) {
                    const backoffDelay = calculateBackoffDelay(attempt);
                    await sleep(backoffDelay);
                    continue;
                } else {
                    return [false, getGoogleTranslateErrorMessage(errorStatusCode)];
                }
            } else {
                return [false, getGoogleTranslateErrorMessage(errorStatusCode)];
            }
        } else {
            return [false, String(translationResponse)];
        }
    }
    return [false, "Translation failed after 3 retry attempts."];
}
