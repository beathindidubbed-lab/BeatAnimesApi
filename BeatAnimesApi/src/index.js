import http from "http";
import { URL } from "url";

import {
    getSearch,
    getAnime,
    getRecentAnime,
    getPopularAnime,
    getEpisode,
    GogoDLScrapper,
    getGogoAuthKey,
    getHome,
} from "./gogo.js";

import {
    getAnilistTrending,
    getAnilistSearch,
    getAnilistAnime,
    getAnilistUpcoming,
} from "./anilist.js";
import { SaveError } from "./errorHandler.js";
import { increaseViews } from "./statsHandler.js";

// --- Caching Objects (In-Memory for simplicity) ---
let HOME_CACHE = { data: null, timestamp: 0 };
let ANIME_CACHE = {}; 
let SEARCH_CACHE = {};
let REC_CACHE = {};
let RECENT_CACHE = {};
let GP_CACHE = {};
let AT_CACHE = { data: null, timestamp: 0 }; // Anilist Trending

const CACHE_TTL_SECONDS = 3600; // 1 hour for general content
const HOME_CACHE_TTL_SECONDS = 300; // 5 minutes for home/trending

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const PORT = process.env.PORT || 8000;

/**
 * Checks if a cache entry is expired.
 * @param {object} cacheEntry The cache object { data, timestamp }
 * @param {number} ttlSeconds Time-to-live in seconds
 * @returns {boolean} True if expired or empty, false otherwise.
 */
function isCacheExpired(cacheEntry, ttlSeconds) {
    return !cacheEntry || !cacheEntry.data || (Date.now() - cacheEntry.timestamp) / 1000 > ttlSeconds;
}


http.createServer(async (req, res) => {
    let responseBody = "";
    let statusCode = 200;
    let contentType = "application/json";

    // Handle CORS pre-flight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    try {
        // The URL constructor correctly parses the request URL
        const fullUrl = new URL(req.url, `http://${req.headers.host}`); 
        const pathSegments = fullUrl.pathname.split("/").filter(Boolean);
        const endpoint = pathSegments[0];
        
        // --- 1. Increment View Count (non-blocking) ---
        // Pass the raw headers object to statsHandler
        increaseViews(req.headers).catch(e => console.error("Stats tracking failed:", e.message));

        // --- 2. API Routing ---
        if (endpoint === "ping") {
            responseBody = JSON.stringify({ status: "ok", timestamp: new Date().toISOString() });

        } else if (endpoint === "home") {
            if (isCacheExpired(HOME_CACHE, HOME_CACHE_TTL_SECONDS)) {
                HOME_CACHE.data = await getHome();
                HOME_CACHE.timestamp = Date.now();
                console.log("[CACHE] Refreshed Home Cache.");
            }
            responseBody = JSON.stringify(HOME_CACHE.data);

        } else if (endpoint === "trending") {
            const page = parseInt(pathSegments[1] || 1);
            const cacheKey = `anilist-trending-${page}`;
            if (isCacheExpired(AT_CACHE[cacheKey], HOME_CACHE_TTL_SECONDS)) {
                const data = await getAnilistTrending(page);
                AT_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Anilist Trending Page ${page} Cache.`);
            }
            responseBody = JSON.stringify(AT_CACHE[cacheKey].data);

        } else if (endpoint === "search") {
            const query = decodeURIComponent(pathSegments[1] || "");
            const page = parseInt(pathSegments[2] || 1);
            if (!query) throw new Error("Missing search query.");
            
            const cacheKey = `${query}-${page}`;
            if (isCacheExpired(SEARCH_CACHE[cacheKey], CACHE_TTL_SECONDS)) {
                const data = await getSearch(query, page);
                SEARCH_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Gogo Search Cache for: ${query} page ${page}.`);
            }
            responseBody = JSON.stringify(SEARCH_CACHE[cacheKey].data);

        } else if (endpoint === "recent") {
            const page = parseInt(pathSegments[1] || 1);
            const cacheKey = `gogo-recent-${page}`;
            if (isCacheExpired(RECENT_CACHE[cacheKey], CACHE_TTL_SECONDS)) {
                const data = await getRecentAnime(page);
                RECENT_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Gogo Recent Page ${page} Cache.`);
            }
            responseBody = JSON.stringify(RECENT_CACHE[cacheKey].data);

        } else if (endpoint === "gogoPopular") {
            const page = parseInt(pathSegments[1] || 1);
            const cacheKey = `gogo-popular-${page}`;
            if (isCacheExpired(GP_CACHE[cacheKey], CACHE_TTL_SECONDS)) {
                const data = await getPopularAnime(page);
                GP_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Gogo Popular Page ${page} Cache.`);
            }
            responseBody = JSON.stringify(GP_CACHE[cacheKey].data);

        } else if (endpoint === "anime") {
            const id = pathSegments[1];
            if (!id) throw new Error("Missing anime ID.");

            if (isCacheExpired(ANIME_CACHE[id], CACHE_TTL_SECONDS)) {
                const data = await getAnime(id);
                ANIME_CACHE[id] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Gogo Anime Cache for: ${id}.`);
            }
            responseBody = JSON.stringify(ANIME_CACHE[id].data);

        } else if (endpoint === "anilistSearch") {
            const query = decodeURIComponent(pathSegments[1] || "");
            if (!query) throw new Error("Missing Anilist search query.");

            const cacheKey = `anilist-search-${query}`;
            if (isCacheExpired(SEARCH_CACHE[cacheKey], CACHE_TTL_SECONDS)) {
                const data = await getAnilistSearch(query);
                SEARCH_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Anilist Search Cache for: ${query}.`);
            }
            responseBody = JSON.stringify(SEARCH_CACHE[cacheKey].data);

        } else if (endpoint === "anilistAnime") {
            const id = pathSegments[1];
            if (!id) throw new Error("Missing Anilist ID.");

            const cacheKey = `anilist-anime-${id}`;
            if (isCacheExpired(ANIME_CACHE[cacheKey], CACHE_TTL_SECONDS)) {
                const data = await getAnilistAnime(id);
                ANIME_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Anilist Anime Cache for: ${id}.`);
            }
            responseBody = JSON.stringify(ANIME_CACHE[cacheKey].data);

        } else if (endpoint === "anilistUpcoming") {
            const page = parseInt(pathSegments[1] || 1);
            const cacheKey = `anilist-upcoming-${page}`;
            if (isCacheExpired(AT_CACHE[cacheKey], CACHE_TTL_SECONDS)) {
                const data = await getAnilistUpcoming(page);
                AT_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Anilist Upcoming Page ${page} Cache.`);
            }
            responseBody = JSON.stringify(AT_CACHE[cacheKey].data);

        } else if (endpoint === "episode") {
            const id = pathSegments[1];
            if (!id) throw new Error("Missing episode ID.");

            const cacheKey = `episode-${id}`;
            // NOTE: Episode links change less frequently, using the general TTL
            if (isCacheExpired(ANIME_CACHE[cacheKey], CACHE_TTL_SECONDS)) { 
                const data = await getEpisode(id);
                ANIME_CACHE[cacheKey] = { data, timestamp: Date.now() };
                console.log(`[CACHE] Refreshed Episode Cache for: ${id}.`);
            }
            responseBody = JSON.stringify(ANIME_CACHE[cacheKey].data);

        } else if (endpoint === "download") {
            const id = pathSegments[1];
            if (!id) throw new Error("Missing episode ID for download.");
            // NOTE: Not caching downloads as the cookie might expire quickly
            const data = await GogoDLScrapper(id);
            responseBody = JSON.stringify(data);

        } else if (!endpoint || endpoint === "") {
            // Serve the simple HTML documentation on the root path
            contentType = "text/html";
            responseBody = '<!-- Docs HTML -->\n<style>body{font-family:sans-serif;line-height:1.6;margin:0;padding:20px;background-color:#f4f4f4;color:#333}.container{max-width:800px;margin:20px auto;padding:20px;background:#fff;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,0.1)}.header{background-color:#007bff;color:white;padding:15px;border-radius:8px 8px 0 0;text-align:center}.header h1{margin:0}.endpoint-list ul{list-style-type:none;padding:0}.endpoint-list li{background:#eee;margin-bottom:10px;padding:10px;border-left:5px solid #007bff;border-radius:4px}code{background-color:#e9ecef;padding:2px 4px;border-radius:3px}footer{text-align:center;margin-top:20px;font-size:0.9em;color:#666}</style><div class=header><h1>Beat Animes API Documentation</h1><p>Anime data from GogoAnime and Anilist</p></div><div class=container><div class=endpoint-list><h2>Endpoints:</h2><ul><li><code>/home</code> - Get GogoAnime's homepage data (recent & trending)<li><code>/search/{query}/{page?}</code> - Search GogoAnime for anime<li><code>/anime/{id}</code> - Get anime details and episode list from GogoAnime<li><code>/episode/{id}</code> - Get streaming video urls<li><code>/download/{id}</code> - Get episode download urls<li><code>/recent/{page}</code> - Get recent animes from gogoanime<li><code>/trending/{page}</code> - Get trending animes from anilist<li><code>/anilistSearch/{query}</code> - Search Anilist for anime<li><code>/anilistAnime/{id}</code> - Get detailed Anilist data for an anime<li><code>/anilistUpcoming/{page}</code> - Get upcoming animes from anilist<li><code>/gogoPopular/{page}</code> - Get popular animes from gogoanime<li><code>/ping</code> - Health check</ul></div><div class=container><h2>Quick Test:</h2><p>Try these endpoints:<ul><li><a href=\"/ping\">GET /ping</a><li><a href=\"/home\">GET /home</a><li><a href=\"/search/naruto\">GET /search/naruto</a><li><a href=\"/recent/1\">GET /recent/1</a></ul></div><footer><p>© 2024 Beat Animes API. All rights reserved.</footer>';
        } else {
            throw new Error("Endpoint not found");
        }

    } catch (e) {
        console.error(`❌ API Error [${req.url}]:`, e.message);
        await SaveError(e.message, req.url).catch(() => {});
        
        statusCode = e.message.includes("not found") ? 404 : 500;
        responseBody = JSON.stringify({ 
            error: e.message || "Internal Server Error",
            path: req.url,
            timestamp: new Date().toISOString()
        });
    }

    res.writeHead(statusCode, {
        "Content-Type": contentType,
        ...corsHeaders
    });
    res.end(responseBody);
}).listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
});
