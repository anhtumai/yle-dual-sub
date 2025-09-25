importScripts('./configs.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchTranslation') {
    /** @type {string[]} */
    const rawSubtitleFinnishTexts = request.data.rawSubtitleFinnishTexts;
    translateText(rawSubtitleFinnishTexts).then((translatedEnglishTexts) => {
      sendResponse(translatedEnglishTexts);
    }).catch((error) => {
      console.error('Error in translateText:', error);
      sendResponse({ error: error.message });
    });
    return true;
  }
  return false;
});

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// TODO: add error handling logics for all error mentioned in: https://developers.deepl.com/docs/best-practices/error-handling
// TODO: support translating multiple texts in one request
/**
 * Translate text using DeepL API 
 * @param {Array<string>} rawSubtitleFinnishTexts - Array of Finnish texts to translate
 * @returns {Promise<Array<string>>} - A promise that resolves to an array of translated English texts
 */
async function translateText(rawSubtitleFinnishTexts) {
  const apiKey = globalThis.deeplToken;
  const url = 'https://api-free.deepl.com/v2/translate';

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
      throw new Error(`HTTP error! Status: ${response.status}, ${await response.text()}`);
    }

    const data = await response.json();
    return data["translations"].map(t => t["text"]);

  } catch (error) {
    console.error('Translation failed:', error);
    throw error; // Re-throw the error to be handled by the caller
  }
};



