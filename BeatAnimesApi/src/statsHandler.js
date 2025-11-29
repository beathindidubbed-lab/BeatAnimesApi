const CACHE = {}


async function increaseViews(headers) {
    try {
        // FIX: headers is a standard Node.js object, not a browser Headers object.
        // We access properties directly (Node.js lowercases all header keys).
        let referer = String(headers.referer || headers.Referer || 'null');
        
        if (referer === 'null' || referer === 'undefined') {
            referer = "direct";
        }
        else {
            try {
                // Ensure referer is a string before passing to URL constructor
                const url = new URL(String(referer));
                referer = url.origin
            }
            catch (e) {
                console.log("Error processing referer URL:", e.message);
                referer = "direct"; // Fallback to 'direct' if URL construction fails
            }
        }
        
        const website = referer
        console.log("Tracking view for:", website)

        if (CACHE[website]) {
            CACHE[website] += 1
        } else {
            CACHE[website] = 1
        }

        if (CACHE[website] < 10) {
            return
        }

        const url = 'https://statsapi-production-871f.up.railway.app/increaseViews'
        await fetch(url, { headers: { 'Referer': website } })

        CACHE[website] = 0
    } catch (e) {
        console.log("Global increaseViews error:", e.message)
    }
}

export default increaseViews
