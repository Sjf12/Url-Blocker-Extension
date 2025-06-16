document.addEventListener("DOMContentLoaded", () => {
  const urlInput = document.getElementById("url-input");
  const addUrlButton = document.getElementById("add-url");
  const blacklistElement = document.getElementById("blacklist");
  const toggleInput = document.getElementById("block-toggle");
  const refreshThreatFeedButton = document.getElementById("refresh-threat-feed");
  const searchUrlInput = document.getElementById("search-url");

  let fullBlacklist = [];

  function updateBlacklistDisplay(filter = "") {
    blacklistElement.innerHTML = "";
    const filteredBlacklist = fullBlacklist.filter(url => url.toLowerCase().includes(filter.toLowerCase()));
    filteredBlacklist.forEach((url) => {
      const li = document.createElement("li");
      li.className = "flex justify-between items-center p-2 bg-white bg-opacity-10 rounded border border-white border-opacity-20 mb-1";
      li.textContent = url;
      const removeButton = document.createElement("button");
      removeButton.textContent = "Remove";
      removeButton.className = "bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600";
      removeButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "removeUrl", url }, (response) => {
          if (chrome.runtime.lastError) {
            alert("Failed to remove URL: " + chrome.runtime.lastError.message);
          } else if (response.status === "success") {
            updateBlacklistDisplay(searchUrlInput.value);
          } else {
            alert("Failed to remove URL: " + response.message);
          }
        });
      });
      const tempUnblockButton = document.createElement("button");
      tempUnblockButton.textContent = "Unblock 10min";
      tempUnblockButton.className = "bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 ml-2";
      tempUnblockButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "temporaryUnblock", url, duration: 10 * 60 * 1000 }, (response) => {
          if (chrome.runtime.lastError) {
            alert("Failed to unblock: " + chrome.runtime.lastError.message);
          } else if (response.status === "success") {
            alert(`URL ${url} unblocked for 10 minutes.`);
          } else {
            alert("Failed to unblock: " + response.message);
          }
        });
      });
      li.appendChild(removeButton);
      li.appendChild(tempUnblockButton);
      blacklistElement.appendChild(li);
    });
  }

  function loadBlacklist() {
    chrome.storage.sync.get(["blacklist"], (data) => {
      fullBlacklist = data.blacklist || [];
      updateBlacklistDisplay(searchUrlInput.value);
    });
  }

  function updateStatsChart() {
    chrome.storage.local.get(["blockStats"], (data) => {
      const stats = data.blockStats || {};
      const labels = Object.keys(stats).length ? Object.keys(stats) : ["No blocks yet"];
      const values = Object.keys(stats).length ? Object.values(stats) : [0];
      new Chart(document.getElementById("block-stats-chart"), {
        type: "bar",
        data: {
          labels: labels,
          datasets: [{
            label: "Blocked Requests",
            data: values,
            backgroundColor: "#40c4ff",
            borderColor: "#0288d1",
            borderWidth: 1
          }]
        },
        options: {
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { display: false } }
        }
      });
    });
  }

  chrome.storage.sync.get(["blockEnabled"], (data) => {
    toggleInput.checked = data.blockEnabled !== false;
    chrome.runtime.sendMessage({ action: "toggleBlocking", enabled: toggleInput.checked }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error initializing toggle:", chrome.runtime.lastError);
      }
    });
  });

  addUrlButton.addEventListener("click", () => {
    const url = urlInput.value.trim();
    if (url) {
      chrome.runtime.sendMessage({ action: "addUrl", url }, (response) => {
        if (chrome.runtime.lastError) {
          alert("Failed to add URL: " + chrome.runtime.lastError.message);
        } else if (response.status === "success") {
          urlInput.value = "";
          loadBlacklist();
          alert("URL added to blacklist.");
        } else {
          alert("Failed to add URL: " + response.message);
        }
      });
    } else {
      alert("Please enter a valid URL.");
    }
  });

  toggleInput.addEventListener("change", () => {
    const enabled = toggleInput.checked;
    chrome.storage.sync.set({ blockEnabled: enabled }, () => {
      chrome.runtime.sendMessage({ action: "toggleBlocking", enabled }, (response) => {
        if (chrome.runtime.lastError) {
          alert("Failed to toggle blocking: " + chrome.runtime.lastError.message);
        } else if (response.status === "success") {
          console.log("Toggle blocking successful");
        } else {
          alert("Failed to toggle blocking: " + response.message);
        }
      });
    });
  });

  refreshThreatFeedButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "refreshThreatFeed" }, (response) => {
      if (chrome.runtime.lastError) {
        alert("Failed to refresh threat feed: " + chrome.runtime.lastError.message);
      } else if (response.status === "success") {
        alert("Threat feed refreshed!");
        loadBlacklist();
      } else {
        alert("Failed to refresh threat feed: " + response.message);
      }
    });
  });

  searchUrlInput.addEventListener("input", () => {
    updateBlacklistDisplay(searchUrlInput.value);
  });

  loadBlacklist();
  updateStatsChart();
});