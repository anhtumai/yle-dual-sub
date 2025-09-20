console.log('Content script loaded.');

chrome.runtime.sendMessage({ greeting: 'hello' }, (response) => {
  console.log('Background replied:', response.reply);
});
