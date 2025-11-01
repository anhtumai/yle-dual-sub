
// TODO: Create a tier caching mechanism (in memory and local storage)
// to avoid hitting translation limit, using DeepL API.
// Consider using IndexedDB for persistent caching if needed.
// If a movie is not watched for a long time, the cache can be cleared.

// Shared translation map, with key is Finnish text normalized, and value is English text
/** @type {Map<string, string>} */
const sharedTranslationMap = new Map();
/** @type {Map<string, string>} */
const sharedTranslationErrorMap = new Map();
function toTranslationKey(rawSubtitleFinnishText) {
  return rawSubtitleFinnishText.trim().replace(/\n/g, '').toLowerCase();
}

// to manage whether to add display subtitles wrapper
let dualSubEnabled = false;

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
          for (let i = 0; i < toProcessItems.length; i++) {
            const translatedEnglishText = translationResult[i];
            const rawSubtitleFinnishText = toProcessItems[i];
            sharedTranslationMap.set(
              toTranslationKey(rawSubtitleFinnishText),
              translatedEnglishText.trim().replace(/\n/g, ' ')
            );
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
 * @returns {Promise<Array<string>|Error>} - A promise that resolves to the translated English texts
 * if fails, return an error
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

document.addEventListener("sendTranslationTextEvent", function (e) {
  /**
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
  span.setAttribute("style", "font-size: 3rem");
  span.textContent = text;
  return span;
}

/**
 * Chekc if a mutation is related to subtitles wrapper 
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
 * @param {string} finnishText  - original Finnish subtitle text 
 * @param {string} spanClassName  - class name to set for the span elements
 */
function addContentToDisplayedSubtitlesWrapper(
  displayedSubtitlesWrapper,
  finnishText,
  spanClassName
) {
  const finnishSpan = createSubtitleSpan(finnishText, spanClassName);
  const translationKey = finnishText.trim().toLowerCase();
  const translatedEnglishText =
    sharedTranslationMap.get(translationKey) ||
    sharedTranslationErrorMap.get(translationKey) ||
    "Translating...";

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
    const spanClassName = mutation.addedNodes[0].className;
    const finnishTextSpans = mutation.target.querySelectorAll("span");
    const finnishText = Array.from(finnishTextSpans).map(
      span => span.innerText
    ).join(" ")
      .replace(/\s+/g, " ")
      .replace("\n", " ")
      .trim();
    addContentToDisplayedSubtitlesWrapper(
      displayedSubtitlesWrapper,
      finnishText,
      spanClassName
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
    </div>
  `
  bottomControlBarLeftControls.insertAdjacentHTML('beforeend', dualSubExtensionSection);
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
        addDualSubExtensionSection().then(() => { }).catch((error) => {
          console.error("Error adding dual sub extension section:", error);
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

document.addEventListener("change", function (e) {
  if (e.target.id === "dual-sub-switch") {
    dualSubEnabled = e.target.checked;
    if (e.target.checked) {
      const originalSubtitlesWrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
      if (!originalSubtitlesWrapper) {
        console.warn("This should not happen: \
          When the video is loaded the subtitles wrapper should be there"
        );
        return;
      }
      originalSubtitlesWrapper.style.display = "none";
      const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(
        originalSubtitlesWrapper
      );
      displayedSubtitlesWrapper.innerHTML = "";
      displayedSubtitlesWrapper.style.display = "flex";

      const originalSubtitlesWrapperSpan = originalSubtitlesWrapper.querySelector('span');
      if (originalSubtitlesWrapperSpan) {
        addContentToDisplayedSubtitlesWrapper(
          displayedSubtitlesWrapper,
          originalSubtitlesWrapper.innerText,
          originalSubtitlesWrapperSpan.className || ""
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
