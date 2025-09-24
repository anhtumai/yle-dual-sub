console.log("Content script loaded.");

const sharedTranslationMap = new Map();


function toTranslationKey(rawSubtitleFinnishText) {
  return rawSubtitleFinnishText.trim().replace(/\n/g, '').toLowerCase();
}

class TranslationQueue {

  BATCH_MAXIMUM_SIZE = 7;
  BATCH_DELIMITER = " *!$ ";
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  addToQueue(rawSubtitleFinnishText) {
    this.queue.push(rawSubtitleFinnishText);
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    while (this.queue.length > 0) {
      this.isProcessing = true;

      const toProcessItems = [];
      for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
        toProcessItems.push(this.queue.shift());
      }
      const totalRawSubtitleFinnishText = toProcessItems.join(this.BATCH_DELIMITER);

      try {
        const totalTranslatedText = await fetchTranslation(totalRawSubtitleFinnishText);
        const translatedTexts = totalTranslatedText.split(this.BATCH_DELIMITER);

        for (let i = 0; i < toProcessItems.length; i++) {
          const translatedText = translatedTexts[i];
          const rawSubtitleFinnishText = toProcessItems[i];
          sharedTranslationMap.set(toTranslationKey(rawSubtitleFinnishText), translatedText.trim().replace(/\n/g, ' '));
        }
      } catch (error) {
        console.error("Error translating text:", error);
      }
    }

    this.isProcessing = false;
  }
}

const translationQueue = new TranslationQueue();


async function fetchTranslation(rawSubtitleFinnishText) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'fetchTranslation', data: { rawSubtitleFinnishText: rawSubtitleFinnishText } },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.englishText);
        }
      }
    )
  })
}

document.addEventListener("sendTranslationTextEvent", function (e) {
  const rawSubtitleFinnishText = e.detail;

  const translationKey = rawSubtitleFinnishText.trim().replace(/\n/g, '').toLowerCase();
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

function copySubtitlesWrapper(className) {
  const displayedSubtitlesWrapper = document.createElement("div");
  displayedSubtitlesWrapper.setAttribute("aria-live", "polite");
  displayedSubtitlesWrapper.setAttribute("class", className);
  displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");
  return displayedSubtitlesWrapper;
}

function createSubtitleSpan(text, className) {
  const span = document.createElement("span");
  span.setAttribute("class", className);
  span.setAttribute("style", "font-size: 3rem");
  span.textContent = text;
  return span;
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      try {
        if (mutation?.target?.dataset["testid"] === "subtitles-wrapper") {

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
      } catch (e) {
        console.error("Error processing mutation", e);
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