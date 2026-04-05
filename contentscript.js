// ==================================
// SECTION 1: STATE & INITIALIZATION
// ==================================

const BLUR_BUTTON_COLOR_ACTIVE = 'rgba(236, 72, 153, 1)';

// Blur mode SVG icons
const VISIBILITY_ON_SVG = `<svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
</svg>`;

const VISIBILITY_OFF_SVG = `<svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
</svg>`;


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

/** @enum {string} */
const BlurMode = Object.freeze({
  BLUR_TRANSLATION: "blur-translation",
  BLUR_FINNISH: "blur-finnish",
  BLUR_BOTH: "blur-both",
  NO_BLUR: "no-blur",
});
const BLUR_MODE_LABELS = {
  [BlurMode.BLUR_BOTH]: 'Blur both',
  [BlurMode.BLUR_TRANSLATION]: 'Blur translation',
  [BlurMode.BLUR_FINNISH]: 'Blur Finnish',
  [BlurMode.NO_BLUR]: 'No blur',
};
/** @type {BlurMode[keyof BlurMode]} */
let translationBlurMode = BlurMode.NO_BLUR;

/** @returns {boolean} Whether Finnish subtitle text should be blurred */
function shouldBlurFinnish() {
  return translationBlurMode === BlurMode.BLUR_BOTH ||
    translationBlurMode === BlurMode.BLUR_FINNISH;
}

/** @returns {boolean} Whether translation subtitle text should be blurred */
function shouldBlurTranslation() {
  return translationBlurMode === BlurMode.BLUR_BOTH ||
    translationBlurMode === BlurMode.BLUR_TRANSLATION;
}

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
 * Create another element for displaying translated subtitles,
 * which copies every non-identity attributes from the original element.
 * When the extension is turned on, the original subtitles wrapper will stay hidden
 * while this displayed subtitles wrapper will be shown.
 *
 * Because, we need to listen to mutations on original subtitles wrapper,
 * so we want to avoid modifying it directly, which can trigger mutation observer recursively.
 * @param {HTMLElement} originalSubtitlesWrapper - the original element to copy attributes from
 * @returns {HTMLElement} - new subtitles wrapper element to be displayed
 */
function copySubtitlesWrapper(originalSubtitlesWrapper) {
  const displayedSubtitlesWrapper =
    /** @type {HTMLElement} */ (originalSubtitlesWrapper.cloneNode(false));
  displayedSubtitlesWrapper.removeAttribute("data-testid");
  displayedSubtitlesWrapper.removeAttribute("aria-label");
  displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");

  const subtitleRowWrapper = originalSubtitlesWrapper.querySelector('[class*="Subtitles__LiveRegion"]');

  let displayedRowsWrapper;
  if (subtitleRowWrapper) {
    displayedRowsWrapper =
      /** @type {HTMLElement} */ (subtitleRowWrapper.cloneNode(false));
  }
  else {
    displayedRowsWrapper = document.createElement("div");
  }

  displayedRowsWrapper.setAttribute("id", "displayed-subtitles-rows-wrapper");
  displayedSubtitlesWrapper.appendChild(displayedRowsWrapper);

  return displayedSubtitlesWrapper;
}

/**
 * Check if a mutation is related to subtitles wrapper 
 * @param {MutationRecord} mutation
 * @returns {boolean} - true if the mutation is related to subtitles wrapper
 */
function isMutationRelatedToSubtitlesWrapper(mutation) {
  try {
    // @ts-ignore - Node is used as HTMLElement at runtime
    return mutation.target instanceof HTMLElement && mutation.target.id !== "displayed-subtitles-rows-wrapper" && mutation.target.className.includes("Subtitles__LiveRegion");
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
 * @param {NodeListOf<HTMLDivElement>} originalSubtitleRows
 * original Finnish subtitle row divs (data-testid="subtitle-row")
 */
function addContentToDisplayedSubtitlesWrapper(
  displayedSubtitlesWrapper,
  originalSubtitleRows,
) {
  if (!originalSubtitleRows || originalSubtitleRows.length === 0) {
    return;
  }
  const firstOriginalSubtitleRow = originalSubtitleRows[0];

  const finnishText = Array.from(originalSubtitleRows).map(
    subtitleRow => subtitleRow.innerText
  ).join(" ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();


  if (!finnishText || finnishText.length === 0) {
    return;
  }

  const finnishSubtitleRowElement =
    /** @type {HTMLElement} */ (firstOriginalSubtitleRow.cloneNode(false));
  finnishSubtitleRowElement.removeAttribute("data-testid");
  finnishSubtitleRowElement.setAttribute("id", "finnish-subtitle-row");
  finnishSubtitleRowElement.textContent = finnishText;

  const translationKey = toTranslationKey(finnishText);
  const targetLanguageText =
    sharedTranslationMap.get(translationKey) ||
    sharedTranslationErrorMap.get(translationKey) ||
    "Translating...";
  // TODO: Add retry mechanism if Translation is not found

  const targetLanguageRowElement =
    /** @type {HTMLElement} */ (finnishSubtitleRowElement.cloneNode(false));
  targetLanguageRowElement.removeAttribute("data-testid");
  targetLanguageRowElement.setAttribute("id", "target-language-subtitle-row");

  targetLanguageRowElement.textContent = targetLanguageText;
  targetLanguageRowElement.classList.add("translated-subtitle-row");

  if (shouldBlurFinnish()) {
    finnishSubtitleRowElement.classList.add("translation-blurred");
  }
  if (shouldBlurTranslation()) {
    targetLanguageRowElement.classList.add("translation-blurred");
  }

  const displayedSubtitlesRowsWrapper = displayedSubtitlesWrapper.querySelector("#displayed-subtitles-rows-wrapper");

  displayedSubtitlesRowsWrapper.appendChild(finnishSubtitleRowElement);
  displayedSubtitlesRowsWrapper.appendChild(targetLanguageRowElement);
}

/**
 * Render dual subtitles when there is mutation on original subtitles wrapper
 * Hide the original subtitles wrapper and create another div for displaying translated subtitles
 * along with original Finnish subtitles.
 * 
 * @param {MutationRecord} mutation
 * @returns {void}
 */
function renderDualSubtitles(mutation) {
  const originalSubtitlesRowsWrapper = mutation.target;
  const originalSubtitlesWrapper = originalSubtitlesRowsWrapper.parentElement;
  originalSubtitlesWrapper.style.display = "none";

  const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
    // @ts-ignore - Node is used as HTMLElement at runtime
    originalSubtitlesWrapper
  );
  // This case is hit when users move to the next video, regardless of the state of dualsub switch
  // displayed subtitles wrapper still exists in DOM, but its display is set to none
  if (displayedSubtitlesWrapper.style.display === "none") {
    displayedSubtitlesWrapper.style.display = "flex";
  }
  const displayedSubtitlesRowsWrapper = displayedSubtitlesWrapper.querySelector("#displayed-subtitles-rows-wrapper");
  displayedSubtitlesRowsWrapper.innerHTML = "";

  if (mutation.addedNodes.length > 0) {
    const finnishSubtitleRowDivs = mutation.target.querySelectorAll('[data-testid="subtitle-row"]');
    addContentToDisplayedSubtitlesWrapper(
      displayedSubtitlesWrapper,
      // @ts-ignore - NodeListOf<Element> is used as NodeListOf<HTMLDivElement> at runtime
      finnishSubtitleRowDivs,
    )
  }
}

/**
 * Apply blur effect to original Finnish subtitle rows when dual sub is off.
 *
 * @param {MutationRecord} mutation
 * @returns {void}
 */
function applyBlurToOriginalSubtitles(mutation) {
  const originalSubtitlesWrapper = mutation.target.parentElement;
  const originalSubtitleRows = originalSubtitlesWrapper.querySelectorAll('[data-testid="subtitle-row"]');
  const blurFinnish = shouldBlurFinnish();
  originalSubtitleRows.forEach(row => {
    row.classList.toggle('translation-blurred', blurFinnish);
  });
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
        <div aria-hidden="true" class="dual-sub-extension-section_settings_tooltip">
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
      
      <div class="dual-sub-blur-mode-group">
        <div class="dual-sub-extension-section_blur_mode_menu_container">
          <button aria-label="Blur translation" type="button" id="yle-dual-sub-blur-mode-menu-btn"></button>
          <div class="dual-sub-blur-dropdown" id="yle-dual-sub-blur-mode-dropdown">
            <button data-blur="${BlurMode.BLUR_BOTH}">${BLUR_MODE_LABELS[BlurMode.BLUR_BOTH]}</button>
            <button data-blur="${BlurMode.BLUR_TRANSLATION}">${BLUR_MODE_LABELS[BlurMode.BLUR_TRANSLATION]}</button>
            <button data-blur="${BlurMode.BLUR_FINNISH}">${BLUR_MODE_LABELS[BlurMode.BLUR_FINNISH]}</button>
            <button data-blur="${BlurMode.NO_BLUR}">${BLUR_MODE_LABELS[BlurMode.NO_BLUR]}</button>
            <div class="dual-sub-blur-dropdown-hint">Hover blurred text to reveal</div>
          </div>
        </div>
        <span id="yle-dual-sub-blur-mode-label" class="dual-sub-blur-mode-label"></span>
      </div>

      <button aria-label="Copy Finnish subtitle" type="button" id="yle-dual-sub-copy-subtitle-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_copy_subtitle_tooltip">
          Copy Finnish subtitle to clipboard.
        </div>
      </button>

      <button aria-label="Reload subtitle token" type="button" id="yle-dual-sub-reload-subtitle-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.39502 12.0014C4.39544 12.4156 4.73156 12.751 5.14577 12.7506C5.55998 12.7502 5.89544 12.4141 5.89502 11.9999L4.39502 12.0014ZM6.28902 8.1116L6.91916 8.51834L6.91952 8.51777L6.28902 8.1116ZM9.33502 5.5336L9.0396 4.84424L9.03866 4.84464L9.33502 5.5336ZM13.256 5.1336L13.4085 4.39927L13.4062 4.39878L13.256 5.1336ZM16.73 7.0506L16.1901 7.57114L16.1907 7.57175L16.73 7.0506ZM17.7142 10.2078C17.8286 10.6059 18.2441 10.8358 18.6422 10.7214C19.0403 10.607 19.2703 10.1915 19.1558 9.79342L17.7142 10.2078ZM17.7091 9.81196C17.6049 10.2129 17.8455 10.6223 18.2464 10.7265C18.6473 10.8307 19.0567 10.5901 19.1609 10.1892L17.7091 9.81196ZM19.8709 7.45725C19.9751 7.05635 19.7346 6.6469 19.3337 6.54272C18.9328 6.43853 18.5233 6.67906 18.4191 7.07996L19.8709 7.45725ZM18.2353 10.7235C18.6345 10.8338 19.0476 10.5996 19.1579 10.2004C19.2683 9.80111 19.034 9.38802 18.6348 9.2777L18.2353 10.7235ZM15.9858 8.5457C15.5865 8.43537 15.1734 8.66959 15.0631 9.06884C14.9528 9.46809 15.187 9.88119 15.5863 9.99151L15.9858 8.5457ZM19.895 11.9999C19.8946 11.5856 19.5585 11.2502 19.1443 11.2506C18.7301 11.251 18.3946 11.5871 18.395 12.0014L19.895 11.9999ZM18.001 15.8896L17.3709 15.4829L17.3705 15.4834L18.001 15.8896ZM14.955 18.4676L15.2505 19.157L15.2514 19.1566L14.955 18.4676ZM11.034 18.8676L10.8815 19.6019L10.8839 19.6024L11.034 18.8676ZM7.56002 16.9506L8.09997 16.4301L8.09938 16.4295L7.56002 16.9506ZM6.57584 13.7934C6.46141 13.3953 6.04593 13.1654 5.64784 13.2798C5.24974 13.3942 5.01978 13.8097 5.13421 14.2078L6.57584 13.7934ZM6.58091 14.1892C6.6851 13.7884 6.44457 13.3789 6.04367 13.2747C5.64277 13.1705 5.23332 13.4111 5.12914 13.812L6.58091 14.1892ZM4.41914 16.544C4.31495 16.9449 4.55548 17.3543 4.95638 17.4585C5.35727 17.5627 5.76672 17.3221 5.87091 16.9212L4.41914 16.544ZM6.05478 13.2777C5.65553 13.1674 5.24244 13.4016 5.13212 13.8008C5.02179 14.2001 5.25601 14.6132 5.65526 14.7235L6.05478 13.2777ZM8.30426 15.4555C8.70351 15.5658 9.11661 15.3316 9.22693 14.9324C9.33726 14.5331 9.10304 14.12 8.70378 14.0097L8.30426 15.4555ZM5.89502 11.9999C5.89379 10.7649 6.24943 9.55591 6.91916 8.51834L5.65889 7.70487C4.83239 8.98532 4.3935 10.4773 4.39502 12.0014L5.89502 11.9999ZM6.91952 8.51777C7.57513 7.50005 8.51931 6.70094 9.63139 6.22256L9.03866 4.84464C7.65253 5.4409 6.47568 6.43693 5.65852 7.70544L6.91952 8.51777ZM9.63045 6.22297C10.7258 5.75356 11.9383 5.62986 13.1059 5.86842L13.4062 4.39878C11.9392 4.09906 10.4158 4.25448 9.0396 4.84424L9.63045 6.22297ZM13.1035 5.86793C14.2803 6.11232 15.3559 6.7059 16.1901 7.57114L17.27 6.53006C16.2264 5.44761 14.8807 4.70502 13.4085 4.39927L13.1035 5.86793ZM16.1907 7.57175C16.9065 8.31258 17.4296 9.21772 17.7142 10.2078L19.1558 9.79342C18.8035 8.5675 18.1557 7.44675 17.2694 6.52945L16.1907 7.57175ZM19.1609 10.1892L19.8709 7.45725L18.4191 7.07996L17.7091 9.81196L19.1609 10.1892ZM18.6348 9.2777L15.9858 8.5457L15.5863 9.99151L18.2353 10.7235L18.6348 9.2777ZM18.395 12.0014C18.3963 13.2363 18.0406 14.4453 17.3709 15.4829L18.6312 16.2963C19.4577 15.0159 19.8965 13.5239 19.895 11.9999L18.395 12.0014ZM17.3705 15.4834C16.7149 16.5012 15.7707 17.3003 14.6587 17.7786L15.2514 19.1566C16.6375 18.5603 17.8144 17.5643 18.6315 16.2958L17.3705 15.4834ZM14.6596 17.7782C13.5643 18.2476 12.3517 18.3713 11.1842 18.1328L10.8839 19.6024C12.3508 19.9021 13.8743 19.7467 15.2505 19.157L14.6596 17.7782ZM11.1865 18.1333C10.0098 17.8889 8.93411 17.2953 8.09997 16.4301L7.02008 17.4711C8.06363 18.5536 9.40936 19.2962 10.8815 19.6019L11.1865 18.1333ZM8.09938 16.4295C7.38355 15.6886 6.86042 14.7835 6.57584 13.7934L5.13421 14.2078C5.48658 15.4337 6.13433 16.5545 7.02067 17.4718L8.09938 16.4295ZM5.12914 13.812L4.41914 16.544L5.87091 16.9212L6.58091 14.1892L5.12914 13.812ZM5.65526 14.7235L8.30426 15.4555L8.70378 14.0097L6.05478 13.2777L5.65526 14.7235Z"></path>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_reload_subtitle_tooltip">
          Click to reload subtitles for the whole episode. <br />
        </div>
      </button>

      <button aria-label="Info" type="button" id="yle-dual-sub-info-button">
        <svg width="27" height="27" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <div aria-hidden="true" class="dual-sub-extension-section_info_tooltip" style="left: -200px;">
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

  // Blur mode menu logic
  const blurModeMenuButton = document.getElementById('yle-dual-sub-blur-mode-menu-btn');
  const blurModeDropdown = document.getElementById('yle-dual-sub-blur-mode-dropdown');
  const blurModeLabel = document.getElementById('yle-dual-sub-blur-mode-label');

  function updateBlurModeButtonAppearance() {
    if (translationBlurMode === BlurMode.NO_BLUR) {
      blurModeMenuButton.innerHTML = VISIBILITY_ON_SVG;
      blurModeMenuButton.style.color = "";
    } else {
      blurModeMenuButton.innerHTML = VISIBILITY_OFF_SVG;
      blurModeMenuButton.style.color = BLUR_BUTTON_COLOR_ACTIVE;
    }
    blurModeLabel.textContent = BLUR_MODE_LABELS[translationBlurMode] || 'Unknown';
  }
  updateBlurModeButtonAppearance();

  blurModeMenuButton.addEventListener('click', () => {
    blurModeDropdown.classList.toggle('open');
  });

  blurModeDropdown.addEventListener('click', (e) => {
    const blurModeOptionButton = /** @type {HTMLElement} */ (e.target).closest('button[data-blur]');
    if (!blurModeOptionButton) { return; }

    translationBlurMode = blurModeOptionButton.dataset.blur;

    blurModeDropdown.classList.remove('open');
    updateBlurModeButtonAppearance();

    if (dualSubEnabled) {
      const finnishSubtitleRowElement = document.getElementById("finnish-subtitle-row");
      const targetLanguageSubtitleRowElement = document.getElementById("target-language-subtitle-row");
      if (finnishSubtitleRowElement) {
        finnishSubtitleRowElement.classList.toggle('translation-blurred', shouldBlurFinnish());
      }
      if (targetLanguageSubtitleRowElement) {
        targetLanguageSubtitleRowElement.classList.toggle('translation-blurred', shouldBlurTranslation());
      }
    } else {
      const originalSubtitleRows = document.querySelectorAll('[data-testid="subtitle-row"]');
      originalSubtitleRows.forEach(row => {
        row.classList.toggle('translation-blurred', shouldBlurFinnish());
      });
    }
  });

  document.addEventListener('click', (e) => {
    // @ts-ignore - EventTarget is used as Node at runtime
    if (!warningPopover.contains(e.target) && !warningIcon.contains(e.target)) {
      warningPopover.classList.remove("active");
    }
    // @ts-ignore - EventTarget is used as Node at runtime
    if (!blurModeMenuButton.contains(e.target) && !blurModeDropdown.contains(e.target)) {
      blurModeDropdown.classList.remove('open');
    }
  });

  // Copy Finnish subtitle button logic
  const copySubtitleButton = document.getElementById('yle-dual-sub-copy-subtitle-button');
  if (copySubtitleButton) {
    copySubtitleButton.addEventListener('click', () => {
      const text = document.getElementById('finnish-subtitle-row')?.textContent || '';
      if (text) {
        navigator.clipboard.writeText(text);
      }
    });
  }

  // Reload subtitle button logic
  const reloadSubtitleButton = document.getElementById('yle-dual-sub-reload-subtitle-button');
  if (reloadSubtitleButton) {
    reloadSubtitleButton.addEventListener('click', () => {
      const isConfirmed = confirm(
        "This will clear cached subtitles and re-translate the entire episode. " +
        "It may improve translation accuracy but will use additional DeepL credits. " +
        "Continue?"
      );

      if (isConfirmed) {
        sharedTranslationMap.clear();
        if (globalDatabaseInstance && currentMovieName) {
          clearSubtitlesByMovieName(globalDatabaseInstance, currentMovieName).then(() => {
            console.info(`YleDualSubExtension: Cleared cached subtitles for movie: ${currentMovieName}`);
          }).catch((error) => {
            console.error("YleDualSubExtension: Error clearing cached subtitles for current movie:", error);
            alert(`Error clearing cache: ${error?.message || "Unknown error"}`);
          }).finally(() => {
            alert("We need to reload the page to apply changes.");
            location.reload();
          });
        } else {
          console.warn(
            "YleDualSubExtension: No database instance or current movie name found. " +
            "Cannot clear cached subtitles from database."
          );
          alert("We need to reload the page to apply changes.");
          location.reload();
        }
      }
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
    titleElement = document.querySelector('[class*="VideoTitle__Titles-"]');
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
  if (Array.isArray(subtitleRecords)) {
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
          renderDualSubtitles(mutation);
        }
        else {
          applyBlurToOriginalSubtitles(mutation);
        }
        return;
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

      const originalSubtitleRows = originalSubtitlesWrapper.querySelectorAll('[data-testid="subtitle-row"]');
      addContentToDisplayedSubtitlesWrapper(
        displayedSubtitlesWrapper,
        // @ts-ignore - NodeListOf<Element> is used as NodeListOf<HTMLDivElement> at runtime
        originalSubtitleRows,
      )
      translationQueue.processQueue().then(() => { }).catch((error) => {
        console.error("YleDualSubExtension: Error processing translation queue after enabling dual subtitles:", error);
      });
    }
    else {
      const displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
      const displayedSubtitlesRowsWrapper = displayedSubtitlesWrapper?.querySelector("#displayed-subtitles-rows-wrapper");
      if (displayedSubtitlesRowsWrapper) {
        displayedSubtitlesRowsWrapper.innerHTML = "";
        displayedSubtitlesWrapper.style.display = "none";
      }
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (originalSubtitlesWrapper) {
        originalSubtitlesWrapper.style.display = "flex";
      }
    }
  }
});
