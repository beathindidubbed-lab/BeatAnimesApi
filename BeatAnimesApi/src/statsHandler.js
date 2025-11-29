const CACHE = {}


async function increaseViews(headers) {
    try {
        // Step 1: Get the referer, checking both cases as a precaution, though 'get' should be case-insensitive.
        // We ensure it's a string, and if null/undefined, treat it as 'null'.
        let referer = String(headers.get("Referer") || headers.get("referer") || 'null');
        
        if (referer === 'null' || referer === 'undefined') {
            referer = "direct";
        }
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
