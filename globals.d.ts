// Global type declarations for browser extension

// Chrome extension APIs
/// <reference types="chrome"/>

// Service Worker globals
declare function importScripts(...urls: string[]): void;

// Utility functions from utils.js
declare function loadSelectedTokenFromChromeStorageSync(): Promise<string>;
declare function loadTargetLanguageFromChromeStorageSync(): Promise<string>;

// Database functions from database.js
declare function openDatabase(): Promise<IDBDatabase>;
declare function saveSubtitle(
    db: IDBDatabase,
    movieName: string,
    targetLanguage: string,
    originalText: string,
    translatedText: string
): Promise<void>;
declare function saveSubtitlesBatch(
    db: IDBDatabase,
    subtitles: SubtitleRecord[]
): Promise<number>;
declare function loadSubtitlesByMovieName(
    db: IDBDatabase,
    movieName: string,
    targetLanguage: string
): Promise<SubtitleRecord[]>;
declare function clearSubtitlesByMovieName(
    db: IDBDatabase,
    movieName: string
): Promise<number>;
declare function getMovieMetadata(
    db: IDBDatabase,
    movieName: string
): Promise<MovieMetadata | null>;
declare function upsertMovieMetadata(
    db: IDBDatabase,
    movieName: string,
    lastAccessedDays: number
): Promise<void>;
declare function getAllMovieMetadata(
    db: IDBDatabase
): Promise<MovieMetadata[]>;
declare function deleteMovieMetadata(
    db: IDBDatabase,
    movieName: string
): Promise<void>;
declare function cleanupOldMovieData(
    db: IDBDatabase,
    maxAgeDays?: number
): Promise<number>;

// Types from database.js
interface SubtitleRecord {
    movieName: string;
    originalLanguage: string;
    targetLanguage: string;
    originalText: string;
    translatedText: string;
}

interface MovieMetadata {
    movieName: string;
    lastAccessedDays: number;
}

// Types for DeepL
interface DeepLTokenInfoInStorage {
    tokenName: string;
    tokenValue: string;
}
