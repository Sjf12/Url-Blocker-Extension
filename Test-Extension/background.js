const ALLOWED_URLS = new Set();
const THREAT_FEED_URL = "https://openphish.com/feed.txt";

function normalizeDomain(url) {
  try {
    if (url.startsWith("chrome-extension://")) {
      return null; // Skip extension URLs
    }
    const domainRegex = /^(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::\d+)?(?:\/.*)?$/;
    const match = url.match(domainRegex);
    if (!match) throw new Error("Invalid domain");
    return match[1].toLowerCase();
  } catch (error) {
    console.error("Error normalizing domain:", url, error);
    return null;
  }
}

async function fetchThreatFeed() {
  try {
    const response = await fetch(THREAT_FEED_URL, { method: "GET" });
    const text = await response.text();
    const threatUrls = text.split('\n').map(normalizeDomain).filter(Boolean);
    console.log("Fetched threat URLs:", threatUrls);
    chrome.storage.local.set({ threatFeedCache: threatUrls, cacheTimestamp: Date.now() });
    return threatUrls;
  } catch (error) {
    console.error("Error fetching threat feed:", error);
    return [];
  }
}

chrome.runtime.onStartup.addListener(() => {
  console.log("Clearing all dynamic rules and storage on startup");
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [],
    addRules: []
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Error clearing rules on startup:", chrome.runtime.lastError);
    } else {
      console.log("Dynamic rules cleared on startup");
    }
  });
  chrome.storage.sync.clear(() => {
    console.log("Storage cleared on startup");
  });
});

chrome.storage.sync.get(["allowedUrls", "blacklist", "blockEnabled"], (data) => {
  console.log("Initial storage data:", data);
  if (data.allowedUrls) {
    data.allowedUrls.forEach(url => ALLOWED_URLS.add(url));
  }
  if (data.blacklist && data.blockEnabled !== false) {
    console.log("Applying initial blacklist:", data.blacklist);
    updateDynamicRules(data.blacklist);
  }
  chrome.storage.local.get(["threatFeedCache", "cacheTimestamp"], (cacheData) => {
    const now = Date.now();
    if (cacheData.threatFeedCache && cacheData.cacheTimestamp && (now - cacheData.cacheTimestamp < 60 * 60 * 1000)) {
      console.log("Using cached threat feed");
      const blacklist = data.blacklist || [];
      const updatedBlacklist = [...new Set([...blacklist, ...cacheData.threatFeedCache])];
      chrome.storage.sync.set({ blacklist: updatedBlacklist }, () => {
        if (data.blockEnabled !== false) {
          updateDynamicRules(updatedBlacklist);
        }
      });
    } else {
      fetchThreatFeed().then(threatUrls => {
        if (threatUrls.length > 0) {
          const blacklist = data.blacklist || [];
          const updatedBlacklist = [...new Set([...blacklist, ...threatUrls])];
          chrome.storage.sync.set({ blacklist: updatedBlacklist }, () => {
            if (data.blockEnabled !== false) {
              updateDynamicRules(updatedBlacklist);
            }
          });
        }
      });
    }
  });
});

function updateDynamicRules(blacklist) {
  if (!blacklist || blacklist.length === 0) {
    console.log("No blacklist URLs to apply");
    clearDynamicRules();
    return;
  }

  const normalizedBlacklist = blacklist.map(normalizeDomain).filter(Boolean);
  console.log("Normalized blacklist:", normalizedBlacklist);

  chrome.declarativeNetRequest.getDynamicRules((existingRules) => {
    const ruleIdsToRemove = existingRules.map(rule => rule.id);
    const rules = normalizedBlacklist.map((domain, index) => ({
      id: index + 1,
      priority: 1,
      action: { type: "redirect", redirect: { url: chrome.runtime.getURL("blocked.html") + "?blockedUrl=" + encodeURIComponent(domain) } },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: ["main_frame"],
        excludedInitiatorDomains: ["chrome-extension://*"] // Prevent rules from applying to extension URLs
      }
    }));

    console.log("Applying rules:", JSON.stringify(rules, null, 2));

    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: rules
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error updating rules:", chrome.runtime.lastError);
      } else {
        console.log("Rules successfully updated:", rules);
        chrome.declarativeNetRequest.getDynamicRules((activeRules) => {
          console.log("Active dynamic rules:", JSON.stringify(activeRules, null, 2));
        });
      }
    });
  });
}

function clearDynamicRules() {
  chrome.declarativeNetRequest.getDynamicRules((existingRules) => {
    const ruleIdsToRemove = existingRules.map(rule => rule.id);
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: []
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error clearing rules:", chrome.runtime.lastError);
      } else {
        console.log("Dynamic rules cleared");
        chrome.declarativeNetRequest.getDynamicRules((activeRules) => {
          console.log("Active dynamic rules after clearing:", JSON.stringify(activeRules, null, 2));
        });
      }
    });
  });
}

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  console.log("Rule matched for original URL:", info.request.url);
  const url = normalizeDomain(info.request.url);
  if (url) {
    chrome.storage.local.get(["blockStats"], (data) => {
      const stats = data.blockStats || {};
      stats[url] = (stats[url] || 0) + 1;
      chrome.storage.local.set({ blockStats: stats });
    });
    // Store the original blocked URL for use in temporary unblock
    chrome.storage.local.set({ lastBlockedUrl: info.request.url });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["blacklist", "blockEnabled"], (data) => {
    console.log("On install - blacklist:", data.blacklist, "blockEnabled:", data.blockEnabled);
    if (data.blacklist && data.blockEnabled !== false) {
      updateDynamicRules(data.blacklist);
    }
  });
});

if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.action === "addUrl") {
        const normalizedUrl = normalizeDomain(message.url);
        if (!normalizedUrl) {
          sendResponse({ status: "error", message: "Invalid URL" });
          return true;
        }
        chrome.storage.sync.get(["blacklist"], (data) => {
          const blacklist = data.blacklist || [];
          if (!blacklist.includes(normalizedUrl)) {
            blacklist.push(normalizedUrl);
            console.log("Adding URL to blacklist:", normalizedUrl);
            chrome.storage.sync.set({ blacklist }, () => {
              chrome.storage.sync.get(["blockEnabled"], (data) => {
                if (data.blockEnabled !== false) {
                  updateDynamicRules(blacklist);
                }
                sendResponse({ status: "success" });
              });
            });
          } else {
            sendResponse({ status: "error", message: "URL already in blacklist" });
          }
        });
      } else if (message.action === "removeUrl") {
        const normalizedUrl = normalizeDomain(message.url);
        if (!normalizedUrl) {
          sendResponse({ status: "error", message: "Invalid URL" });
          return true;
        }
        chrome.storage.sync.get(["blacklist"], (data) => {
          const blacklist = data.blacklist || [];
          const updatedBlacklist = blacklist.filter(url => url !== normalizedUrl);
          console.log("Removing URL from blacklist:", normalizedUrl);
          chrome.storage.sync.set({ blacklist: updatedBlacklist }, () => {
            chrome.storage.sync.get(["blockEnabled"], (data) => {
              if (data.blockEnabled !== false) {
                updateDynamicRules(updatedBlacklist);
              }
              sendResponse({ status: "success" });
            });
          });
        });
      } else if (message.action === "toggleBlocking") {
        console.log("Toggle blocking:", message.enabled);
        chrome.storage.sync.get(["blacklist"], (data) => {
          if (message.enabled && data.blacklist) {
            updateDynamicRules(data.blacklist);
            sendResponse({ status: "success" });
          } else {
            clearDynamicRules();
            sendResponse({ status: "success" });
          }
        });
      } else if (message.action === "blockedUrl") {
        console.log("Blocked URL detected:", message.url);
        chrome.storage.local.set({ lastBlockedUrl: message.url });
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "Website Blocked",
          message: `The site ${message.url} was blocked by SafeShield.`
        });
        sendResponse({ status: "success" });
      } else if (message.action === "temporaryUnblock") {
        // Use the last blocked URL stored during rule match
        chrome.storage.local.get(["lastBlockedUrl", "blacklist"], (data) => {
          const originalUrl = data.lastBlockedUrl;
          const normalizedUrl = normalizeDomain(originalUrl);
          if (!normalizedUrl) {
            console.warn("Normalization failed, using original URL for unblock:", originalUrl);
            const blacklist = data.blacklist || [];
            const tempBlacklist = blacklist.filter(url => url !== originalUrl);
            console.log("Temporarily unblocking (using original URL):", originalUrl);
            updateDynamicRules(tempBlacklist);
            setTimeout(() => {
              console.log("Restoring blacklist after temporary unblock");
              updateDynamicRules(blacklist);
            }, message.duration || 10 * 60 * 1000);
            sendResponse({ status: "success", unblockedUrl: originalUrl });
            return;
          }
          const blacklist = data.blacklist || [];
          const tempBlacklist = blacklist.filter(url => url !== normalizedUrl);
          console.log("Temporarily unblocking:", normalizedUrl);
          updateDynamicRules(tempBlacklist);
          setTimeout(() => {
            console.log("Restoring blacklist after temporary unblock");
            updateDynamicRules(blacklist);
          }, message.duration || 10 * 60 * 1000);
          sendResponse({ status: "success", unblockedUrl: originalUrl });
        });
      } else if (message.action === "refreshThreatFeed") {
        fetchThreatFeed().then(threatUrls => {
          if (threatUrls.length > 0) {
            chrome.storage.sync.get(["blacklist"], (data) => {
              const blacklist = data.blacklist || [];
              const updatedBlacklist = [...new Set([...blacklist, ...threatUrls])];
              chrome.storage.sync.set({ blacklist: updatedBlacklist }, () => {
                if (data.blockEnabled !== false) {
                  updateDynamicRules(updatedBlacklist);
                }
                sendResponse({ status: "success" });
              });
            });
          } else {
            sendResponse({ status: "error", message: "No threat URLs fetched" });
          }
        });
        return true;
      } else if (message.action === "blockedScript") {
        console.log("Blocked script detected:", message.url);
        sendResponse({ status: "success" });
      }
      return true;
    } catch (error) {
      console.error("Error in onMessage listener:", error);
      sendResponse({ status: "error", message: error.message });
      return true;
    }
  });
} else {
  console.error("chrome.runtime.onMessage is not available");
}