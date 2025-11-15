/**
 * @typedef {Object} SubtitleRecord
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {string} finnishText - The Finnish subtitle text (normalized)
 * @property {string} translatedText - The English (or other language) translation
 */

/**
 * Open or create the IndexedDB database for subtitle caching
 * @returns {Promise<IDBDatabase>} The opened database instance
 */
async function openDatabase() {
    return new Promise((resolve, reject) => {

        const request = indexedDB.open('EnglishSubtitlesCache', 1);

        // Handle errors
        request.onerror = (event) => {
            console.error("Database error:", event.target.error);
            reject(event.target.error);
        }

        // Handle success
        request.onsuccess = (event) => {
            const db = event.target.result;
            console.log('Database opened successfully');
            resolve(db);
        };

        // Handle database upgrade (first time or version change)
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('Upgrading database...');

            // Create object stores here
            const objectStore = db.createObjectStore('subtitles', {
                keyPath: ['movieName', 'finnishText'],
            });
            objectStore.createIndex('movieName', 'movieName', { unique: false });
        };
    })
}

/**
 * Load all subtitles for a given movie from IndexedDB
 * @param {IDBDatabase} db - Openning database instance
 * @param {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @returns {Promise<Array<SubtitleRecord>>}
 */
async function loadSubtitlesByMovieName(db, movieName) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['subtitles'], 'readonly');
            const objectStore = transaction.objectStore('subtitles');
            const index = objectStore.index('movieName');

            const request = index.getAll(movieName);

            request.onsuccess = (event) => {
                /**
                 * @type {Array<SubtitleRecord>}
                 */
                const subtitleRecords = event.target.result;
                resolve(subtitleRecords);
            };

            request.onerror = (event) => {
                console.error("Error loading subtitles:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error opening database:", error);
            reject(error);
        }
    });
}

/**
 * Save a subtitle translation to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @param {string} finnishText - The Finnish subtitle text (normalized)
 * @param {string} translatedText - The English (or other languages) translation
 * @returns {Promise<void>}
 */
async function saveSubtitle(db, movieName, finnishText, translatedText) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['subtitles'], 'readwrite');
            const objectStore = transaction.objectStore('subtitles');

            const subtitle = {
                movieName: movieName,
                finnishText: finnishText,
                translatedText: translatedText
            };

            const request = objectStore.put(subtitle);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                console.error("Error saving subtitle:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error opening database:", error);
            reject(error);
        }
    });
}

/**
 * Save multiple subtitle translations to IndexedDB in a single transaction
 * @param {IDBDatabase} db - Opening database instance
 * @param {Array<SubtitleRecord>} subtitles - Array of subtitle objects to save
 * @returns {Promise<number>} Number of subtitles saved
 */
async function saveSubtitlesBatch(db, subtitles) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['subtitles'], 'readwrite');
            const objectStore = transaction.objectStore('subtitles');

            let savedCount = 0;
            let errorOccurred = false;

            // Handle transaction completion
            transaction.oncomplete = () => {
                if (!errorOccurred) {
                    console.log(`Successfully saved ${savedCount} subtitles in batch`);
                    resolve(savedCount);
                }
            };

            transaction.onerror = (event) => {
                console.error("Transaction error:", event.target.error);
                errorOccurred = true;
                reject(event.target.error);
            };

            // Add all subtitles to the transaction
            for (const subtitle of subtitles) {
                const request = objectStore.put(subtitle);

                request.onsuccess = () => {
                    savedCount++;
                };

                request.onerror = (event) => {
                    console.error("Error saving subtitle:", event.target.error);
                    errorOccurred = true;
                };
            }

        } catch (error) {
            console.error("Error in batch save:", error);
            reject(error);
        }
    });
}

/**
 * Delete all subtitles for a given movie from IndexedDB
 * @param {string} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<number>} Number of subtitles deleted
 */
async function clearSubtitlesByMovieName(db, movieName) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['subtitles'], 'readwrite');
            const objectStore = transaction.objectStore('subtitles');
            const index = objectStore.index('movieName');

            let deletedCount = 0;
            const request = index.openCursor(IDBKeyRange.only(movieName));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log(`Deleted ${deletedCount} subtitles for movie: ${movieName}`);
                    resolve(deletedCount);
                }
            };

            request.onerror = (event) => {
                console.error("Error clearing subtitles:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error opening database:", error);
            reject(error);
        }
    });
}
