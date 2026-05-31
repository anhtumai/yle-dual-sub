/* exported sleep, calculateBackoffDelay */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter: 200ms * 2^attempt + random(0, delay/2)
 * Prevents thundering herd when multiple requests retry simultaneously.
 * @param {number} attempt - 0-indexed attempt number
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt) {
  const exponentialDelay = 200 * Math.pow(2, attempt);
  const jitter = Math.random() * (exponentialDelay / 2);
  return exponentialDelay + jitter;
}
