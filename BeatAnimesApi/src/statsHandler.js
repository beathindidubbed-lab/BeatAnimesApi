const CACHE = {}


async function increaseViews(headers) {
    try {
        // --- START: Enhanced Header Extraction ---
        let referer = null;

        // 1. Try case-insensitive .get() first (standard Fetch API / Worker environment)
        if (typeof headers.get === 'function') {
            referer = headers.get("Referer") || headers.get("referer");
        } else if (typeof headers === 'object' && headers !== null) {
            // 2. Fallback for raw Node.js 'req.headers' object (keys are lowercase)
            referer = headers['referer'];
        }
        
        // Ensure referer is treated as a string, defaulting to 'null' if still empty/undefined
        referer = String(referer || 'null');
        
        if (referer === 'null' || referer === 'undefined') {
            referer = "direct";
        }
        // --- END: Enhanced Header Extraction ---
        else {
            try {
                // Step 2: Attempt to construct a URL object from the referer string
                const url = new URL(referer);
                // Step 3: Extract only the origin (protocol + hostname + port)
                referer = url.origin;
            }
            catch (e) {
                // If parsing fails (e.g., referer is not a valid URL format), 
                // we assume it's a direct or malformed request
                console.log(`Error parsing Referer URL (${referer}): ${e.message}`);
                referer = "direct";
            }
        }
        
        // Use the cleaned or defaulted referer as the key
        const website = referer;
        console.log(`[Stats] Tracking website: ${website}`);

        // Increment local cache
        if (CACHE[website]) {
            CACHE[website] += 1
        } else {
            CACHE[website] = 1
        }

        // Only send to external API every 10 views
        if (CACHE[website] < 10) {
            return
        }

        // Send to external stats API
        const url = 'https://statsapi-production-871f.up.railway.app/increaseViews'
        // CRITICAL: Ensure we use the cleaned 'website' variable in the header we send out
        await fetch(url, { headers: { 'Referer': website } })

        CACHE[website] = 0
    } catch (e) {
        // Catch any errors during the entire process (caching, external fetch)
        console.error("Error in increaseViews:", e)
    }
}

export { increaseViews }
