/**
 * @typedef {import('./types.js').DeepLTokenInfoInStorage} DeepLTokenInfoInStorage
 */

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
        console.warn('YleDualSubExtension: No selected token found in storage');
        return null;
      }
    } else {
      console.warn('YleDualSubExtension: No tokens found in storage');
      return null;
    }
  } catch (error) {
    console.error('YleDualSubExtension: Error loading token from storage:', error);
    return null;
  }
}