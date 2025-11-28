import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import cheerio from "cheerio";
import { SaveError } from "./errorHandler.js"; // **CRITICAL: Ensure SaveError is imported**

// UPDATED DOMAINS: Using the currently most reliable domain. Scraper sites change often.
const GOGO_DOMAINS = [
    "https://gogoanimehd.io", // Currently reliable primary
   
];

let BaseURL = GOGO_DOMAINS[0]; // Start with first domain

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Function to try multiple domains if one fails, with clearer URL construction.
 */
async function fetchWithFallback(path, options = {}) {
    let lastError = new Error("Unknown connection error."); // Default error object

    for (const domain of GOGO_DOMAINS) {
        // Explicitly ensure correct URL construction
        const url = `${domain}${path}`; 
        try {
            console.log(`Attempting to fetch from: ${url}`); // Log the attempted URL for debugging
            const response = await fetch(url, {
                ...options,
                headers: {
                    "User-Agent": USER_AGENT,
                    ...options.headers
                }
            });

            if (response.ok) {
                BaseURL = domain; // Update to working domain
                console.log(`Successfully connected to ${domain}`);
                return response;
            }
            
            // If response is not ok, throw to trigger fallback/retry logic
            throw new Error(`HTTP Status ${response.status} from ${domain}`);

        } catch (error) {
            lastError = error;
            console.warn(`Attempt failed for ${domain}: ${error.message}`);
        }
    }
    
    // Log the final failure and rethrow
    console.error("All GogoAnime domains failed. Last error:", lastError.message);
    throw new Error(`Failed to connect to GogoAnime source after all retries. Last failed URL: ${BaseURL}${path}`);
}


async function getRecentAnime(page = 1) {
    // Gogoanime uses an AJAX endpoint for recent releases
    const urlPath = `/ajax/page-recent-release.html?page=${page}&type=1`; // type=1 for Sub

    try {
        const response = await fetchWithFallback(urlPath);
        const html = await response.text();
        const $ = cheerio.load(html);
        const results = [];

        $('div.last_episodes ul.items li').each((i, element) => {
            const $el = $(element);
            const title = $el.find('p.name a').attr('title');
            const animeId = $el.find('p.name a').attr('href').split('/')[2];
            const episodeNum = $el.find('p.episode').text().trim().replace('Episode ', '');
            const imgUrl = $el.find('div.img a img').attr('src');
            const episodeUrl = $el.find('p.name a').attr('href');

            if (title && animeId && episodeNum && imgUrl) {
                results.push({
                    id: animeId,
                    title: title,
                    image: imgUrl,
                    episodeId: episodeUrl.split('/')[1],
                    episodeNumber: parseInt(episodeNum),
                    url: `${BaseURL}${episodeUrl}`,
                });
            }
        });

        if (results.length === 0 && page === 1) {
             throw new Error("No recent anime found. Scraper likely broken.");
        }

        return { results };

    } catch (error) {
        console.error("getRecentAnime error:", error.message);
        await SaveError(`Gogoanime Recent Error: ${error.message}`, `${BaseURL}${urlPath}`).catch(() => {});
        throw new Error(`Failed To Load Recent Animes Page: ${page}. Scraper failed. Check GogoAnime HTML structure.`);
    }
}

async function getSearch(query, page = 1) {
    const path = `/search.html?keyword=${encodeURIComponent(query)}&page=${page}`;

    try {
        const response = await fetchWithFallback(path);
        const html = await response.text();
        const $ = cheerio.load(html);
        const results = [];

        $('div.last_episodes ul.items li').each((i, element) => {
            const $el = $(element);
            const title = $el.find('p.name a').attr('title');
            const animeId = $el.find('p.name a').attr('href').split('/category/')[1];
            const imgUrl = $el.find('div.img a img').attr('src');
            const released = $el.find('p.released').text().trim().replace('Released: ', '');

            if (title && animeId && imgUrl) {
                results.push({
                    id: animeId,
                    title: title,
                    image: imgUrl,
                    released: released,
                    url: `${BaseURL}/category/${animeId}`,
                });
            }
        });

        if (results.length === 0 && page === 1) {
            throw new Error("No results found");
        }

        return { results };

    } catch (error) {
        console.error("getSearch error:", error.message);
        await SaveError(`Gogoanime Search Error: ${error.message}`, `${BaseURL}${path}`).catch(() => {});
        throw new Error(`Failed To Load Search Results for '${query}'. Scraper failed. Check GogoAnime HTML structure.`);
    }
}


// Basic placeholder functions required for the API endpoints in index.js to work
async function getAnime(id) {
    const path = `/category/${id}`;
    try {
        const response = await fetchWithFallback(path);
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const title = $('div.anime_info_body_bg h1').text() || id;
        
        return {
            id: id,
            title: title,
            description: "Detailed description fetching not yet implemented in getAnime().",
            episodes: [], 
            status: $('div.anime_info_body_bg p:contains("Status:") a').text() || 'Unknown',
            image: $('div.anime_info_body_bg img').attr('src'),
            url: `${BaseURL}${path}`,
        };
    } catch (error) {
        console.error("getAnime error:", error.message);
        await SaveError(`Gogoanime Detail Error: ${error.message}`, `${BaseURL}${path}`).catch(() => {});
        throw new Error(`Failed to load anime details for ID: ${id}`);
    }
}

async function getPopularAnime(page = 1) {
    // Placeholder - requires scraping the popular section (usually a sidebar or dedicated page)
    console.warn("getPopularAnime is a placeholder and needs implementation.");
    return { results: [] };
}

async function getEpisode(id) {
    // Placeholder - requires scraping the embed player link
    console.warn("getEpisode is a placeholder and needs implementation.");
    return {
        sources: [
            { quality: "default", url: "https://your-video-host.com/video.mp4" }
        ],
        download: {}
    };
}


// Export all required functions
export {
    getSearch,
    getAnime,
    getRecentAnime,
    getPopularAnime,
    getEpisode,
    GogoDLScrapper,
    getGogoAuthKey,
    fetchWithFallback 
};

/**
 * Gets episode download links.
 * NOTE: Using atob fallback for environment compatibility.
 */
async function GogoDLScrapper(animeid, cookie) {
    try {
        let decodedCookie = cookie;
        if (!cookie) {
            const encodedCookie = await getGogoAuthKey();
            // Assuming the encoded cookie is Base64 and needs decoding
            try {
                // Use Buffer.from for Node.js environments (like Render)
                decodedCookie = Buffer.from(encodedCookie, 'base64').toString('utf8');
            } catch (e) {
                // Fallback for non-Node environments (unlikely on Render, but safe)
                decodedCookie = atob(encodedCookie);
            }
        } else {
            decodedCookie = atob(cookie); // Assuming the passed cookie is also encoded
        }

        const response = await fetchWithFallback("/" + animeid, {
            headers: {
                Cookie: `auth=${decodedCookie}`
            }
        });

        const html = await response.text();
        const body = cheerio.load(html);
        let data = {};
        const links = body("div.cf-download").find("a");

        links.each((i, link) => {
            const a = body(link);
            const quality = a.text().trim();
            const url = a.attr("href");
            if (quality && url) {
                data[quality] = url.trim();
            }
        });

        return data;
    } catch (e) {
        console.error("GogoDLScrapper error:", e.message);
        await SaveError(`GogoDLScrapper Error: ${e.message}`, "/download/" + animeid).catch(() => {});
        return {};
    }
}

async function getGogoAuthKey() {
    try {
        // Fetching auth key from a GitHub content endpoint
        const response = await fetch(
            "https://api.github.com/repos/TechShreyash/TechShreyash/contents/gogoCookie.txt", {
                headers: {
                    "User-Agent": USER_AGENT,
                },
            }
        );
        const data = await response.json();
        // GitHub content is Base64 encoded, need to decode it
        const base64Content = data["content"].replaceAll("\n", "");
        return base64Content; // Return the base64 string
    } catch (error) {
        console.error("getGogoAuthKey error:", error.message);
        await SaveError(`GogoAuthKey Fetch Error: ${error.message}`).catch(() => {});
        return null;
    }
}
