console.log("Content script loaded.");

const sharedTranslationMap = new Map();

document.addEventListener("sendTranslationTextEvent", function (e) {
  const [finnishText, translatedText] = e.detail;
  sharedTranslationMap.set(finnishText.trim().toLowerCase(), translatedText);
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
} else {
  console.log("What is document body", document.body);
}
