/**
 * @typedef {Object} SubtitleRecord
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {string} finnishText - The Finnish subtitle text (normalized)
 * @property {string} translatedText - The English (or other language) translation
 */

/**
 * @typedef {Object} MovieMetadata
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {number} lastAccessedTimeStampMs - Last accessed timestamp in milliseconds
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
            const subtitlesObjectStore = db.createObjectStore('subtitles', {
                keyPath: ['movieName', 'finnishText'],
            });
            subtitlesObjectStore.createIndex('movieName', 'movieName', { unique: false });

            const movieMetadataObjectStore = db.createObjectStore('movieMetadata', {
                keyPath: 'movieName',
            });
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

/**
 * Get movie metadata from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<MovieMetadata|null>} The movie metadata or null if not found
 */
async function getMovieMetadata(db, movieName) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['movieMetadata'], 'readonly');
            const objectStore = transaction.objectStore('movieMetadata');

            const request = objectStore.get(movieName);

            request.onsuccess = (event) => {
                const metadata = event.target.result;
                if (metadata) {
                    console.log(`Retrieved metadata for movie: ${movieName}`);
                    resolve(metadata);
                } else {
                    console.log(`No metadata found for movie: ${movieName}`);
                    resolve(null);
                }
            };

            request.onerror = (event) => {
                console.error("Error getting movie metadata:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error retrieving movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Save or update movie metadata to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @param {string} lastAccessedTimeStampMs - Last accessed timestamp in milliseconds
 * @returns {Promise<void>}
 */
async function upsertMovieMetadata(db, movieName, lastAccessedTimeStampMs) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['movieMetadata'], 'readwrite');
            const objectStore = transaction.objectStore('movieMetadata');

            const metadata = {
                movieName: movieName,
                lastAccessedTimeStampMs: lastAccessedTimeStampMs
            };

            const request = objectStore.put(metadata);

            request.onsuccess = () => {
                console.log(`Saved metadata for movie: ${movieName}`);
                resolve();
            };

            request.onerror = (event) => {
                console.error("Error saving movie metadata:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error saving movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Get all movie metadata records from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @returns {Promise<Array<MovieMetadata>>} Array of all movie metadata records
 */
async function getAllMovieMetadata(db) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['movieMetadata'], 'readonly');
            const objectStore = transaction.objectStore('movieMetadata');

            const request = objectStore.getAll();

            request.onsuccess = (event) => {
                const metadataRecords = event.target.result;
                console.log(`Retrieved ${metadataRecords.length} movie metadata records`);
                resolve(metadataRecords);
            };

            request.onerror = (event) => {
                console.error("Error getting all movie metadata:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error retrieving all movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Delete movie metadata from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<void>}
 */
async function deleteMovieMetadata(db, movieName) {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = db.transaction(['movieMetadata'], 'readwrite');
            const objectStore = transaction.objectStore('movieMetadata');

            const request = objectStore.delete(movieName);

            request.onsuccess = () => {
                console.log(`Deleted metadata for movie: ${movieName}`);
                resolve();
            };

            request.onerror = (event) => {
                console.error("Error deleting movie metadata:", event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error("Error deleting movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Clean up old movie data that hasn't been accessed recently
 * @param {IDBDatabase} db - Opening database instance
 * @param {number} maxAgeMs - Maximum age in milliseconds (movies older than this will be deleted).
 * Default is 864,000,000 ms (10 days)
 * @returns {Promise<number>} Number of movies cleaned up
 */
async function cleanupOldMovieData(db, maxAgeMs = 864000000) {
    try {
        const now = Date.now();
        const cutoffTime = now - maxAgeMs;

        console.log(`Starting cleanup of movies not accessed since ${new Date(cutoffTime).toISOString()}`);

        // Get all movie metadata
        const allMetadata = await getAllMovieMetadata(db);

        // Filter for old movies
        const oldMovieMetadatas = allMetadata.filter(metadata =>
            metadata.lastAccessedTimeStampMs < cutoffTime
        );

        console.log(`Found ${oldMovieMetadatas.length} movies to clean up`);

        // Delete each old movie's data
        let cleanedCount = 0;
        for (const metadata of oldMovieMetadatas) {
            try {
                // Delete all subtitles for this movie
                await clearSubtitlesByMovieName(db, metadata.movieName);

                // Delete the metadata record
                await deleteMovieMetadata(db, metadata.movieName);

                cleanedCount++;
                console.log(`Cleaned up movie: ${metadata.movieName}`);
            } catch (error) {
                console.warn(`Failed to clean up movie ${metadata.movieName}:`, error);
            }
        }

        console.log(`Cleanup completed: ${cleanedCount} movies removed`);
        return cleanedCount;

    } catch (error) {
        console.warn("Error during cleanup:", error);
        throw error;
    }
}
