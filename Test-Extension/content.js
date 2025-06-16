const scripts = document.getElementsByTagName("script");
for (const script of scripts) {
  if (script.src.includes("fingerprint") || script.innerHTML.includes("Fingerprint")) {
    script.remove();
    chrome.runtime.sendMessage({ action: "blockedScript", url: window.location.href }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending blocked script message:", chrome.runtime.lastError);
      }
    });
  }
}