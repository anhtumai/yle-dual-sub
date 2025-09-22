const decoder = new TextDecoder("utf-8");



async function getDeeplTranslation(text) {
    // TODO: Implement this DeepL api call after getting the API Key
    return `{Translated: ${text}}`;
}

function parseVttFile(vttFileContent) {
    /**
     * Parses a VTT file content and returns an array of subtitle content.
     * Each subtitle content is an object with 'index', 'time', and 'text' properties.
     *
     * @param {string} vttText - The VTT file content.
     */
    const blocks = vttFileContent.split(/\n(?:\s*\n)+/);

    const subtitleContentCues = blocks.filter((block) => {
        const lines = block.trim().split("\n");
        return (
            lines.length >= 3 &&
            /^\d+$/.test(lines[0]) &&
            /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/.test(lines[1])
        );
    });

    return subtitleContentCues.map((cue) => {
        const lines = cue.trim().split("\n");
        return {
            index: parseInt(lines[0], 10),
            time: lines[1],
            text: lines.slice(2).join("\n"),
        };
    });
}

(function (xhr) {
    const XHR = XMLHttpRequest.prototype;

    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function (method, url) {
        this._method = method;
        this._url = url;

        return open.apply(this, arguments);
    };

    XHR.send = function (postData) {
        this.addEventListener("load", function () {
            const requestedUrl = this._url ? this._url.toLowerCase() : this._url;

            if (requestedUrl.endsWith(".vtt")) {
                const fullVttFileResponseText = decoder.decode(this.response);

                const subtitleContents = parseVttFile(fullVttFileResponseText);

                subtitleContents.forEach(async (subtitleContent) => {
                    const { index, time, text } = subtitleContent;
                    const rawSubtitleText = text.trim();
                    const customEvent = new CustomEvent("sendTranslationTextEvent", {
                        bubles: true,
                        cancelable: true,
                        detail: rawSubtitleText,
                    });
                    document.dispatchEvent(customEvent);
                });
            }
        });

        return send.apply(this, arguments);
    };
})(XMLHttpRequest);
