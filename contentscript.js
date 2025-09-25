console.log("Content script loaded.");

// Shared translation map, with key is Finnish text normalized, and value is English text
const sharedTranslationMap = new Map();
function toTranslationKey(rawSubtitleFinnishText) {
  return rawSubtitleFinnishText.trim().replace(/\n/g, '').toLowerCase();
}

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

    while (this.queue.length > 0) {
      this.isProcessing = true;

      /** @type {Array<string>} */
      const toProcessItems = [];
      for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
        toProcessItems.push(this.queue.shift());
      }

      try {
        const translatedEnglishTexts = await fetchTranslation(toProcessItems);

        for (let i = 0; i < toProcessItems.length; i++) {
          const translatedEnglishText = translatedEnglishTexts[i];
          const rawSubtitleFinnishText = toProcessItems[i];
          sharedTranslationMap.set(toTranslationKey(rawSubtitleFinnishText), translatedEnglishText.trim().replace(/\n/g, ' '));
        }
      } catch (error) {
        console.error("Error translating text:", error);
      }
    }

    this.isProcessing = false;
  }
}

const translationQueue = new TranslationQueue();


/**
 * 
 * @param {Array<string>} rawSubtitleFinnishTexts - Finnish text to translate
 * @returns {Promise<Array<string>>} - A promise that resolves to the translated English texts
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

let addedDisplayedSubtitlesWrapper = false;

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
 * Handle mutation related to subtitles wrapper
 * Hide the original subtitles wrapper and create another div for displaying translated subtitles
 * along with original Finnish subtitles.
 * 
 * @param {MutationRecord} mutation
 * @returns {void}
 */
function addDisplayedSubtitlesWrapper(mutation) {
  const targetElement = mutation.target;
  targetElement.style.display = "none";

  if (!addedDisplayedSubtitlesWrapper) {
    const displayedSubtitlesWrapperElement = copySubtitlesWrapper(
      mutation.target.className,
    );
    targetElement.parentNode.insertBefore(
      displayedSubtitlesWrapperElement,
      targetElement.nextSibling,
    );
    addedDisplayedSubtitlesWrapper = true;
  }
  const displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
  displayedSubtitlesWrapper.innerHTML = "";

  if (mutation.addedNodes.length > 0) {
    const spanClassName = mutation.addedNodes[0].className;
    const finnishText = mutation.target.innerText;
    const finnishSpan = createSubtitleSpan(finnishText, spanClassName);
    const translatedEnglishText =
      sharedTranslationMap.get(finnishText.trim().toLowerCase()) || "Translating...";

    const translatedEnglishSpan = createSubtitleSpan(translatedEnglishText, spanClassName);

    displayedSubtitlesWrapper.appendChild(finnishSpan);
    displayedSubtitlesWrapper.appendChild(translatedEnglishSpan);
  }
}

// TODO: reset addedDisplayedSubtitlesWrapper when video player is removed
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    console.log("Mutation observed:", mutation, mutation.removedNodes);
    if (mutation.type === "childList") {
      if (isMutationRelatedToSubtitlesWrapper(mutation)) {
        addDisplayedSubtitlesWrapper(mutation);
      }

      // if (mutation.removedNodes.length > 0 && mutation.removedNodes[0].className.includes("VideoPlayerWrapper")) {
      //   console.log("Video player removed, clearing translation map.");
      // }
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