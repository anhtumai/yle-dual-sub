const DEFAULT_TARGET_LANGUAGE = 'EN-US';

/**
 * Load selected DeepL token from Chrome storage sync
 * @returns {Promise<{key: string, isPro: boolean} | null>} Returns token info or null if not found
 */
// eslint-disable-next-line no-unused-vars
async function loadSelectedTokenFromChromeStorageSync() {
  try {
    const result = await chrome.storage.sync.get("tokenInfos");

    if (result && result.tokenInfos && Array.isArray(result.tokenInfos)) {
      /**
       * @type {DeepLTokenInfoInStorage[]}
       */
      const deeplTokenInfos = result.tokenInfos;
      const selectedTokenInfo = deeplTokenInfos.find(token => token.selected === true);
      if (selectedTokenInfo) {
        return {
          key: selectedTokenInfo.key,
          isPro: selectedTokenInfo.type === "pro"
        };
      } else {
        console.info('FinnishStreamingDualSubExtension: No selected token found in storage');
        return null;
      }
    } else {
      console.info('FinnishStreamingDualSubExtension: No tokens found in storage');
      return null;
    }
  } catch (error) {
    console.error('FinnishStreamingDualSubExtension: Error loading application settings (to get token information) from storage:', error);
    return null;
  }
}

/**
 * Load all information
 * @returns {Promise<string>} return target language code (e.g., 'EN-US')
 */
// eslint-disable-next-line no-unused-vars
async function loadTargetLanguageFromChromeStorageSync() {
  try {
    const storageSyncInformation = await chrome.storage.sync.get("targetLanguage");
    if (!storageSyncInformation || typeof storageSyncInformation !== 'object') {
      console.info('FinnishStreamingDualSubExtension: No settings found in storage');
      return DEFAULT_TARGET_LANGUAGE;
    }

    if (storageSyncInformation.targetLanguage &&
      typeof storageSyncInformation.targetLanguage === 'string') {
      return storageSyncInformation.targetLanguage;
    } else {
      console.info('FinnishStreamingDualSubExtension: No target language found in storage, using default');
    }
    return DEFAULT_TARGET_LANGUAGE;
  } catch (error) {
    console.error('FinnishStreamingDualSubExtension: Error loading application settings (to get target language) from storage:', error);
    return DEFAULT_TARGET_LANGUAGE;
  }
}

/**
 * @param {Array<string>} rawSubtitleFinnishTexts - Finnish text to translate
 * @param {string} targetLanguage - target language
 * @param {string} context - context for more accurate translation
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.
 */
async function fetchTranslation(rawSubtitleFinnishTexts, targetLanguage, context = "") {
  try {
    /**
     * @type {[true, Array<string>] | [false, string]}
     */
    const response = await chrome.runtime.sendMessage(
      {
        action: 'fetchTranslation',
        data: { rawSubtitleFinnishTexts, targetLanguage, context }
      });
    return response;
  } catch (error) {
    console.error("FinnishStreamingDualSubExtension: Error sending message to background for translation:", error);
    return [false, error.message || String(error)];
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoWords(text) {
  return text
    .split(/\s+/)
    .map(word => word.replace(/[^a-zA-ZÀ-ÿ]/g, ''))
    .filter(word => word.length > 0);
}

/**
 * Show lookup popup on top of displayed subtitles rows wrapper, if it exists and visible
 *
 * @param {Array<{key: string, val: string}>} rows
 * @param {number} selectedTextStartIndex
 * @param {number} selectedTextEndIndex
 * @param {Element} appendTarget
 */
function showLookupPopup(rows, selectedTextStartIndex, selectedTextEndIndex, appendTarget) {

  document.getElementById('dual-sub-lookup-popup')?.remove();

  const finnishSubtitleRow = document.getElementById("finnish-subtitle-row");

  if (!finnishSubtitleRow || !finnishSubtitleRow?.firstChild) {
    alert("Lookup only works when DualSub is turned on.")
    return;
  }

  const display = getComputedStyle(finnishSubtitleRow).display;
  if (!display || display === 'none') {
    alert("Lookup only works when DualSub is turned on.")
    return;
  }

  const textNode = finnishSubtitleRow.firstChild;
  const range = document.createRange();
  range.setStart(textNode, selectedTextStartIndex);
  range.setEnd(textNode, selectedTextEndIndex);
  const rect = range.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'dual-sub-lookup-popup';
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top - 14}px`;

  popup.innerHTML = `
    <div class="dual-sub-lookup-header">
      <div class="dual-sub-lookup-header-left">
        <span class="dual-sub-lookup-title-icon">ⓘ</span>
        <span class="dual-sub-lookup-title">Explanation</span>
      </div>
      <button class="dual-sub-lookup-close" aria-label="Close">✕</button>
    </div>
    <div class="dual-sub-lookup-divider"></div>
    <div class="dual-sub-lookup-body"></div>
    <div class="dual-sub-lookup-arrow"></div>
  `;

  const body = popup.querySelector('.dual-sub-lookup-body');
  rows.forEach(({ key, val }) => {
    const row = document.createElement('div');
    row.className = 'dual-sub-lookup-row';
    const keyEl = document.createElement('span');
    keyEl.className = 'dual-sub-lookup-row-key';
    keyEl.textContent = key;
    const valEl = document.createElement('span');
    valEl.className = 'dual-sub-lookup-row-val';
    valEl.textContent = val;
    row.append(keyEl, valEl);
    body.appendChild(row);
  });

  appendTarget.appendChild(popup);

  popup.addEventListener('click', (e) => e.stopPropagation());
  popup.querySelector('.dual-sub-lookup-close').addEventListener('click', () => popup.remove());
}

/**
 * @param {{type: string, text: string}} msg
 * @param {string} targetLanguage
 * @param {Element} appendTarget
 */
// eslint-disable-next-line no-unused-vars
async function handleLookupMessage(msg, targetLanguage, appendTarget) {
  if (msg.type !== 'lookup') { return; }

  /** @type {string} */
  const selectedText = msg.text;
  const wholeSentence = document.getElementById('finnish-subtitle-row')?.textContent || '';

  if (!wholeSentence) {
    alert("Please turn on DualSub switch, pause the video and look up Finnish words only");
    return;
  }

  const selectedTextStartIndex = wholeSentence.indexOf(selectedText);
  if (selectedTextStartIndex < 0) {
    alert("Please look up Finnish text only, and pause the video before looking up words");
    return;
  }

  const words = splitIntoWords(selectedText);
  let toTranslate = words;
  if (words.length > 1) {
    toTranslate = [...words, selectedText];
  }
  const [isSucceeded, translations] = await fetchTranslation(
    toTranslate, targetLanguage, wholeSentence
  );

  const selectedTextEndIndex = selectedTextStartIndex + selectedText.length;

  if (isSucceeded) {
    const rows = toTranslate.map((word, i) => ({ key: word, val: translations[i] }));
    showLookupPopup(rows, selectedTextStartIndex, selectedTextEndIndex, appendTarget);
  } else {
    showLookupPopup(
      [{ key: 'Error', val: String(translations) }],
      selectedTextStartIndex,
      selectedTextEndIndex,
      appendTarget
    );
  }
}
