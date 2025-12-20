/**
 * Jest setup file for database tests
 *
 * This file is loaded before running tests to set up the testing environment
 */

// Polyfill for structuredClone (required by fake-indexeddb)
if (!global.structuredClone) {
    global.structuredClone = (obj) => {
        return JSON.parse(JSON.stringify(obj));
    };
}

// Require fake-indexeddb to provide IndexedDB implementation in Node.js
require('fake-indexeddb/auto');

// Suppress console.error and console.warn during tests to keep output clean
// You can comment these out if you need to debug tests
global.console = {
    ...console,
    error: () => {},
    warn: () => {},
    info: () => {},
};
