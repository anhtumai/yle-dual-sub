/**
 * @typedef {Object} SubtitleRecord
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {string} originalLanguage - The original language code (e.g., "FI") (for now, this will be always "FI")
 * @property {string} targetLanguage - The target language code (e.g., "EN-US", "VI")
 * @property {string} originalText - The Finnish subtitle text (normalized)
 * @property {string} translatedText - The translated text in target language
 */

/**
 * @typedef {Object} MovieMetadata
 * @property {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @property {number} lastAccessedDays - Last accessed time in days since Unix epoch
 */

const DATABASE = "YleDualSubCache"
const SUBTITLE_CACHE_OBJECT_STORE = "SubtitlesCache"
const DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE = "EnglishSubtitlesCache"
const MOVIE_METADATA_OBJECT_STORE = "MovieMetadata"

/**
 * Open or create the IndexedDB database for subtitle caching
 * @returns {Promise<IDBDatabase>} The opened database instance
 */
async function openDatabase() {
    return new Promise((resolve, reject) => {

        const DBOpenRequest = indexedDB.open(DATABASE, 2);

        // Handle errors
        DBOpenRequest.onerror = (_event) => {
            console.error("YleDualSubExtension: Database error:", DBOpenRequest.error);
            reject(DBOpenRequest.error);
        }

        // Handle success
        DBOpenRequest.onsuccess = (_event) => {
            const db = DBOpenRequest.result;
            resolve(db);
        };

        // Handle database upgrade (first time or version change)
        DBOpenRequest.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;
            console.info(`YleDualSubExtension: Upgrading database from version ${oldVersion} to 2...`);

            // Create metadata store (only for new users, version 0 -> 1/2)
            if (oldVersion < 1) {
                db.createObjectStore(MOVIE_METADATA_OBJECT_STORE, {
                    keyPath: 'movieName',
                });
            }

            // Create new subtitle cache and delete old one (version 1 -> 2)
            if (oldVersion < 2) {
                const subtitlesObjectStore = db.createObjectStore(SUBTITLE_CACHE_OBJECT_STORE, {
                    keyPath: ['movieName', 'originalLanguage', 'targetLanguage', 'originalText'],
                });
                subtitlesObjectStore.createIndex('movieSubtitlesByLanguage', ['movieName', 'originalLanguage', 'targetLanguage'], { unique: false });

                // Delete old subtitle cache
                if (db.objectStoreNames.contains(DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE)) {
                    db.deleteObjectStore(DEPRECATED_ENGLISH_SUBTITLE_CACHE_OBJECT_STORE);
                }
            }
        };
    })
}

/**
 * Load all subtitles for a given movie and target language from IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name (e.g., "Series Title | Episode Name")
 * @param {string} targetLanguage - Target language (e.g., "EN-US", "VI")
 * @returns {Promise<Array<SubtitleRecord>>}
 */
async function loadSubtitlesByMovieName(db, movieName, targetLanguage) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);
            const index = objectStore.index('movieSubtitlesByLanguage');

            const DBGetAllRequest = index.getAll([movieName, "FI", targetLanguage]);

            DBGetAllRequest.onsuccess = (_event) => {
                /**
                 * @type {Array<SubtitleRecord>}
                 */
                const subtitleRecords = DBGetAllRequest.result;
                resolve(subtitleRecords);
            };

            DBGetAllRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: Error loading subtitles:", DBGetAllRequest.error);
                reject(DBGetAllRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error opening database:", error);
            reject(error);
        }
    });
}

/**
 * Save a subtitle translation to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @param {string} targetLanguage - Target language (e.g., "EN-US", "VI")
 * @param {string} originalText - The Finnish subtitle text (normalized)
 * @param {string} translatedText - The translated text in target language
 * @returns {Promise<void>}
 */
async function saveSubtitle(db, movieName, targetLanguage, originalText, translatedText) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);

            /**
             * @type {SubtitleRecord}
             */
            const subtitle = {
                movieName: movieName,
                originalLanguage: "FI",
                targetLanguage: targetLanguage,
                originalText: originalText,
                translatedText: translatedText
            };

            const DBSaveSubtitlesRequest = objectStore.put(subtitle);

            DBSaveSubtitlesRequest.onsuccess = (_event) => {
                resolve();
            };

            DBSaveSubtitlesRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: Error saving subtitle:", DBSaveSubtitlesRequest.error);
                reject(DBSaveSubtitlesRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error opening database:", error);
            reject(error);
        }
    });
}

/**
 * Save multiple subtitle translations to IndexedDB in a single transaction
 * @param {IDBDatabase} db - Opening database instance
 * @param {Array<SubtitleRecord>} subtitles - Array of subtitle objects to save (must include targetLanguage)
 * @returns {Promise<number>} Number of subtitles saved
 */
async function saveSubtitlesBatch(db, subtitles) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);

            let savedCount = 0;
            let errorOccurred = false;

            // Handle transaction completion
            transaction.oncomplete = () => {
                if (!errorOccurred) {
                    resolve(savedCount);
                }
            };

            transaction.onerror = (_event) => {
                console.error("YleDualSubExtension: Transaction error:", transaction.error);
                errorOccurred = true;
                reject(transaction.error);
            };

            // Add all subtitles to the transaction
            for (const subtitle of subtitles) {
                const DBSaveRequest = objectStore.put(subtitle);

                DBSaveRequest.onsuccess = (_event) => {
                    savedCount++;
                };

                DBSaveRequest.onerror = (_event) => {
                    console.error("YleDualSubExtension: Error saving subtitle:", DBSaveRequest.error);
                    errorOccurred = true;
                };
            }

        } catch (error) {
            console.error("YleDualSubExtension: Error in batch save:", error);
            reject(error);
        }
    });
}

/**
 * Delete all subtitles for a given movie from IndexedDB (across all languages)
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @returns {Promise<number>} Number of subtitles deleted
 */
async function clearSubtitlesByMovieName(db, movieName) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([SUBTITLE_CACHE_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(SUBTITLE_CACHE_OBJECT_STORE);

            let deletedCount = 0;
            // Use keyPath range to delete all entries for this movie (all languages)
            const range = IDBKeyRange.bound(
                [movieName, "", "", ""],
                [movieName, "\uffff", "\uffff", "\uffff"]
            );

            const DBDeleteCursorRequest = objectStore.openCursor(range);

            DBDeleteCursorRequest.onsuccess = (_event) => {
                const cursor = DBDeleteCursorRequest.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    resolve(deletedCount);
                }
            };

            DBDeleteCursorRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: Error clearing subtitles:", DBDeleteCursorRequest.error);
                reject(DBDeleteCursorRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error opening database:", error);
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
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const DBGetMovieMetadataRequest = objectStore.get(movieName);

            DBGetMovieMetadataRequest.onsuccess = (_event) => {
                const metadata = DBGetMovieMetadataRequest.result;
                if (metadata) {
                    resolve(metadata);
                } else {
                    resolve(null);
                }
            };

            DBGetMovieMetadataRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: Error getting movie metadata:", DBGetMovieMetadataRequest.error);
                reject(DBGetMovieMetadataRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error retrieving movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Save or update movie metadata to IndexedDB
 * @param {IDBDatabase} db - Opening database instance
 * @param {string} movieName - The movie name
 * @param {number} lastAccessedDays - Last accessed time in days since Unix epoch
 * @returns {Promise<void>}
 */
async function upsertMovieMetadata(db, movieName, lastAccessedDays) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const metadata = {
                movieName: movieName,
                lastAccessedDays: lastAccessedDays
            };

            const DBUpsertMovieMetadataRequest = objectStore.put(metadata);

            DBUpsertMovieMetadataRequest.onsuccess = (_event) => {
                resolve();
            };

            DBUpsertMovieMetadataRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: Error saving movie metadata:", DBUpsertMovieMetadataRequest.error);
                reject(DBUpsertMovieMetadataRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error saving movie metadata:", error);
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
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readonly');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const DBGetAllMovieMetadatas = objectStore.getAll();

            DBGetAllMovieMetadatas.onsuccess = (_event) => {
                const metadataRecords = DBGetAllMovieMetadatas.result;
                resolve(metadataRecords);
            };

            DBGetAllMovieMetadatas.onerror = (_event) => {
                console.error("YleDualSubExtension: Error getting all movie metadata:", DBGetAllMovieMetadatas.error);
                reject(DBGetAllMovieMetadatas.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error retrieving all movie metadata:", error);
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
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([MOVIE_METADATA_OBJECT_STORE], 'readwrite');
            const objectStore = transaction.objectStore(MOVIE_METADATA_OBJECT_STORE);

            const DBDeleteMovieMetadataRequest = objectStore.delete(movieName);

            DBDeleteMovieMetadataRequest.onsuccess = (_event) => {
                resolve();
            };

            DBDeleteMovieMetadataRequest.onerror = (_event) => {
                console.error("YleDualSubExtension: Error deleting movie metadata:", DBDeleteMovieMetadataRequest.error);
                reject(DBDeleteMovieMetadataRequest.error);
            };

        } catch (error) {
            console.error("YleDualSubExtension: Error deleting movie metadata:", error);
            reject(error);
        }
    });
}

/**
 * Clean up old movie data that hasn't been accessed recently
 * @param {IDBDatabase} db - Opening database instance
 * @param {number} maxAgeDays - Maximum age in days (movies older than this will be deleted).
 * Default is 30 days
 * @returns {Promise<number>} Number of movies cleaned up
 */
async function cleanupOldMovieData(db, maxAgeDays = 30) {
    try {
        const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
        const cutoffDays = nowDays - maxAgeDays;

        console.info(`YleDualSubExtension: Starting cleanup of movies not accessed since day ${cutoffDays} (${maxAgeDays} days ago)`);

        // Get all movie metadata
        const allMetadata = await getAllMovieMetadata(db);

        // Filter for old movies
        const oldMovieMetadatas = allMetadata.filter(metadata =>
            metadata.lastAccessedDays < cutoffDays
        );

        console.info(`YleDualSubExtension: Found ${oldMovieMetadatas.length} movies to clean up`);

        // Delete each old movie's data
        let cleanedCount = 0;
        for (const metadata of oldMovieMetadatas) {
            try {
                // Delete all subtitles for this movie
                await clearSubtitlesByMovieName(db, metadata.movieName);

                // Delete the metadata record
                await deleteMovieMetadata(db, metadata.movieName);

                cleanedCount++;
                console.info(`YleDualSubExtension: Cleaned up movie: ${metadata.movieName}`);
            } catch (error) {
                console.warn(`YleDualSubExtension: Failed to clean up movie ${metadata.movieName}:`, error);
            }
        }
        return cleanedCount;

    } catch (error) {
        throw error;
    }
}
