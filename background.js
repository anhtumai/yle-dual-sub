importScripts('./configs.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchTranslation') {
    const rawSubtitleFinnishText = request.data.rawSubtitleFinnishText;
    translateText(rawSubtitleFinnishText).then((englishText) => {
      sendResponse({ englishText: englishText });
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

async function translateText(text) {
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
        text: [text],
        source_lang: "FI",
        target_lang: "EN-US"
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}, ${await response.text()}`);
    }

    const data = await response.json();
    return data["translations"][0]["text"];

  } catch (error) {
    console.error('Translation failed:', error);
    throw error; // Re-throw the error to be handled by the caller
  }
};



