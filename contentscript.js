// ==================================
// SECTION 1: STATE & INITIALIZATION
// ==================================


/** @type {Map<string, string>}
 * Shared translation map, with key is normalized Finnish text, and value is English text
 */
const sharedTranslationMap = new Map();
/** @type {Map<string, string>} */
const sharedTranslationErrorMap = new Map();
function toTranslationKey(rawSubtitleFinnishText) {
  return rawSubtitleFinnishText.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

// State of Dual Sub Switch, to manage whether to add display subtitles wrapper
let dualSubEnabled = false;

/**
 * @type {string | null}
 * Memory cached current movie name
 */
let currentMovieName = null;

/**
 * @type {IDBDatabase | null}
 * Memory cached current database connection to write data to Index DB
 */
let globalDatabaseInstance = null;
openDatabase().then(db => {
  globalDatabaseInstance = db;

  cleanupOldMovieData(db).then((cleanCount) => {
    console.log(`Clean ${cleanCount} movies data`);
  }).catch(error => { console.warn("Error when cleaning old movie data: ", error) });
}).
  catch((error) => {
    console.warn("Failed to established connection to indexDB: ", error);
  })

// ==================================
// END SECTION
// ==================================

// ==================================
// SECTION 2: TRANSLATION QUEUE
// ==================================

class TranslationQueue {
  /* Queue to manage translation requests to avoid hitting rate limits */

  BATCH_MAXIMUM_SIZE = 7;
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * @param {string} rawSubtitleFinnishText - Finnish text to translate
   * @returns {void}
   */
  addToQueue(rawSubtitleFinnishText) {
    this.queue.push(rawSubtitleFinnishText);
  }

  /**
   * Process the translation queue in batches
   * By sending to background.js to handle translation and store results in
   * sharedTranslationMap or sharedTranslationErrorMap
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    while (this.queue.length > 0 && dualSubEnabled) {
      this.isProcessing = true;

      /** @type {Array<string>} */
      const toProcessItems = [];
      for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
        toProcessItems.push(this.queue.shift());
      }

      try {
        const translationResult = await fetchTranslation(toProcessItems);

        if (Array.isArray(translationResult)) {
          /**
           * @type {Array<SubtitleRecord>}
           */
          const toCacheSubtitleRecords = [];
          for (let i = 0; i < toProcessItems.length; i++) {
            const translatedEnglishText = translationResult[i];
            const rawSubtitleFinnishText = toProcessItems[i];
            const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
            const sharedTranaslationMapValue = translatedEnglishText.trim().replace(/\n/g, ' ');
            sharedTranslationMap.set(
              sharedTranslationMapKey,
              sharedTranaslationMapValue,
            );
            if (currentMovieName) {
              toCacheSubtitleRecords.push({
                "movieName": currentMovieName,
                "finnishText": sharedTranslationMapKey,
                "translatedText": sharedTranaslationMapValue,
              })
            }
          }
          if (globalDatabaseInstance) {
            saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords)
              .then(() => { })
              .catch((error) => {
                console.warn("Error saving subtitles batch to cache:", error);
              });
          }
        }
        else {
          for (let i = 0; i < toProcessItems.length; i++) {
            const rawSubtitleFinnishText = toProcessItems[i];
            sharedTranslationErrorMap.set(
              toTranslationKey(rawSubtitleFinnishText),
              `Error: ${translationResult.message}`
            );
          }
        }


      } catch (error) {
        console.error("System error when translating text:", error);
      }
    }

    this.isProcessing = false;
  }
}

const translationQueue = new TranslationQueue();


/**
 * 
 * @param {Array<string>} rawSubtitleFinnishTexts - Finnish text to translate
 * @returns {Promise<Array<string>|Error>} - A promise that resolves to the
 * translated English texts. If it fails, return an error.
 * @throws {Error} - Throws an error if translation fails
 */
async function fetchTranslation(rawSubtitleFinnishTexts) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'fetchTranslation', data: { rawSubtitleFinnishTexts: rawSubtitleFinnishTexts } },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response.error) {
          // Probably never happens
          console.error(
            "Fetch Translation with Error Handling throws error: Please fix",
            response.error
          );
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      }
    )
  })
}

// ==================================
// END SECTION
// ==================================


// ==================================
// SECTION 3: UI MANIPULATION UTILS
// ==================================


/**
 * Create another div for displaying translated subtitles,
 * which inherits class name from original subtitles wrapper.
 * When the extension is turned on, the original subtitles wrapper will stay hidden
 * while this displayed subtitles wrapper will be shown.
 * 
 * Because, we need to listen to mutations on original subtitles wrapper,
 * so we want to avoid modifying it directly, which can trigger mutation observer recursively.
 * @param {string} className - class name to set for the new div 
 * @returns {HTMLDivElement} - new subtitles wrapper div to be displayed
 */
function copySubtitlesWrapper(className) {
  const displayedSubtitlesWrapper = document.createElement("div");
  displayedSubtitlesWrapper.setAttribute("aria-live", "polite");
  displayedSubtitlesWrapper.setAttribute("class", className);
  displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");
  return displayedSubtitlesWrapper;
}

/**
 *
 * Create a span element for subtitle text. 
 * 
 * @param {string} text - text content of the span
 * @param {string} className - class name to set for the span
 * @returns {HTMLSpanElement} - created span element to display
 */
function createSubtitleSpan(text, className) {
  const span = document.createElement("span");
  span.setAttribute("class", className);
  span.textContent = text;
  return span;
}

/**
 * Check if a mutation is related to subtitles wrapper 
 * @param {MutationRecord} mutation
 * @returns {boolean} - true if the mutation is related to subtitles wrapper
 */
function isMutationRelatedToSubtitlesWrapper(mutation) {
  try {
    return (mutation?.target?.dataset["testid"] === "subtitles-wrapper");
  } catch (error) {
    console.warn("Catch error checking mutation related to subtitles wrapper:", error);
    return false;
  }
}

/**
 * Create and position the displayed subtitles wrapper next to the original subtitles wrapper
 * if it does not exist yet
 *
 * @param {HTMLElement} originalSubtitlesWrapper 
 * @returns 
 */
function createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper) {
  let displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
  if (!displayedSubtitlesWrapper) {
    displayedSubtitlesWrapper = copySubtitlesWrapper(
      originalSubtitlesWrapper.className,
    );
    originalSubtitlesWrapper.parentNode.insertBefore(
      displayedSubtitlesWrapper,
      originalSubtitlesWrapper.nextSibling,
    );
  }

  return displayedSubtitlesWrapper;
}

/**
 * Add Finnish and translated English subtitles to the displayed subtitles wrapper
 *
 * @param {HTMLElement} displayedSubtitlesWrapper
 * @param {NodeListOf<HTMLSpanElement>} originalSubtitlesWrapperSpans
 * original Finnish Subtitles Wrapper Spans
 */
function addContentToDisplayedSubtitlesWrapper(
  displayedSubtitlesWrapper,
  originalSubtitlesWrapperSpans,
) {
  if (!originalSubtitlesWrapperSpans || originalSubtitlesWrapperSpans.length === 0) {
    return;
  }
  const spanClassName = originalSubtitlesWrapperSpans[0].className;

  const finnishText = Array.from(originalSubtitlesWrapperSpans).map(
    span => span.innerText
  ).join(" ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!finnishText || finnishText.length === 0) {
    return;
  }

  const finnishSpan = createSubtitleSpan(finnishText, spanClassName);
  const translationKey = toTranslationKey(finnishText);
  const translatedEnglishText =
    sharedTranslationMap.get(translationKey) ||
    sharedTranslationErrorMap.get(translationKey) ||
    "Translating...";
  // TODO: Add retry mechanism if Translation is not found

  const translatedEnglishSpan = createSubtitleSpan(translatedEnglishText, spanClassName);

  displayedSubtitlesWrapper.appendChild(finnishSpan);
  displayedSubtitlesWrapper.appendChild(translatedEnglishSpan);
}

/**
 * Handle mutation related to subtitles wrapper
 * Hide the original subtitles wrapper and create another div for displaying translated subtitles
 * along with original Finnish subtitles.
 * 
 * @param {MutationRecord} mutation
 * @returns {void}
 */
function handleSubtitlesWrapperMutation(mutation) {
  const originalSubtitlesWrapper = mutation.target;
  originalSubtitlesWrapper.style.display = "none";

  const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
    originalSubtitlesWrapper
  );
  displayedSubtitlesWrapper.innerHTML = "";

  if (mutation.addedNodes.length > 0) {
    const finnishTextSpans = mutation.target.querySelectorAll("span");
    addContentToDisplayedSubtitlesWrapper(
      displayedSubtitlesWrapper,
      finnishTextSpans,
    )
  }
}

/**
 * Check if a mutation indicates that a video modal has appeared on the page
 * @param {MutationRecord} mutation
 */
function isVideoAppearMutation(mutation) {
  try {
    return (mutation?.target?.localName === "body" &&
      mutation?.addedNodes.length > 0 &&
      typeof mutation.addedNodes[0]?.className === "string" &&
      mutation.addedNodes[0]?.className.includes("VideoPlayerWrapper_modalContent")
    )
  } catch (error) {
    console.warn("Catch error checking mutation if video appear:", error);
    return false;
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Handle dual sub behaviour based on whether the system has valid token selected.
 * If no token is selected, display warning icon and disable dual sub switch.
 * @param {boolean} hasSelectedToken
 */
function _handleDualSubBehaviourBasedOnSelectedToken(hasSelectedToken) {
  const warningSection = document.querySelector(".dual-sub-warning");
  const dualSubSwitch = document.getElementById("dual-sub-switch");
  if (hasSelectedToken) {
    if (warningSection) {
      warningSection.style.display = "none";
    }
    if (dualSubSwitch) {
      dualSubSwitch.disabled = false;
    }
  } else {
    if (warningSection) {
      warningSection.style.display = "inline-block";
    }
    if (dualSubSwitch) {
      if (dualSubSwitch.checked) {
        dualSubSwitch.click();
      }
      dualSubSwitch.disabled = true;
    }
  }
  const warningPopover = document.querySelector(".dual-sub-warning__popover");
  if (warningPopover) {
    warningPopover.classList.remove("active");
  }
}

/**
 * Add Dual Sub extension section to the video player's bottom control bar
 * next to the volume control.
 * @returns {Promise<void>}
 */
async function addDualSubExtensionSection() {
  let bottomControlBarLeftControls = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    bottomControlBarLeftControls = document.querySelector(
      '[class^="BottomControlBar__LeftControls"]'
    );
    if (bottomControlBarLeftControls) {
      break;
    };
    await sleep(150);
  }

  if (!bottomControlBarLeftControls) {
    console.warn("Cannot find bottom control bar left controls");
    return;
  }

  const dualSubExtensionSection = `
    <div class="dual-sub-extension-section">
      <span>Dual Sub:</span>
      <input id="dual-sub-switch" class="dual-sub-switch" type="checkbox">
      <span class="dual-sub-warning" style="display: none;">
        <span class="dual-sub-warning__icon">
          !
        </span>
        <span class="dual-sub-warning__popover">
          No translation token selected!<br>
          Please select one in <a href="#" id="open-options-link">the option page</a>.<br>
          Follow
          <a href="https://github.com/anhtumai/yle-dual-sub/blob/master/README.md"
             target="_blank"
             rel="noopener noreferrer">
            this guide
          </a>
          for more information.
        </span>
      </span>
    </div>
  `
  bottomControlBarLeftControls.insertAdjacentHTML('beforeend', dualSubExtensionSection);

  // Display warning section if no token is selected
  const selectedTokenInfo = await loadSelectedTokenFromChromeStorageSync();
  const hasSelectedToken = selectedTokenInfo !== null;
  _handleDualSubBehaviourBasedOnSelectedToken(hasSelectedToken);

  // Dual sub warning logic
  const warningIcon = document.querySelector(".dual-sub-warning__icon");
  const warningPopover = document.querySelector(".dual-sub-warning__popover");
  const openOptionsLink = document.getElementById("open-options-link");

  warningIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    warningPopover.classList.toggle("active");
  })

  document.addEventListener("click", (e) => {
    if (!warningPopover.contains(e.target) && !warningIcon.contains(e.target)) {
      warningPopover.classList.remove("active");
    }
  })

  warningPopover.addEventListener("click", (e) => {
    e.stopPropagation();
  })

  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
  })
}

/**
 * Get video title once the video player is loaded
 * @returns {Promise<string | null>}
 */
async function getVideoTitle() {

  let titleElement = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    titleElement = document.querySelector('[class*="VideoTitle__Titles"]');
    if (titleElement) {
      break;
    };
    await sleep(150);
  }

  if (!titleElement) {
    console.warn("Cannot find movie name");
    return null;
  }

  const texts = Array.from(titleElement.querySelectorAll('span'))
    .map(span => span.textContent.trim())
    .filter(text => text.length > 0);
  return texts.join(" | ")
}

// ==================================
// END SECTION
// ==================================

// =========================================
// MAIN SECTION: OBSERVERS & EVENT LISTENERS
// =========================================

/**
 * This function acts as a handler when new movie is played.
 * It will load that movie's subtitle from database and update metadata.
 * @returns 
 */
async function loadMovieCacheAndUpdateMetadata() {

  const db = await openDatabase();

  currentMovieName = await getVideoTitle();
  if (!currentMovieName) {
    return;
  }

  const subtitleRecords = await loadSubtitlesByMovieName(db, currentMovieName);
  for (const subtitleRecord of subtitleRecords) {
    sharedTranslationMap.set(
      subtitleRecord.finnishText,
      subtitleRecord.translatedText
    );
  }

  const lastAccessedTimestampMs = Date.now();

  await upsertMovieMetadata(db, currentMovieName, lastAccessedTimestampMs);
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      if (isMutationRelatedToSubtitlesWrapper(mutation)) {
        if (dualSubEnabled) {
          handleSubtitlesWrapperMutation(mutation);
          return;
        }
      }
      if (isVideoAppearMutation(mutation)) {
        // TODO: add logic to confirm the video has been loaded completely
        addDualSubExtensionSection().then(() => { }).catch((error) => {
          console.error("Error adding dual sub extension section:", error);
        });
        loadMovieCacheAndUpdateMetadata().then(() => { }).catch((error) => {
          console.warn("Error populating shared translation map from cache:", error);
        });
      }
    }
  });
});

// Start observing the document for added nodes
if (document.body instanceof Node) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

document.addEventListener("sendTranslationTextEvent", function (e) {
  /**
   * Listening for incoming subtitle texts loaded into video player from injected.js
   * Send raw Finnish text from subtitle to a translation queue
   * @param {Event} e
   */

  /** @type {string} */
  const rawSubtitleFinnishText = e.detail;

  const translationKey = toTranslationKey(rawSubtitleFinnishText);
  if (sharedTranslationMap.has(translationKey)) {
    return;
  }

  if (translationKey.length <= 1 || !/[a-zäöå]/.test(translationKey)) {
    sharedTranslationMap.set(translationKey, translationKey);
    return;
  }

  translationQueue.addToQueue(rawSubtitleFinnishText);
  translationQueue.processQueue().then(() => {
  }).catch((error) => {
    console.error("Error processing translation queue:", error);
  });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  /**
   * Listen for user setting changes for token selection in Options page
   * @param {Object} changes
   * @param {string} namespace
   */
  if (namespace === 'sync' && changes.tokenInfos) {
    if (changes.tokenInfos.newValue && Array.isArray(changes.tokenInfos.newValue)) {
      /**
       * @type {DeepLTokenInfoInStorage[]}
       */
      const deepLTokenInfos = changes.tokenInfos.newValue;
      const selectedTokenInfo = deepLTokenInfos.find(token => token.selected === true);
      const hasSelectedToken = !!selectedTokenInfo;
      _handleDualSubBehaviourBasedOnSelectedToken(hasSelectedToken);
    }
  }
});

document.addEventListener("change", function (e) {
  /**
   * Listen for user interaction events in YLE Areena page,
   * for example: dual sub switch change event
   * @param {Event} e
   */
  if (e.target.id === "dual-sub-switch") {
    dualSubEnabled = e.target.checked;
    if (e.target.checked) {
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (!originalSubtitlesWrapper) {
        console.warn("This should not happen: \
          When the video is loaded the subtitles wrapper should be there"
        );
        e.target.checked = false;
        dualSubEnabled = false;
        return;
      }
      originalSubtitlesWrapper.style.display = "none";
      const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
        originalSubtitlesWrapper
      );
      displayedSubtitlesWrapper.innerHTML = "";
      displayedSubtitlesWrapper.style.display = "flex";

      const originalSubtitlesWrapperSpans = originalSubtitlesWrapper.querySelectorAll('span');
      if (originalSubtitlesWrapperSpans) {
        addContentToDisplayedSubtitlesWrapper(
          displayedSubtitlesWrapper,
          originalSubtitlesWrapperSpans,
        )
      }
      translationQueue.processQueue().then(() => { }).catch((error) => {
        console.error("Error processing translation queue after enabling dual subtitles:", error);
      });
    }
    else {
      const displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
      if (displayedSubtitlesWrapper) {
        displayedSubtitlesWrapper.innerHTML = "";
        displayedSubtitlesWrapper.style.display = "none";
      }
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (originalSubtitlesWrapper) {
        originalSubtitlesWrapper.style.display = "flex";
      }
    }
  }
});
