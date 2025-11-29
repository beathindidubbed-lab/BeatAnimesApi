import {
    generateEncryptAjaxParameters,
    decryptEncryptAjaxResponse,
} from "./gogo_extractor.js";
// FIX: Changed default import to named import 'load' to fix the constructor error
import { load } from "cheerio"; 

// UPDATED: Removed anitaku.pe based on user feedback to improve reliability.
const GOGO_DOMAINS = [
    "https://anitaku.to",      // Current primary working domain 
    "https://gogoanime3.co",   // Backup
    "https://gogoanime.hu",    // Backup
    "https://gogoanimehd.io",  // Additional Backup
];

let BaseURL = GOGO_DOMAINS[0]; // Start with the new primary domain

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Utility function for creating a delay.
 * @param {number} ms Milliseconds to wait
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Tries multiple domains and uses exponential backoff for retries until a successful fetch is made.
 * If successful, it updates BaseURL to the working domain.
 * @param {string} path The path to fetch (e.g., "/category/anime-name")
 * @param {object} options Fetch options (headers, body, etc.)
 * @returns {Promise<Response>} The fetch response
 * @throws {Error} If all domains and all retries fail
 */
async function fetchWithFallback(path, options = {}) {
    let lastError;
    const MAX_RETRIES = 2; // Maximum retries per domain (3 total attempts)
    
    for (const domain of GOGO_DOMAINS) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = domain + path;
                
                // --- Stricter Timeout Logic ---
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal, // Apply the timeout signal
                    // START: Enhanced Headers for Anti-Bot Bypass
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                        "Connection": "keep-alive",
                        "Referer": domain + "/", // Adding a referer header
                        ...options.headers
                    }
                    // END: Enhanced Headers
                });
                
                clearTimeout(timeout); // Clear the timeout if the request succeeds quickly

                // Check for OK response status (200-299)
                if (response.ok) {
                    // Peek at the response content to check for the 'Redirecting...' block
                    const htmlCheck = await response.clone().text(); 
                    if (htmlCheck.includes("<title>Redirecting...</title>")) {
                        throw new Error("Anti-Bot Page detected.");
                    }

                    BaseURL = domain; // Update to the currently working domain
                    return response; // Success!
                } else {
                    // If status is not OK (e.g., 404, 500), throw an error to trigger retry/fallback
                    throw new Error(`Non-OK status: ${response.status} from ${domain}`);
                }
            } catch (error) {
                lastError = error;
                
                if (attempt < MAX_RETRIES) {
                    // Exponential Backoff: Delay 1s, 2s, 4s...
                    const delay = Math.pow(2, attempt) * 1000; 
                    console.warn(`[GOGO Retry] Domain ${domain} failed (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay / 1000}s. Error: ${error.message}`);
                    await wait(delay);
                } else {
                    console.warn(`[GOGO Fallback] Domain ${domain} failed after ${MAX_RETRIES + 1} attempts. Trying next domain. Last error: ${error.message}`);
                }
            }
        }
    }

    // If the loop finishes without returning a response, all domains failed
    throw new Error(`All GogoAnime domains failed. Last error: ${lastError ? lastError.message : "Unknown error"}`);
}


/**
 * Scrapes the home page for trending and recently added anime.
 * @returns {Promise<object>} The homepage data
 */
async function getHome() {
    try {
        const response = await fetchWithFallback("/?page=1");
        const html = await response.text();
        const body = load(html); 
        
        const recent = [];
        // REINFORCED SELECTOR: Targeting list items in the main body recent section
        body("div.main_body div.last_episodes ul.items li").each((i, el) => {
            const $el = body(el);
            const linkEl = $el.find("p.name a");
            const title = linkEl.attr("title") || linkEl.text().trim(); // Use text if title attribute is missing
            
            recent.push({
                id: linkEl.attr("href").replace("/", ""),
                title: title,
                image: $el.find("div.img a img").attr("src"),
                release: $el.find("p.released").text().trim(), 
                episode: parseInt($el.find("p.episode").text().trim().replace("Episode ", "")),
            });
        });

        const trending = [];
        // REINFORCED SELECTOR: Targeting list items in the trending section
        body("div.main_body div.right_content div.clr.wk-ep-list ul.items li").each((i, el) => {
            const $el = body(el);
            const linkEl = $el.find("p.name a");
            const title = linkEl.attr("title") || linkEl.text().trim(); // Use text if title attribute is missing
            
            trending.push({
                id: linkEl.attr("href").replace("/", ""),
                title: title,
                image: $el.find("div.img a img").attr("src"),
                release: $el.find("p.released").text().trim(),
            });
        });

        return { recent, trending };

    } catch (e) {
        console.error("getHome error:", e.message);
        throw new Error("Failed to load GogoAnime homepage data.");
    }
}


/**
 * Scrapes the search results for a given query and page.
 * @param {string} query The search query
 * @param {number} page The page number (default 1)
 * @returns {Promise<object>} Search results
 */
async function getSearch(query, page = 1) {
    let html = "";
    try {
        const response = await fetchWithFallback(
            `/search.html?keyword=${query}&page=${page}`
        );
        html = await response.text(); // Capture HTML here
        const body = load(html); 

        const data = [];
        // REINFORCED SELECTOR: Targeting list items in the main body search results
        body("div.main_body div.last_episodes ul.items li").each((i, el) => {
            const $el = body(el);
            const linkEl = $el.find("p.name a");
            const title = linkEl.attr("title") || linkEl.text().trim(); // Use text if title attribute is missing
            
            data.push({
                id: linkEl.attr("href").replace("/category/", ""),
                title: title,
                image: $el.find("div.img a img").attr("src"),
                release: $el.find("p.released").text().trim(),
            });
        });

        if (data.length === 0) {
            console.warn(`[GOGO DEBUG] Search for '${query}' returned 0 results.`);
            // DEBUG LOG: Log the start of the HTML body if no results were found
            console.warn(`[GOGO DEBUG] HTML Snippet (First 500 chars):\n${html.substring(0, 500)}...`);
        }

        return { results: data };
    } catch (e) {
        console.error("getSearch error:", e.message);
        throw new Error(`Failed to fetch GogoAnime search results for: ${query}. Scraper failed. Check GogoAnime HTML structure.`);
    }
}

/**
 * Scrapes the anime detail page.
 * @param {string} animeId The anime ID (slug)
 * @returns {Promise<object>} Anime details and episode list
 */
async function getAnime(animeId) {
    try {
        const response = await fetchWithFallback(`/category/${animeId}`);
        const html = await response.text();
        const body = load(html); // Using the imported 'load' function

        const detailEl = body("div.anime_info_body_bg");

        const details = {
            id: animeId,
            title: detailEl.find("h1").text().trim(),
            image: detailEl.find("img").attr("src"),
            // Using a more robust path for synopsis (or default to a known structure)
            synopsis: body("div.anime_info_body_bg p.type:nth-child(5)").text().replace("Plot Summary: ", "").trim(),
            genres: body("div.anime_info_body_bg p.type:nth-child(6) a").map((i, el) => body(el).attr("title")).get(),
            release: body("div.anime_info_body_bg p.type:nth-child(7)").text().replace("Released: ", "").trim(),
            status: body("div.anime_info_body_bg p.type:nth-child(8) a").text().trim(),
            otherName: body("div.anime_info_body_bg p.type:nth-child(9)").text().replace("Other name: ", "").trim(),
        };

        const epStart = body("#episode_page a").first().attr("ep_start");
        const epEnd = body("#episode_page a").last().attr("ep_end");
        const movieId = body("#movie_id").attr("value");
        const alias = body("#alias_anime").attr("value");

        const episodes = await getEpisodeList(epStart, epEnd, movieId, alias);

        return { details, episodes };
    } catch (e) {
        console.error("getAnime error:", e.message);
        throw new Error(`Failed to fetch GogoAnime details for: ${animeId}`);
    }
}


/**
 * Fetches the full list of episodes for an anime using AJAX.
 * @param {string} epStart Starting episode number
 * @param {string} epEnd Ending episode number
 * @param {string} movieId The anime's unique ID used for episode fetching
 * @param {string} alias The anime's alias/slug
 * @returns {Promise<Array<object>>} List of episodes
 */
async function getEpisodeList(epStart, epEnd, movieId, alias) {
    try {
        const fetchUrl = `${BaseURL}/ajax/load-list-episode?ep_start=${epStart}&ep_end=${epEnd}&id=${movieId}&alias=${alias}`;
        const response = await fetch(fetchUrl);
        const html = await response.text();
        const body = load(html); // Using the imported 'load' function

        const episodes = [];
        body("li").each((i, el) => {
            const $el = body(el);
            episodes.push({
                id: $el.find("a").attr("href").split("/")[1],
                episode: $el.find("a div.name").text().replace("EP ", ""),
                title: $el.find("a div.name").text(),
                type: $el.find("a div.cate").text().trim(),
            });
        });
        // Reverse order to get episode 1 first
        return episodes.reverse(); 

    } catch (e) {
        console.error("getEpisodeList error:", e.message);
        // Do not re-throw, just return an empty array if episode list fails to load
        return [];
    }
}


/**
 * Scrapes the episode page for streaming links.
 * @param {string} episodeId The full episode ID (slug)
 * @returns {Promise<object>} Streaming links (vidcloud, etc.)
 */
async function getEpisode(episodeId) {
    try {
        const response = await fetchWithFallback(`/${episodeId}`);
        const html = await response.text();
        const body = load(html); // Using the imported 'load' function

        const videoLinks = [];

        // Scrape the main streaming server links
        body("div.x-server-list ul li").each((i, el) => {
            const $el = body(el);
            const serverName = $el.find("a").text().trim();
            const serverId = $el.attr("data-value");
            const iframeUrl = $el.find("a").attr("data-video");

            if (serverId && iframeUrl) {
                videoLinks.push({
                    name: serverName,
                    server: serverId,
                    url: iframeUrl,
                });
            }
        });

        // The main server is usually the first one (GoGo server)
        const gogoIframeUrl = videoLinks.find(link => link.server === 'gogocdn')?.url || videoLinks[0]?.url;

        if (!gogoIframeUrl) {
            throw new Error("No video iframe found for this episode.");
        }
        
        // Extract the embedded video details from the iframe
        const gogoUrl = new URL(gogoIframeUrl);
        const gogoResponse = await fetch(gogoUrl.toString());
        const gogoHtml = await gogoResponse.text();
        const gogoBody = load(gogoHtml); // Using the imported 'load' function

        const embeddedVideoId = gogoUrl.searchParams.get("id");
        if (!embeddedVideoId) {
            throw new Error("Could not find embedded video ID.");
        }

        const params = await generateEncryptAjaxParameters(gogoBody, embeddedVideoId);
        const encryptedAjaxUrl = `${gogoUrl.origin}/encrypt-ajax.php?${params}`;

        const encryptedResponse = await fetch(encryptedAjaxUrl, {
            headers: {
                "X-Requested-With": "XMLHttpRequest",
            },
        });
        
        const encryptedJson = await encryptedResponse.json();
        const decryptedLinks = decryptEncryptAjaxResponse(encryptedJson);

        const sourceLinks = decryptedLinks.map(link => ({
            quality: link.label.replace(" ", "-"),
            url: link.file,
        }));

        return { videoLinks, streaming: sourceLinks };

    } catch (e) {
        console.error("getEpisode error:", e.message);
        throw new Error(`Failed to fetch streaming links for: ${episodeId}. Details: ${e.message}`);
    }
}

/**
 * Scrapes the recent anime list.
 * @param {number} page The page number (default 1)
 * @returns {Promise<object>} Recent anime results
 */
async function getRecentAnime(page = 1) {
    try {
        const response = await fetchWithFallback(`/top-airing.html?page=${page}`);
        const html = await response.text();
        const body = load(html); // Using the imported 'load' function

        const data = [];
        body("div.added_series_body.popular ul.listing li").each((i, el) => {
            const $el = body(el);
            data.push({
                id: $el.find("a").attr("href").replace("/category/", ""),
                title: $el.find("a").text().trim(),
                image: $el.find("img").attr("src"),
                genre: $el.find("p.genre a").text().trim(),
                release: $el.find("p.released").text().trim().replace("Released: ", ""),
            });
        });

        return { results: data };

    } catch (e) {
        console.error("getRecentAnime error:", e.message);
        throw new Error("Failed to fetch recent GogoAnime data.");
    }
}


/**
 * Scrapes the popular anime list.
 * @param {number} page The page number (default 1)
 * @returns {Promise<object>} Popular anime results
 */
async function getPopularAnime(page = 1) {
    try {
        const response = await fetchWithFallback(`/popular.html?page=${page}`);
        const html = await response.text();
        const body = load(html); // Using the imported 'load' function

        const data = [];
        body("div.added_series_body.popular ul.listing li").each((i, el) => {
            const $el = body(el);
            data.push({
                id: $el.find("a").attr("href").replace("/category/", ""),
                title: $el.find("a").text().trim(),
                image: $el.find("img").attr("src"),
                genre: $el.find("p.genre a").text().trim(),
                release: $el.find("p.released").text().trim().replace("Released: ", ""),
            });
        });

        return { results: data };

    } catch (e) {
        console.error("getPopularAnime error:", e.message);
        throw new Error("Failed to fetch popular GogoAnime data.");
    }
}


/**
 * Scrapes download links from the download page (requires auth cookie).
 * NOTE: This function's reliability depends entirely on the 'auth' cookie being valid.
 * @param {string} animeid The full episode ID (e.g., 'anime-name-episode-1')
 * @returns {Promise<object>} Download links by quality
 */
async function GogoDLScrapper(animeid) {
    try {
        const cookieBase64 = await getGogoAuthKey();
        if (!cookieBase64) {
            throw new Error("Gogo download auth key is unavailable.");
        }
        
        // Decode the Base64-encoded cookie string
        const cookie = atob(cookieBase64); 

        const response = await fetchWithFallback("/" + animeid, {
            headers: {
                Cookie: `auth=${cookie}`,
            },
        });
        
        const html = await response.text();
        const body = load(html); // Using the imported 'load' function
        let data = {};
        
        // Check for download section visibility
        const downloadSection = body("div.cf-download");
        if (downloadSection.length === 0) {
            console.warn(`GogoDLScrapper: Download section not found for ${animeid}. Check auth cookie validity.`);
            return {};
        }

        const links = downloadSection.find("a");
        
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
        // Returning an empty object if scraping fails due to auth or structure changes
        return {}; 
    }
}

/**
 * Fetches the base64-encoded GogoAnime auth cookie from a GitHub repository.
 * @returns {Promise<string>} The base64-encoded cookie string
 */
async function getGogoAuthKey() {
    try {
        // Fetching the base64-encoded cookie from a public Gist/File
        const response = await fetch(
            "https://api.github.com/repos/TechShreyash/TechShreyash/contents/gogoCookie.txt",
            {
                headers: {
                    "User-Agent": USER_AGENT,
                },
            }
        );
        const data = await response.json();
        // The content field is base64-encoded by GitHub for file contents
        const cookie = data["content"].replaceAll("\n", "");
        return cookie;
    } catch (error) {
        console.error("getGogoAuthKey error:", error.message);
        return ""; // Return empty string on failure
    }
}


export {
    getSearch,
    getAnime,
    getRecentAnime,
    getPopularAnime,
    getEpisode,
    GogoDLScrapper,
    getGogoAuthKey,
    getHome,
};
