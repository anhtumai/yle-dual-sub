/**
 * @typedef {import('./types.js').DeepLTokenInfoInStorage} DeepLTokenInfoInStorage
 */

const DEFAULT_TARGET_LANGUAGE = 'EN_US';

/**
 * Load selected DeepL token from Chrome storage sync
 * @returns {Promise<{key: string, isPro: boolean} | null>} Returns token info or null if not found
 */
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
        console.info('YleDualSubExtension: No selected token found in storage');
        return null;
      }
    } else {
      console.info('YleDualSubExtension: No tokens found in storage');
      return null;
    }
  } catch (error) {
    console.error('YleDualSubExtension: Error loading application settings (to get token information) from storage:', error);
    return null;
  }
}

/**
 * Load all information
 * @returns {Promise<string>} return target language code (e.g., 'EN_US')
 */
async function loadTargetLanguageFromChromeStorageSync() {
  try {
    const storageSyncInformation = await chrome.storage.sync.get("targetLanguage");
    if (!storageSyncInformation || typeof storageSyncInformation !== 'object') {
      console.info('YleDualSubExtension: No settings found in storage');
      return DEFAULT_TARGET_LANGUAGE;
    }

    if (storageSyncInformation.targetLanguage &&
      typeof storageSyncInformation.targetLanguage === 'string') {
      return storageSyncInformation.targetLanguage;
    } else {
      console.info('YleDualSubExtension: No target language found in storage, using default');
    }
    return DEFAULT_TARGET_LANGUAGE;
  } catch (error) {
    console.error('YleDualSubExtension: Error loading application settings (to get target language) from storage:', error);
    return DEFAULT_TARGET_LANGUAGE;
  }
}