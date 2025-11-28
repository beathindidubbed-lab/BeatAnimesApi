import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
import cheerio from "cheerio";
import { SaveError } from "./errorHandler.js"; // Import SaveError

// UPDATED: Try multiple working GogoAnime domains
const GOGO_DOMAINS = [
    "https://anitaku.pe", // Current working domain
    "https://gogoanime3.co", // Backup
    "https://gogoanime.hu", // Backup
];

let BaseURL = GOGO_DOMAINS[0]; // Start with first domain

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Function to try multiple domains if one fails
async function fetchWithFallback(path, options = {}) {
    let lastError;

    for (const domain of GOGO_DOMAINS) {
        try {
            const url = domain + path;
            const response = await fetch(url, {
                ...options,
                headers: {
                    "User-Agent": USER_AGENT,
                    ...options.headers
                }
            });

            if (response.ok) {
                BaseURL = domain; // Update to working domain
                return response;
            }
        } catch (error) {
            lastError = error;
            console.warn(`Attempt failed for ${domain}: ${error.message}`);
        }
    }
    console.error("All GogoAnime domains failed. Last error:", lastError);
    throw new Error("Failed to connect to GogoAnime source after all retries.");
}


async function getRecentAnime(page = 1) {
    // Gogoanime uses an AJAX endpoint for recent releases
    const url = `${BaseURL}/ajax/page-recent-release.html?page=${page}&type=1`; // type=1 for Sub

    try {
        const response = await fetchWithFallback(url);
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

        if (results.length === 0) {
             // Do not throw if it's just the end of pages, but if page 1 fails, something is wrong
             if (page == 1) throw new Error("No recent anime found");
        }

        return { results };

    } catch (error) {
        console.error("getRecentAnime error:", error.message);
        await SaveError(`Gogoanime Recent Error: ${error.message}`, url).catch(() => {});
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
        await SaveError(`Gogoanime Search Error: ${error.message}`, path).catch(() => {});
        throw new Error(`Failed To Load Search Results for '${query}'. Scraper failed. Check GogoAnime HTML structure.`);
    }
}


// Basic placeholder functions required for the API endpoints in index.js to work
async function getAnime(id) {
    // This is a placeholder. You need to implement the detailed page scraping here.
    const path = `/category/${id}`;
    try {
        const response = await fetchWithFallback(path);
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Example structure for a placeholder response
        const title = $('div.anime_info_body_bg h1').text() || id;
        
        return {
            id: id,
            title: title,
            description: "Detailed description fetching not yet implemented in getAnime().",
            episodes: [], // Need to scrape episode list here
            status: $('div.anime_info_body_bg p:contains("Status:") a').text() || 'Unknown',
            image: $('div.anime_info_body_bg img').attr('src'),
            url: `${BaseURL}${path}`,
        };
    } catch (error) {
        console.error("getAnime error:", error.message);
        await SaveError(`Gogoanime Detail Error: ${error.message}`, path).catch(() => {});
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
    fetchWithFallback // Useful for external testing
};

// Existing functions from the original snippet (GogoDLScrapper, getGogoAuthKey) were kept as they are.

async function GogoDLScrapper(animeid, cookie) {
    // ... (Existing implementation)
    try {
        if (!cookie) {
            cookie = await getGogoAuthKey();
            cookie = Buffer.from(cookie, 'base64').toString('utf8');
        } else {
            cookie = atob(cookie);
        }
        const response = await fetchWithFallback("/" + animeid, {
            headers: {
                Cookie: `auth=${cookie}`
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
        const response = await fetch(
            "https://api.github.com/repos/TechShreyash/TechShreyash/contents/gogoCookie.txt", {
                headers: {
                    "User-Agent": USER_AGENT,
                },
            }
        );
        const data = await response.json();
        const cookie = data["content"].replaceAll("\n", "");
        return cookie;
    } catch (error) {
        console.error("getGogoAuthKey error:", error.message);
        await SaveError(`GogoAuthKey Fetch Error: ${error.message}`).catch(() => {});
        return null;
    }
}

// Exports adjusted at the top for clarity.
