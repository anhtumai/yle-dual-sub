chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.greeting === 'hello') {
    sendResponse({ reply: 'Hi from background!' });
  }
});
