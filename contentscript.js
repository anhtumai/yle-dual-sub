console.log("Content script loaded.");

const sharedTranslationMap = new Map();

// TODO: Consider sending multiple requests in batch to optimize performance
class TranslationQueue {
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
      for (let i = 0; i < Math.min(this.queue.length, 7); i++) {
        toProcessItems.push(this.queue.shift());
      }
      const totalRawSubtitleFinnishText = toProcessItems.join(" *!$ ");
      try {
        const totalTranslatedText = await fetchTranslation(totalRawSubtitleFinnishText);
        const translatedTexts = totalTranslatedText.split(" *!$ ");

        for (let i = 0; i < translatedTexts.length; i++) {
          const translatedText = translatedTexts[i];
          const rawSubtitleFinnishText = toProcessItems[i];
          sharedTranslationMap.set(rawSubtitleFinnishText.trim().replace(/\n/g, '').toLowerCase(), translatedText.trim().replace(/\n/g, ' '));
        }
      } catch (error) {
        console.log("Error translating text:", error);
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

  const toStoredKey = rawSubtitleFinnishText.trim().replace(/\n/g, '').toLowerCase();
  if (sharedTranslationMap.has(toStoredKey)) {
    return;
  }
  if (toStoredKey.length === 0) {
    return;
  }
  if (toStoredKey.length === 1) {
    sharedTranslationMap.set(toStoredKey, toStoredKey);
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

            //console.log("Debug everything why nothing works", sharedTranslationMap, finnishText, translatedEnglishText);
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
} else {
  console.log("What is document body", document.body);
}
