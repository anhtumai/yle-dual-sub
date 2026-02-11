// ==================================
// SECTION 1: STATE & INITIALIZATION
// ==================================

/* global loadTargetLanguageFromChromeStorageSync, loadSelectedTokenFromChromeStorageSync */
/* global openDatabase, saveSubtitlesBatch, loadSubtitlesByMovieName, upsertMovieMetadata, cleanupOldMovieData */

/** @type {Map<string, string>}
 * Shared translation map, with key is normalized Finnish text, and value is translated text
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

// State of target_language (cached from chrome storage sync)
let targetLanguage = "EN-US";
loadTargetLanguageFromChromeStorageSync().then((loadedTargetLanguage) => {
  targetLanguage = loadedTargetLanguage;
}).catch((error) => {
  console.error("YleDualSubExtension: Error loading target language from storage:", error);
});

// State of Dual Sub Switch, to manage whether to add display subtitles wrapper
let dualSubEnabled = false;

// State of Blur Mode, to blur translation text until hover
let translationBlurModeEnabled = false;

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
    console.info(`YleDualSubExtension: Clean ${cleanCount} movies data`);
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
    if (this.isProcessing || this.queue.length === 0) { return; }

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
          const translatedTexts = translationResponse;
          /**
           * @type {Array<SubtitleRecord>}
           */
          const toCacheSubtitleRecords = [];
          for (let i = 0; i < toProcessItems.length; i++) {
            const translatedText = translatedTexts[i];
            const rawSubtitleFinnishText = toProcessItems[i];
            const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
            const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');
            sharedTranslationMap.set(
              sharedTranslationMapKey,
              sharedTranslationMapValue,
            );
            if (currentMovieName) {
              toCacheSubtitleRecords.push({
                "movieName": currentMovieName,
                "originalLanguage": "FI",
                targetLanguage,
                "originalText": sharedTranslationMapKey,
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
        data: { rawSubtitleFinnishTexts, targetLanguage }
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
 * which copies class, role, style, and aria-live from the original element.
 * When the extension is turned on, the original subtitles wrapper will stay hidden
 * while this displayed subtitles wrapper will be shown.
 *
 * Because, we need to listen to mutations on original subtitles wrapper,
 * so we want to avoid modifying it directly, which can trigger mutation observer recursively.
 * @param {HTMLElement} originalElement - the original element to copy attributes from
 * @returns {HTMLElement} - new subtitles wrapper div to be displayed
 */
function copySubtitlesWrapper(originalElement) {
  console.log("First debuggin", originalElement.innerHTML);
  const displayedSubtitlesWrapper = document.createElement(originalElement.tagName.toLowerCase());
  displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");
  for (const attr of ["class", "role", "aria-live", "tabindex"]) {
    const value = originalElement.getAttribute(attr);
    if (value) {
      displayedSubtitlesWrapper.setAttribute(attr, value);
    }
  }
  if (originalElement.style.cssText) {
    displayedSubtitlesWrapper.style.cssText = originalElement.style.cssText;
  }

  const subtitleRowWrapper = originalElement.querySelector('[class*="Subtitles__LiveRegion"]');

  const displayedRowsWrapper = subtitleRowWrapper.cloneNode(false);

  displayedRowsWrapper.setAttribute("id", "displayed-subtitles-rows-wrapper");
  displayedSubtitlesWrapper.appendChild(displayedRowsWrapper);

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
      originalSubtitlesWrapper,
    );
    originalSubtitlesWrapper.parentNode.insertBefore(
      displayedSubtitlesWrapper,
      originalSubtitlesWrapper.nextSibling,
    );
  }

  return displayedSubtitlesWrapper;
}

/**
 * Add both Finnish and target language subtitles to the displayed subtitles wrapper
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
  const targetLanguageText =
    sharedTranslationMap.get(translationKey) ||
    sharedTranslationErrorMap.get(translationKey) ||
    "Translating...";
  // TODO: Add retry mechanism if Translation is not found

  const blurClass = translationBlurModeEnabled ? ' translation-blurred' : '';
  const targetLanguageSpan = createSubtitleSpan(targetLanguageText, `${spanClassName} translated-text-span${blurClass}`);

  displayedSubtitlesWrapper.appendChild(finnishSpan);
  displayedSubtitlesWrapper.appendChild(targetLanguageSpan);
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
    // @ts-ignore - Node is used as HTMLElement at runtime
    originalSubtitlesWrapper
  );
  const displayedSubtitlesRowsWrapper = displayedSubtitlesWrapper.querySelector("#displayed-subtitles-rows-wrapper");
  displayedSubtitlesRowsWrapper.innerHTML = "";

  if (mutation.addedNodes.length > 0) {
    const finnishTextSpans = mutation.target.querySelectorAll("span");
    addContentToDisplayedSubtitlesWrapper(
      displayedSubtitlesWrapper,
      // @ts-ignore - NodeListOf<Element> is used as NodeListOf<HTMLSpanElement> at runtime
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
        // eslint-disable-next-line no-loop-func
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
 * Handle dual sub behaviour based on whether the system has valid key selected.
 * If no key is selected, display warning icon and disable dual sub switch.
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
          No translation key selected!<br>
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

      <button aria-label="Rewind 3 seconds" type="button" id="yle-dual-sub-rewind-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 512 512" aria-hidden="true">
          <path fill-rule="evenodd" d="M256,0C114.625,0,0,114.625,0,256,0,397.391,114.625,512,256,512S512,397.391,512,256C512,114.625,397.375,0,256,0Zm0,448C149.969,448,64,362.031,64,256S149.969,64,256,64s192,85.969,192,192S362.031,448,256,448Z"></path>
          <path fill-rule="evenodd" d="M128,256l128,96V280l96,72V160l-96,72V160Z"></path>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_rewind_tooltip">
          Rewind 3 seconds.<br />
          Tip: Click "," (comma) on keyboard can also rewind 3 seconds.
        </div>
      </button>
      <button aria-label="Forward 3 seconds" type="button" id="yle-dual-sub-forward-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 512 512" aria-hidden="true">
          <path fill-rule="evenodd" d="M256,0C114.625,0,0,114.609,0,256,0,397.375,114.625,512,256,512S512,397.375,512,256C512,114.609,397.375,0,256,0Zm0,448C149.969,448,64,362.031,64,256S149.969,64,256,64s192,85.969,192,192S362.031,448,256,448Z"></path>
          <path fill-rule="evenodd" d="M384,256,256,160v72l-96-72V352l96-72v72Z"></path>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_forward_tooltip">
          Forward 3 seconds.<br />
          Tip: Click "." (dot) on keyboard can also forward 3 seconds.
        </div>
      </button>
      <button aria-label="Blur translation" type="button" id="yle-dual-sub-blur-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_blur_tooltip" style="top: -90px;">
          This option blurs the translation text until you hover over it.<br />
          This forces you to understand Finnish texts, translation is only for difficult cases.<br />
        </div>
      </button>
      <button aria-label="Info" type="button" id="yle-dual-sub-info-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_info_tooltip" style="top: -90px; left: -200px;">
          Do you know:<br />
          We can increase/decrease subtitle size by Ctrl + / Ctrl - <br />
          YLE supports changing subtitle styles from here 
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" style="vertical-align: middle; margin-left: 4px;">
            <path fill="currentColor" fill-rule="evenodd" d="M4 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h3.76a1 1 0 0 1 .65.24l1.638 1.404a3 3 0 0 0 3.904 0l1.637-1.403a1 1 0 0 1 .65-.241H20a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zM3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.76a3 3 0 0 0-1.952.722l-1.637 1.403a1 1 0 0 1-1.302 0l-1.636-1.403A3 3 0 0 0 7.76 19H4a1 1 0 0 1-1-1zm16 6a1 1 0 0 1-1 1h-7a1 1 0 1 1 0-2h7a1 1 0 0 1 1 1M8 12a1 1 0 0 1-1 1H6a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1m-3 4a1 1 0 0 1 1-1h7a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1m11 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1" clip-rule="evenodd"/>
          </svg>
        </div>
      </button>

    </div>
  `
  bottomControlBarLeftControls.insertAdjacentHTML('beforeend', dualSubExtensionSection);

  // Display warning section if no key is selected
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
    // @ts-ignore - EventTarget is used as Node at runtime
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
      videoElement.currentTime = videoElement.currentTime + 3;
    }

    function videoRewind() {
      videoElement.currentTime = Math.max(0, videoElement.currentTime - 3);
    }

    document.addEventListener('keydown', (event) => {
      if (!videoElement) { return; }

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

  // Blur button logic
  const blurButton = document.getElementById('yle-dual-sub-blur-button');
  if (blurButton) {
    blurButton.addEventListener('click', () => {
      translationBlurModeEnabled = !translationBlurModeEnabled;
      if (translationBlurModeEnabled) {
        blurButton.style.color = 'rgba(236, 72, 153, 1)';
      } else {
        blurButton.style.color = '';
      }
      // Toggle blur on all existing translation spans
      document.querySelectorAll('.translated-text-span').forEach(span => {
        span.classList.toggle('translation-blurred', translationBlurModeEnabled);
      });
    });
  }
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

  const subtitleRecords = await loadSubtitlesByMovieName(db, currentMovieName, targetLanguage);
  if (Array.isArray(subtitleRecords) && subtitleRecords.length >= 0) {
    console.info(`YleDualSubExtension: Loaded ${subtitleRecords.length} cached subtitles for movie: ${currentMovieName}`);
  }
  for (const subtitleRecord of subtitleRecords) {
    sharedTranslationMap.set(
      subtitleRecord.originalText,
      subtitleRecord.translatedText
    );
  }

  const lastAccessedDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));

  await upsertMovieMetadata(db, currentMovieName, lastAccessedDays);
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

document.addEventListener("sendTranslationTextEvent", (e) => {
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
   * Listen for user setting changes for key selection in Options page
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
  if (namespace === 'sync' && changes.targetLanguage) {
    if (changes.targetLanguage.newValue && typeof changes.targetLanguage.newValue === 'string') {
      alert(`Your target language has changed to ${changes.targetLanguage.newValue}. ` +
        `We need to reload the page for the change to work.`);
      location.reload();
    }
  }
});

document.addEventListener("change", (e) => {
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
        // @ts-ignore - Element is used as HTMLElement at runtime
        originalSubtitlesWrapper
      );
      const displayedSubtitlesRowsWrapper = displayedSubtitlesWrapper.querySelector("#displayed-subtitles-rows-wrapper");
      displayedSubtitlesRowsWrapper.innerHTML = "";
      displayedSubtitlesWrapper.style.display = "flex";

      const originalSubtitlesWrapperSpans = originalSubtitlesWrapper.querySelectorAll('span');
      if (originalSubtitlesWrapperSpans) {
        addContentToDisplayedSubtitlesWrapper(
          displayedSubtitlesWrapper,
          // @ts-ignore - NodeListOf<Element> is used as NodeListOf<HTMLSpanElement> at runtime
          originalSubtitlesWrapperSpans,
        )
      }
      translationQueue.processQueue().then(() => { }).catch((error) => {
        console.error("YleDualSubExtension: Error processing translation queue after enabling dual subtitles:", error);
      });
    }
    else {
      const displayedSubtitlesRowsWrapper = document.getElementById("displayed-subtitles-rows-wrapper");
      if (displayedSubtitlesRowsWrapper) {
        displayedSubtitlesRowsWrapper.innerHTML = "";
        displayedSubtitlesRowsWrapper.style.display = "none";
      }
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (originalSubtitlesWrapper) {
        originalSubtitlesWrapper.style.display = "flex";
      }
    }
  }
});
