console.log("Content script loaded.");

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
            try {
                if (mutation?.target?.dataset["testid"] === "subtitles-wrapper") {
                    console.log("Subtitle wrapper changed", mutation);

                    targetElement = mutation.target;
                    //targetElement.style.display = "none";
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
