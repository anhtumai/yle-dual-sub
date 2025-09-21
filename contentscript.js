console.log("Content script loaded.");

let addedDisplayedSubtitlesWrapper = false;

function copySubtitlesWrapper(className) {
    const displayedSubtitlesWrapper = document.createElement("div");
    displayedSubtitlesWrapper.setAttribute("aria-live", "polite");
    displayedSubtitlesWrapper.setAttribute("class", className);
    displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");
    return displayedSubtitlesWrapper;
}


const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
            try {
                if (mutation?.target?.dataset["testid"] === "subtitles-wrapper") {
                    console.log("Subtitle wrapper changed", mutation, mutation.target.innerText);

                    const targetElement = mutation.target;
                    targetElement.style.display = "none";

                    if (!addedDisplayedSubtitlesWrapper) {
                        const displayedSubtitlesWrapperElement = copySubtitlesWrapper(mutation.target.className);
                        targetElement.parentNode.insertBefore(
                            displayedSubtitlesWrapperElement,
                            targetElement.nextSibling
                        );
                        addedDisplayedSubtitlesWrapper = true;
                    }
                    const displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
                    displayedSubtitlesWrapper.innerHTML = "";

                    if (mutation.addedNodes.length > 0) {
                        const finnishText = mutation.target.innerText;
                        const finnishSpan = document.createElement("span");
                        finnishSpan.textContent = finnishText;

                        const translatedEnglishSpan = document.createElement("span");
                        translatedEnglishSpan.textContent = `Translated: ${finnishText}`; // Default to finnish text
                        
                        displayedSubtitlesWrapper.appendChild(finnishSpan);
                        displayedSubtitlesWrapper.appendChild(translatedEnglishSpan)
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
