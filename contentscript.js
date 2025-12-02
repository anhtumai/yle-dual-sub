// ==================================
// SECTION 1: STATE & INITIALIZATION
// ==================================


/** @type {Map<string, string>}
 * Shared translation map, with key is normalized Finnish text, and value is English text
 */
const sharedTranslationMap = new Map();
/** @type {Map<string, string>} */
const sharedTranslationErrorMap = new Map();

/**
 *
 * @param {string} rawSubtitleFinnishText
 * @returns {string}
 */
function toTranslationKey(rawSubtitleFinnishText) {
  return rawSubtitleFinnishText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
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
    console.log(`YleDualSubExtension: Clean ${cleanCount} movies data`);
  }).catch(error => { console.error("YleDualSubExtension: Error when cleaning old movie data: ", error) });
}).
  catch((error) => {
    console.error("YleDualSubExtension: Failed to established connection to indexDB: ", error);
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
        const [isSucceeded, translationResponse] = await fetchTranslation(toProcessItems);

        if (isSucceeded) {
          const translatedEnglishTexts = translationResponse;
          /**
           * @type {Array<SubtitleRecord>}
           */
          const toCacheSubtitleRecords = [];
          for (let i = 0; i < toProcessItems.length; i++) {
            const translatedEnglishText = translatedEnglishTexts[i];
            const rawSubtitleFinnishText = toProcessItems[i];
            const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
            const sharedTranslationMapValue = translatedEnglishText.trim().replace(/\n/g, ' ');
            sharedTranslationMap.set(
              sharedTranslationMapKey,
              sharedTranslationMapValue,
            );
            if (currentMovieName) {
              toCacheSubtitleRecords.push({
                "movieName": currentMovieName,
                "finnishText": sharedTranslationMapKey,
                "translatedText": sharedTranslationMapValue,
              })
            }
          }
          if (globalDatabaseInstance) {
            saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords)
              .then(() => { })
              .catch((error) => {
                console.error("YleDualSubExtension: Error saving subtitles batch to cache:", error);
              });
          }
        }
        else {
          const translationErrorMessage = translationResponse;
          for (let i = 0; i < toProcessItems.length; i++) {
            const rawSubtitleFinnishText = toProcessItems[i];
            sharedTranslationErrorMap.set(
              toTranslationKey(rawSubtitleFinnishText),
              `Error: ${translationErrorMessage}`
            );
          }
        }

      } catch (error) {
        console.error("YleDualSubExtension: System error when translating text:", error);
      }
    }

    this.isProcessing = false;
  }
}

const translationQueue = new TranslationQueue();


/**
 * 
 * @param {Array<string>} rawSubtitleFinnishTexts - Finnish text to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.

 */
async function fetchTranslation(rawSubtitleFinnishTexts) {
  try {
    /**
     * @type {[true, Array<string>] | [false, string]}
     */
    const response = await chrome.runtime.sendMessage(
      {
        action: 'fetchTranslation',
        data: { rawSubtitleFinnishTexts: rawSubtitleFinnishTexts }
      });
    return response;
  } catch (error) {
    console.error("YleDualSubExtension: Error sending message to background for translation:", error);
    return [false, error.message || String(error)];
  }
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
    console.warn("YleDualSubExtension: Catch error checking mutation related to subtitles wrapper:", error);
    return false;
  }
}

/**
 * Create and position the displayed subtitles wrapper next to the original subtitles wrapper
 * if it does not exist yet
 *
 * @param {HTMLElement} originalSubtitlesWrapper
 * @returns {HTMLElement}
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


// Debounce flag to prevent duplicate initialization during rapid DOM mutations.
// Set to true when video detection starts, prevents re-triggering for 1.5 seconds.
// This handles the case where video player construction fires multiple sequential mutations.
let checkVideoAppearMutationDebounceFlag = false;
/**
 * Generic video element detection - detects when any <video> element appears in the DOM
 * Works for both:
 * - Initial load: when video container is added with video already inside
 * - Episode transitions: when video element is added to existing container
 *
 * Future-proof: doesn't rely on YLE Areena's specific class names
 * NOTE: This function relies on an assumption that there is only one video element in the page at any time.
 * If YLE Areena changes to have multiple video elements, this logic may need to be revised.
 * @param {MutationRecord} mutation
 * @returns {boolean}
 */
function isVideoElementAppearMutation(mutation) {
  if (checkVideoAppearMutationDebounceFlag) {
    return false;
  }
  try {
    // Must be a childList mutation with added nodes
    if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
      return false;
    }

    // Check each added node
    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = /** @type {HTMLElement} */ (node);

      // Case 1: The added node IS a video element
      // Case 2: The added node CONTAINS a video element (initial load scenario)
      if (element.tagName === "VIDEO" || element.querySelector?.('video')) {
        checkVideoAppearMutationDebounceFlag = true;
        setTimeout(() => { checkVideoAppearMutationDebounceFlag = false; }, 1500);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn("YleDualSubExtension: Error checking video element mutation:", error);
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

  for (let attempt = 0; attempt < 8; attempt++) {
    bottomControlBarLeftControls = document.querySelector(
      '[class^="BottomControlBar__LeftControls"]'
    );
    if (bottomControlBarLeftControls) {
      break;
    };
    await sleep(150);
  }

  if (!bottomControlBarLeftControls) {
    console.error("YleDualSubExtension: Cannot find bottom control bar left controls");
    return;
  }

  const existingSection = document.querySelector(".dual-sub-extension-section");
  if (existingSection) {
    try {
      existingSection.remove();
    } catch (err) {
      // Probably never happens, but just in case
      console.error("YleDualSubExtension: Error removing existing dual sub extension section:", err);
      if (existingSection.parentNode) {
        try {
          existingSection.parentNode.removeChild(existingSection);
        } catch (error) {
          console.error("YleDualSubExtension: Error removing existing dual sub extension section via parentNode:", error);
        }
      }
    }
  }

  const dualSubExtensionSection = `
    <div class="dual-sub-extension-section">
      <span>Dual Sub:</span>
      <input id="dual-sub-switch" class="dual-sub-switch" type="checkbox" ${dualSubEnabled ? 'checked' : ''}>
      <span class="dual-sub-warning" style="display: none;">
        <span class="dual-sub-warning__icon">
          !
        </span>
        <span class="dual-sub-warning__popover">
          No translation token selected!<br>
          Please select one in <a href="#" id="open-options-link">the option page</a>.<br>
          Follow
          <a href="https://anhtumai.github.io/yle-dual-sub"
             target="_blank"
             rel="noopener noreferrer">
            this guide
          </a>
          for more information.
        </span>
      </span>

      <button aria-label="Open settings" type="button" id="yle-dual-sub-settings-button" style="margin-left: 16px;">
        <svg width="22" height="22" fill="none" viewBox="0 0 22 22" aria-hidden="true">
          <path fill="currentColor" d="M20.207 9.017l-1.845-.424a7.2 7.2 0 0 0-.663-1.6l1.045-1.536a1 1 0 0 0-.121-1.29l-1.398-1.398a1 1 0 0 0-1.29-.121l-1.536 1.045a7.2 7.2 0 0 0-1.6-.663l-.424-1.845A1 1 0 0 0 11.4.75h-1.978a1 1 0 0 0-.975.435l-.424 1.845a7.2 7.2 0 0 0-1.6.663L4.887 2.648a1 1 0 0 0-1.29.121L2.199 4.167a1 1 0 0 0-.121 1.29l1.045 1.536a7.2 7.2 0 0 0-.663 1.6l-1.845.424A1 1 0 0 0 .18 10v1.978a1 1 0 0 0 .435.975l1.845.424a7.2 7.2 0 0 0 .663 1.6l-1.045 1.536a1 1 0 0 0 .121 1.29l1.398 1.398a1 1 0 0 0 1.29.121l1.536-1.045a7.2 7.2 0 0 0 1.6.663l.424 1.845a1 1 0 0 0 .975.435h1.978a1 1 0 0 0 .975-.435l.424-1.845a7.2 7.2 0 0 0 1.6-.663l1.536 1.045a1 1 0 0 0 1.29-.121l1.398-1.398a1 1 0 0 0 .121-1.29l-1.045-1.536a7.2 7.2 0 0 0 .663-1.6l1.845-.424a1 1 0 0 0 .435-.975V10a1 1 0 0 0-.435-.975v-.008zM11 15a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_settings_tooltip" style="top: -72px;">
          Open settings
        </div>
      </button>

      <button aria-label="Rewind 1 second" type="button" id="yle-dual-sub-rewind-button">
        <svg width="22" height="22" fill="none" viewBox="0 0 22 22" aria-hidden="true">
          <path fill="currentColor" fill-rule="evenodd" d="M16.377 1.375A10.8 10.8 0 0 0 9.579.107 10.87 10.87 0 0 0 3.75 2.876V1.125a.875.875 0 1 0-1.75 0v4c0 .483.392.875.875.875h4a.875.875 0 1 0 0-1.75H5.213a8.86 8.86 0 0 1 4.649-2.162A8.8 8.8 0 0 1 15.4 3.12a8.96 8.96 0 0 1 3.82 4.197A9.1 9.1 0 0 1 19.778 13a9 9 0 0 1-2.933 4.875 8.85 8.85 0 0 1-5.235 2.111 8.83 8.83 0 0 1-5.439-1.49c-1.655-1.113-3.728-3.014-4.179-6.619a1 1 0 1 0-1.984.248c.55 4.395 3.129 6.74 5.047 8.03a10.83 10.83 0 0 0 6.671 1.828 10.85 10.85 0 0 0 6.419-2.588 11 11 0 0 0 3.584-5.955 11.1 11.1 0 0 0-.68-6.931 10.96 10.96 0 0 0-4.672-5.133M11.85 13.957a.456.456 0 0 1-.457.456h-.672a.456.456 0 0 1-.457-.456v-4.21l-.41.325a.456.456 0 0 1-.64-.074l-.366-.461a.457.457 0 0 1 .083-.649L10.538 7.68a.46.46 0 0 1 .275-.092h.581c.252 0 .457.205.457.457z" clip-rule="evenodd"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_rewind_tooltip">
          Rewind 1 second.<br />
          Tip: Click "," (comma) on keyboard can also rewind 1 second.
        </div>
      </button>
      <button aria-label="Forward 1 second" type="button" id="yle-dual-sub-forward-button">
        <svg width="22" height="22" fill="none" viewBox="0 0 22 22" aria-hidden="true">
          <path fill="currentColor" fill-rule="evenodd" d="M12.42.107a10.8 10.8 0 0 0-6.797 1.268A10.96 10.96 0 0 0 .95 6.508a11.1 11.1 0 0 0-.679 6.93 11 11 0 0 0 3.585 5.956 10.85 10.85 0 0 0 6.418 2.588 10.83 10.83 0 0 0 6.67-1.828c1.92-1.29 4.499-3.635 5.048-8.03a1 1 0 1 0-1.984-.248c-.45 3.605-2.524 5.506-4.18 6.619a8.83 8.83 0 0 1-5.438 1.49 8.85 8.85 0 0 1-5.235-2.111 9 9 0 0 1-2.933-4.875 9.1 9.1 0 0 1 .557-5.68 8.96 8.96 0 0 1 3.82-4.198 8.8 8.8 0 0 1 5.54-1.033 8.85 8.85 0 0 1 4.649 2.162h-1.663a.875.875 0 1 0 0 1.75h4A.875.875 0 0 0 20 5.125v-4a.875.875 0 0 0-1.75 0v1.751A10.86 10.86 0 0 0 12.42.107M11.85 13.963a.456.456 0 0 1-.456.456h-.672a.456.456 0 0 1-.457-.457V9.754l-.41.325a.457.457 0 0 1-.641-.074l-.365-.462a.457.457 0 0 1 .083-.648l1.606-1.21a.46.46 0 0 1 .275-.091h.581c.252 0 .456.204.456.457z" clip-rule="evenodd"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_forward_tooltip">
          Forward 1 second.<br />
          Tip: Click "." (dot) on keyboard can also forward 1 second.
        </div>
      </button>

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

  // Setting button logic
  const settingsButton = document.getElementById('yle-dual-sub-settings-button');
  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openOptionsPage' });
    });
  }
  else {
    console.error("YleDualSubExtension: Cannot find settings button");
  }

  // Rewind and forward button logic
  function rewindForwardLogicHandle() {
    const videoElement = document.querySelector('video');
    if (!videoElement) {
      console.error("YleDualSubExtension: Cannot find video element");
      return;
    }

    function videoForward() {
      videoElement.currentTime = videoElement.currentTime + 1;
    }

    function videoRewind() {
      videoElement.currentTime = Math.max(0, videoElement.currentTime - 1);
    }

    document.addEventListener('keydown', (event) => {
      if (!videoElement) return;

      if (event.key === ',') {
        event.preventDefault();
        videoRewind();
      } else if (event.key === '.') {
        event.preventDefault();
        videoForward();
      }
    });

    const rewindButton = document.getElementById('yle-dual-sub-rewind-button');
    const forwardButton = document.getElementById('yle-dual-sub-forward-button');

    if (rewindButton) {
      rewindButton.addEventListener('click', () => {
        videoRewind();
      });
    }
    else {
      console.error("YleDualSubExtension: Cannot find rewind button");
    }

    if (forwardButton) {
      forwardButton.addEventListener('click', () => {
        videoForward();
      });
    }
    else {
      console.error("YleDualSubExtension: Cannot find forward button");
    }
  }
  rewindForwardLogicHandle();
}

/**
 * Get video title once the video player is loaded
 * @returns {Promise<string | null>}
 */
async function getVideoTitle() {

  let titleElement = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    titleElement = document.querySelector('[class*="VideoTitle__Titles"]');
    if (titleElement) {
      break;
    };
    await sleep(150);
  }

  if (!titleElement) {
    console.error("YleDualSubExtension: Cannot get movie name. Title Element is null.");
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
 * @returns {Promise<void>}
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
      if (isVideoElementAppearMutation(mutation)) {
        addDualSubExtensionSection().then(() => { }).catch((error) => {
          console.error("YleDualSubExtension: Error adding dual sub extension section:", error);
        });
        loadMovieCacheAndUpdateMetadata().then(() => { }).catch((error) => {
          console.error("YleDualSubExtension: Error populating shared translation map from cache:", error);
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
    console.error("YleDualSubExtension: Error processing translation queue:", error);
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
        console.error(
          "YleDualSubExtension: This should not happen: " +
          "When the video is loaded the subtitles wrapper should be there"
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
        console.error("YleDualSubExtension: Error processing translation queue after enabling dual subtitles:", error);
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
