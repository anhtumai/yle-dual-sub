document.getElementById("setupLink").addEventListener("click", function (e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
