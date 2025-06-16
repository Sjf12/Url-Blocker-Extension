const urlParams = new URLSearchParams(window.location.search);
const blockedUrl = urlParams.get("blockedUrl") || "Unknown URL";
console.log("Blocked page loaded for original URL:", blockedUrl);
document.getElementById("blocked-url").textContent = `Blocked URL: ${blockedUrl}`;
document.getElementById("temp-unblock").addEventListener("click", () => {
  console.log("Initiating temporary unblock for:", blockedUrl);
  chrome.runtime.sendMessage({ action: "temporaryUnblock", url: blockedUrl, duration: 10 * 60 * 1000 }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Unblock failed:", chrome.runtime.lastError);
      alert("Failed to unblock: " + chrome.runtime.lastError.message);
    } else if (response.status === "success") {
      console.log("Unblock successful, navigating to:", response.unblockedUrl);
      window.location.href = response.unblockedUrl; // Navigate to the original URL
    } else {
      console.error("Unblock failed:", response.message);
      alert("Failed to unblock: " + response.message);
    }
  });
});