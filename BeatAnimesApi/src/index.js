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
} from "./gogo.js";

import {
    getAnilistTrending,
    getAnilistSearch,
    getAnilistAnime,
    getAnilistUpcoming,
} from "./anilist.js";
import { SaveError } from "./errorHandler.js";
import { increaseViews } from "./statsHandler.js";

let CACHE = {};
let HOME_CACHE = {};
let ANIME_CACHE = {};
let SEARCH_CACHE = {};
let REC_CACHE = {};
let RECENT_CACHE = {};
let GP_CACHE = {};
let AT_CACHE = {};

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const PORT = process.env.PORT || 8000;

// Cache cleanup interval (e.g., clear caches every 6 hours)
const CACHE_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; 

function cleanupCache() {
    HOME_CACHE = {};
    ANIME_CACHE = {};
    SEARCH_CACHE = {};
    REC_CACHE = {};
    RECENT_CACHE = {};
    GP_CACHE = {};
    AT_CACHE = {};
    console.log("✅ Caches cleared successfully.");
}

// Start cache cleanup timer
setInterval(cleanupCache, CACHE_CLEANUP_INTERVAL);


http.createServer(async (req, res) => {
    let responseBody = "";
    let statusCode = 200;
    let contentType = "application/json";

    try {
        const fullUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = fullUrl.pathname;
        const headers = req.headers;
        let query;
        let page;
        let id;

        // Handle CORS preflight requests
        if (req.method === "OPTIONS") {
            res.writeHead(204, corsHeaders);
            res.end();
            return;
        }

        // Increase view count in background
        increaseViews(headers).catch(e => console.error("Stats Error:", e.message));

        if (pathname === "/home") {
            if (HOME_CACHE["home"]) {
                responseBody = JSON.stringify(HOME_CACHE["home"]);
            } else {
                const recent = await getRecentAnime(1);
                const trending = await getAnilistTrending(1);
                const data = {
                    recent: recent.results,
                    trending: trending.results,
                };
                HOME_CACHE["home"] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/search/")) {
            const parts = pathname.split("/").filter(Boolean);
            query = parts[1];
            page = parts[2] ? parseInt(parts[2], 10) : 1;

            if (!query) {
                throw new Error("Search query is required.");
            }

            const cacheKey = `${query}_${page}`;
            if (SEARCH_CACHE[cacheKey]) {
                responseBody = JSON.stringify(SEARCH_CACHE[cacheKey]);
            } else {
                const data = await getSearch(query, page);
                SEARCH_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/anime/")) {
            id = pathname.split("/").filter(Boolean)[1];
            if (!id) {
                throw new Error("Anime ID is required.");
            }

            if (ANIME_CACHE[id]) {
                responseBody = JSON.stringify(ANIME_CACHE[id]);
            } else {
                const data = await getAnime(id);
                ANIME_CACHE[id] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/episode/")) {
            id = pathname.split("/").filter(Boolean)[1];
            if (!id) {
                throw new Error("Episode ID is required.");
            }

            if (CACHE[id]) {
                responseBody = JSON.stringify(CACHE[id]);
            } else {
                const data = await getEpisode(id);
                CACHE[id] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/download/")) {
            id = pathname.split("/").filter(Boolean)[1];
            if (!id) {
                throw new Error("Episode ID is required for download.");
            }

            const cookie = await getGogoAuthKey();
            const data = await GogoDLScrapper(id, cookie);
            responseBody = JSON.stringify(data);

        } else if (pathname.startsWith("/recent/")) {
            page = pathname.split("/").filter(Boolean)[1] ? parseInt(pathname.split("/").filter(Boolean)[1], 10) : 1;
            const cacheKey = `recent_${page}`;
            if (RECENT_CACHE[cacheKey]) {
                responseBody = JSON.stringify(RECENT_CACHE[cacheKey]);
            } else {
                const data = await getRecentAnime(page);
                RECENT_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/gogoPopular/")) {
            page = pathname.split("/").filter(Boolean)[1] ? parseInt(pathname.split("/").filter(Boolean)[1], 10) : 1;
            const cacheKey = `gogopopular_${page}`;
            if (GP_CACHE[cacheKey]) {
                responseBody = JSON.stringify(GP_CACHE[cacheKey]);
            } else {
                const data = await getPopularAnime(page);
                GP_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/trending/")) {
            page = pathname.split("/").filter(Boolean)[1] ? parseInt(pathname.split("/").filter(Boolean)[1], 10) : 1;
            const cacheKey = `trending_${page}`;
            if (AT_CACHE[cacheKey]) {
                responseBody = JSON.stringify(AT_CACHE[cacheKey]);
            } else {
                const data = await getAnilistTrending(page);
                AT_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/anilistSearch/")) {
            query = pathname.split("/").filter(Boolean)[1];
            if (!query) {
                throw new Error("Anilist search query is required.");
            }

            const cacheKey = `anilist_search_${query}`;
            if (SEARCH_CACHE[cacheKey]) {
                responseBody = JSON.stringify(SEARCH_CACHE[cacheKey]);
            } else {
                const data = await getAnilistSearch(query);
                SEARCH_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/anilistAnime/")) {
            id = pathname.split("/").filter(Boolean)[1];
            if (!id) {
                throw new Error("Anilist Anime ID is required.");
            }

            const cacheKey = `anilist_anime_${id}`;
            if (ANIME_CACHE[cacheKey]) {
                responseBody = JSON.stringify(ANIME_CACHE[cacheKey]);
            } else {
                const data = await getAnilistAnime(id);
                ANIME_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname.startsWith("/anilistUpcoming/")) {
            page = pathname.split("/").filter(Boolean)[1] ? parseInt(pathname.split("/").filter(Boolean)[1], 10) : 1;
            const cacheKey = `anilist_upcoming_${page}`;
            if (AT_CACHE[cacheKey]) {
                responseBody = JSON.stringify(AT_CACHE[cacheKey]);
            } else {
                const data = await getAnilistUpcoming(page);
                AT_CACHE[cacheKey] = data;
                responseBody = JSON.stringify(data);
            }
        } else if (pathname === "/ping") {
            responseBody = JSON.stringify({ status: "ok", timestamp: new Date().toISOString() });
        } else if (pathname === "/") {
            contentType = "text/html";
            // FIX: Using template literal to prevent SyntaxError with long strings
            responseBody = `<!-- Docs HTML -->
<style>
body { font-family: sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f4f4f4; color: #333; }
.container { max-width: 800px; margin: 20px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
.header { background-color: #007bff; color: white; padding: 15px; border-radius: 8px 8px 0 0; text-align: center; }
.header h1 { margin: 0; }
.endpoint-list ul { list-style-type: none; padding: 0; }
.endpoint-list li { background: #eee; margin-bottom: 10px; padding: 10px; border-left: 5px solid #007bff; border-radius: 4px; }
code { background-color: #e9ecef; padding: 2px 4px; border-radius: 3px; }
footer { text-align: center; margin-top: 20px; font-size: 0.9em; color: #666; }
</style>
<div class="header">
    <h1>Beat Animes API Documentation</h1>
    <p>Anime data from GogoAnime and Anilist</p>
</div>
<div class="container">
    <div class="endpoint-list">
        <h2>Endpoints:</h2>
        <ul>
            <li><code>/home</code> - Get GogoAnime's homepage data (recent & trending)</li>
            <li><code>/search/{query}/{page?}</code> - Search GogoAnime for anime</li>
            <li><code>/anime/{id}</code> - Get anime details and episode list from GogoAnime</li>
            <li><code>/episode/{id}</code> - Get streaming video urls</li>
            <li><code>/download/{id}</code> - Get episode download urls</li>
            <li><code>/recent/{page}</code> - Get recent animes from gogoanime</li>
            <li><code>/trending/{page}</code> - Get trending animes from anilist</li>
            <li><code>/anilistSearch/{query}</code> - Search Anilist for anime</li>
            <li><code>/anilistAnime/{id}</code> - Get detailed Anilist data for an anime</li>
            <li><code>/anilistUpcoming/{page}</code> - Get upcoming animes from anilist</li>
            <li><code>/gogoPopular/{page}</code> - Get popular animes from gogoanime</li>
            <li><code>/ping</code> - Health check</li>
        </ul>
    </div>
    <div class="container">
        <h2>Quick Test:</h2>
        <p>Try these endpoints:</p>
        <ul>
            <li><a href="/ping">GET /ping</a></li>
            <li><a href="/home">GET /home</a></li>
            <li><a href="/search/naruto">GET /search/naruto</a></li>
            <li><a href="/recent/1">GET /recent/1</a></li>
        </ul>
    </div>
    <footer>
        <p>&copy; 2024 Beat Animes API. All rights reserved.</p>
    </footer>`;
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
    console.log(`🚀 Server running on port ${PORT}`);
});
